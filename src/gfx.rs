//! EGL on a Wayland surface, with a femtovg canvas on top (GLES 2+).

use std::ffi::c_void;

use femtovg::{Canvas, renderer::OpenGl};
use khronos_egl as egl;
use wayland_client::{Connection, Proxy, protocol::wl_surface::WlSurface};
use wayland_egl::WlEglSurface;

type Egl = egl::DynamicInstance<egl::EGL1_4>;

pub struct Gfx {
    egl: Egl,
    display: egl::Display,
    context: egl::Context,
    surface: egl::Surface,
    window: WlEglSurface,
    pub canvas: Canvas<OpenGl>,
    pub width: u32,
    pub height: u32,
}

impl Gfx {
    pub fn new(conn: &Connection, wl_surface: &WlSurface, width: u32, height: u32) -> Result<Self, String> {
        let egl = unsafe { Egl::load_required() }.map_err(|e| format!("load libEGL: {e}"))?;
        let display =
            unsafe { egl.get_display(conn.backend().display_ptr() as *mut c_void) }.ok_or("eglGetDisplay failed")?;
        let (major, minor) = egl.initialize(display).map_err(|e| format!("eglInitialize: {e}"))?;
        egl.bind_api(egl::OPENGL_ES_API)
            .map_err(|e| format!("eglBindAPI: {e}"))?;

        #[rustfmt::skip]
        let attrs = [
            egl::SURFACE_TYPE, egl::WINDOW_BIT,
            egl::RENDERABLE_TYPE, egl::OPENGL_ES2_BIT,
            egl::RED_SIZE, 8, egl::GREEN_SIZE, 8, egl::BLUE_SIZE, 8, egl::ALPHA_SIZE, 0,
            egl::STENCIL_SIZE, 8,
            egl::NONE,
        ];
        let config = egl
            .choose_first_config(display, &attrs)
            .map_err(|e| format!("eglChooseConfig: {e}"))?
            .ok_or("no EGL config with RGB888 + stencil")?;

        // Prefer GLES 3, fall back to 2.
        let context = [3, 2]
            .iter()
            .find_map(|&v| {
                egl.create_context(display, config, None, &[egl::CONTEXT_CLIENT_VERSION, v, egl::NONE])
                    .ok()
            })
            .ok_or("eglCreateContext failed")?;

        let window = WlEglSurface::new(wl_surface.id(), width as i32, height as i32)
            .map_err(|e| format!("wl_egl_window_create: {e}"))?;
        let surface =
            unsafe { egl.create_window_surface(display, config, window.ptr() as egl::NativeWindowType, None) }
                .map_err(|e| format!("eglCreateWindowSurface: {e}"))?;
        egl.make_current(display, Some(surface), Some(surface), Some(context))
            .map_err(|e| format!("eglMakeCurrent: {e}"))?;
        // Frame callbacks pace rendering; don't also block in swap.
        let _ = egl.swap_interval(display, 0);

        let renderer = unsafe {
            OpenGl::new_from_function(|name| {
                egl.get_proc_address(name)
                    .map_or(std::ptr::null(), |f| f as *const c_void)
            })
        }
        .map_err(|e| format!("femtovg renderer: {e:?}"))?;
        let mut canvas = Canvas::new(renderer).map_err(|e| format!("femtovg canvas: {e:?}"))?;
        canvas.set_size(width, height, 1.0);

        let vendor = egl
            .query_string(Some(display), egl::VENDOR)
            .map(|s| s.to_string_lossy().into_owned());
        eprintln!("EGL {major}.{minor} ({}), {width}x{height}", vendor.unwrap_or_default());

        Ok(Self {
            egl,
            display,
            context,
            surface,
            window,
            canvas,
            width,
            height,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if (width, height) == (self.width, self.height) {
            return;
        }
        self.window.resize(width as i32, height as i32, 0, 0);
        self.canvas.set_size(width, height, 1.0);
        self.width = width;
        self.height = height;
    }

    /// Flushes the canvas to the default framebuffer and presents it.
    pub fn present(&mut self) {
        self.canvas.flush_to_output(());
        if let Err(e) = self.egl.swap_buffers(self.display, self.surface) {
            eprintln!("eglSwapBuffers: {e}");
        }
    }
}

impl Drop for Gfx {
    fn drop(&mut self) {
        let _ = self.egl.make_current(self.display, None, None, None);
        let _ = self.egl.destroy_surface(self.display, self.surface);
        let _ = self.egl.destroy_context(self.display, self.context);
    }
}
