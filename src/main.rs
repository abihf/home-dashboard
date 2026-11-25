//! Home dashboard: a fullscreen Wayland client (made for cage) drawing a clock,
//! system status and rotating backgrounds with OpenGL ES.

mod anim;
mod gfx;
mod icons;
mod images;
mod monitor;
mod scenes;
mod time;
mod ui;

use std::ffi::c_int;
use std::io::Read;
use std::os::fd::{AsFd, AsRawFd, BorrowedFd};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use smithay_client_toolkit::compositor::{CompositorHandler, CompositorState, FrameCallbackData};
use smithay_client_toolkit::output::{OutputHandler, OutputState};
use smithay_client_toolkit::registry::{ProvidesRegistryState, RegistryState};
use smithay_client_toolkit::seat::pointer::{PointerEvent, PointerEventKind, PointerHandler};
use smithay_client_toolkit::seat::{Capability, SeatHandler, SeatState};
use smithay_client_toolkit::shell::WaylandSurface;
use smithay_client_toolkit::shell::xdg::XdgShell;
use smithay_client_toolkit::shell::xdg::window::{Window, WindowConfigure, WindowDecorations, WindowHandler};
use smithay_client_toolkit::{delegate_registry, registry_handlers};
use wayland_client::globals::registry_queue_init;
use wayland_client::protocol::{wl_output, wl_pointer, wl_seat, wl_surface};
use wayland_client::{Connection, QueueHandle};

use anim::Tween;
use femtovg::{ImageSource, imgref::Img, rgb::RGB8};
use monitor::Status;
use scenes::Scenes;
use ui::{Background, Fonts, TextCache};

const DEFAULT_SIZE: (u32, u32) = (600, 1024);

struct App {
    registry_state: RegistryState,
    seat_state: SeatState,
    output_state: OutputState,
    conn: Connection,
    window: Window,
    pointer: Option<wl_pointer::WlPointer>,

    gfx: Option<Gfx>,
    /// Logical surface size and buffer scale.
    size: (u32, u32),
    buffer_scale: i32,
    configured: bool,
    frame_pending: bool,
    dirty: bool,
    exit: bool,

    scenes: Scenes,
    backgrounds: Vec<Option<Background>>,
    decoded: Vec<bool>,
    image_rx: Receiver<(usize, Result<images::Decoded, String>)>,
    status_slot: Arc<Mutex<Option<Status>>>,
    status: Option<Status>,
    clock_y: Tween,
    status_y: Tween,
    last_second: Option<time::LocalTime>,
    stats: Option<Stats>,
}

/// `DASHBOARD_STATS=1`: frame count and render cost, printed every 10 s.
struct Stats {
    since: Instant,
    frames: u32,
    busy: Duration,
}

struct Gfx {
    gfx: gfx::Gfx,
    fonts: Fonts,
    texts: TextCache,
}

impl App {
    fn ensure_gfx(&mut self) {
        let (w, h) = self.device_size();
        if let Some(g) = &mut self.gfx {
            g.gfx.resize(w, h);
            return;
        }
        match gfx::Gfx::new(&self.conn, self.window.wl_surface(), w, h) {
            Ok(mut g) => {
                let fonts = Fonts::load(&mut g.canvas);
                self.gfx = Some(Gfx {
                    gfx: g,
                    fonts,
                    texts: TextCache::default(),
                });
            }
            Err(e) => {
                eprintln!("graphics init failed: {e}");
                self.exit = true;
            }
        }
    }

    fn device_size(&self) -> (u32, u32) {
        let s = self.buffer_scale.max(1) as u32;
        (self.size.0 * s, self.size.1 * s)
    }

    /// Pulls in finished work from the worker threads and advances timelines.
    fn update(&mut self, now: Instant) {
        while let Ok((i, result)) = self.image_rx.try_recv() {
            self.decoded[i] = true;
            let (Ok(img), Some(g)) = (result, self.gfx.as_mut()) else {
                continue;
            };
            let pixels: Vec<RGB8> = img
                .rgb
                .as_chunks::<3>()
                .0
                .iter()
                .map(|p| RGB8::new(p[0], p[1], p[2]))
                .collect();
            let src = ImageSource::Rgb(Img::new(pixels.as_slice(), img.width, img.height));
            let canvas = &mut g.gfx.canvas;
            let bg = canvas
                .create_image(src, ui::background_flags())
                .map_err(|e| format!("{e:?}"))
                .and_then(|id| Background::new(canvas, id, img.width, img.height));
            match bg {
                Ok(bg) => {
                    self.backgrounds[i] = Some(bg);
                    self.dirty = true;
                }
                Err(e) => eprintln!("upload background {i}: {e}"),
            }
        }

        if let Some(status) = self.status_slot.lock().unwrap().take() {
            // Shown with the next clock tick, so idle is one frame per second;
            // only the first status redraws at once.
            if self.status.replace(status).is_none() {
                self.dirty = true;
            }
        }

        let decoded = &self.decoded;
        if self.scenes.tick(now, |i| decoded[i]) {
            self.dirty = true;
        }
        let view = self.scenes.view(now);
        self.clock_y.set(view.clock_pos, now);
        self.status_y.set(view.status_pos, now);

        let t = time::local(SystemTime::now());
        if self.last_second != Some(t) {
            self.last_second = Some(t);
            self.dirty = true;
        }
        if self.animating(now) {
            self.dirty = true;
        }
    }

    fn animating(&self, now: Instant) -> bool {
        self.scenes.animating() || self.clock_y.animating(now) || self.status_y.animating(now)
    }

    /// How long `poll` may sleep before the next scheduled change.
    fn timeout(&self, now: Instant) -> Duration {
        let mut t = time::until_next_second(SystemTime::now());
        if let Some(d) = self.scenes.deadline() {
            t = t.min(d.saturating_duration_since(now));
        }
        t
    }

    fn render(&mut self, qh: &QueueHandle<Self>, now: Instant) {
        if !self.configured || self.frame_pending || !self.dirty {
            return;
        }
        let Some(g) = self.gfx.as_mut() else { return };
        let started = Instant::now();
        let view = self.scenes.view(now);
        let frame = ui::Frame {
            scale: g.gfx.width as f32 / ui::DESIGN_WIDTH,
            background: self.backgrounds[view.background].as_ref(),
            next_background: view
                .next
                .and_then(|(i, t)| self.backgrounds[i].as_ref().map(|b| (b, anim::tw_ease(t)))),
            clock_y: self.clock_y.value(now),
            status_y: self.status_y.value(now),
            time: self.last_second.unwrap_or_else(|| time::local(SystemTime::now())),
            bars: self.status.as_ref().map(ui::bars),
        };
        ui::draw(&mut g.gfx.canvas, &g.fonts, &mut g.texts, &frame);

        let surface = self.window.wl_surface();
        surface.frame(qh, FrameCallbackData(surface.clone()));
        g.gfx.present();
        self.frame_pending = true;
        self.dirty = false;

        if let Some(st) = &mut self.stats {
            st.frames += 1;
            st.busy += started.elapsed();
            let elapsed = started.saturating_duration_since(st.since);
            if elapsed >= Duration::from_secs(10) {
                let avg = st.busy.as_secs_f64() * 1000.0 / st.frames.max(1) as f64;
                eprintln!(
                    "stats: {} frames in {:.1}s, {avg:.2} ms/frame render",
                    st.frames,
                    elapsed.as_secs_f64()
                );
                *st = Stats {
                    since: started,
                    frames: 0,
                    busy: Duration::ZERO,
                };
            }
        }
    }
}

impl CompositorHandler for App {
    fn scale_factor_changed(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        surface: &wl_surface::WlSurface,
        factor: i32,
    ) {
        if factor != self.buffer_scale {
            self.buffer_scale = factor;
            surface.set_buffer_scale(factor);
            self.ensure_gfx();
            self.dirty = true;
        }
    }

    fn transform_changed(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: wl_output::Transform,
    ) {
    }

    fn frame(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: u32) {
        self.frame_pending = false;
    }

    fn surface_enter(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: &wl_output::WlOutput,
    ) {
    }

    fn surface_leave(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: &wl_output::WlOutput,
    ) {
    }
}

impl OutputHandler for App {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.output_state
    }
    fn new_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn update_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn output_destroyed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
}

impl WindowHandler for App {
    fn request_close(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &Window) {
        self.exit = true;
    }

    fn configure(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &Window, configure: WindowConfigure, _: u32) {
        let (w, h) = configure.new_size;
        self.size = (
            w.map_or(DEFAULT_SIZE.0, |v| v.get()),
            h.map_or(DEFAULT_SIZE.1, |v| v.get()),
        );
        self.configured = true;
        self.ensure_gfx();
        self.dirty = true;
        // A configure needs a new buffer even if a frame callback is outstanding.
        self.frame_pending = false;
    }
}

impl SeatHandler for App {
    fn seat_state(&mut self) -> &mut SeatState {
        &mut self.seat_state
    }
    fn new_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}
    fn new_capability(&mut self, _: &Connection, qh: &QueueHandle<Self>, seat: wl_seat::WlSeat, cap: Capability) {
        if cap == Capability::Pointer && self.pointer.is_none() {
            self.pointer = self.seat_state.get_pointer(qh, &seat).ok();
        }
    }
    fn remove_capability(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat, cap: Capability) {
        if cap == Capability::Pointer
            && let Some(p) = self.pointer.take()
        {
            p.release();
        }
    }
    fn remove_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}
}

impl PointerHandler for App {
    fn pointer_frame(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        pointer: &wl_pointer::WlPointer,
        events: &[PointerEvent],
    ) {
        for e in events {
            if let PointerEventKind::Enter { serial } = e.kind {
                // Kiosk: no cursor over the dashboard.
                pointer.set_cursor(serial, None, 0, 0);
            }
        }
    }
}

delegate_registry!(App);

impl ProvidesRegistryState for App {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.registry_state
    }
    registry_handlers![OutputState, SeatState];
}

smithay_client_toolkit::delegate_dispatch2!(App);

#[repr(C)]
struct PollFd {
    fd: c_int,
    events: i16,
    revents: i16,
}

const POLLIN: i16 = 1;

unsafe extern "C" {
    fn poll(fds: *mut PollFd, n: u64, timeout: c_int) -> c_int;
}

/// Waits until one of `fds` is readable or `timeout` passes; returns readability per fd.
fn wait(fds: &[BorrowedFd], timeout: Duration) -> Vec<bool> {
    let mut pfds: Vec<PollFd> = fds
        .iter()
        .map(|fd| PollFd {
            fd: fd.as_raw_fd(),
            events: POLLIN,
            revents: 0,
        })
        .collect();
    let ms = timeout.as_millis().min(c_int::MAX as u128) as c_int;
    let ms = if timeout > Duration::ZERO && ms == 0 { 1 } else { ms };
    let n = unsafe { poll(pfds.as_mut_ptr(), pfds.len() as u64, ms) };
    if n < 0 {
        let err = std::io::Error::last_os_error();
        if err.kind() != std::io::ErrorKind::Interrupted {
            eprintln!("poll: {err}");
        }
    }
    pfds.iter().map(|p| p.revents != 0).collect()
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok()
}

fn main() {
    time::init();
    let bg_dir = PathBuf::from(
        env("BG_DIR")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "assets/bg".into()),
    );
    let windowed = env("DASHBOARD_WINDOWED").is_some_and(|v| !v.is_empty() && v != "0");

    let conn = Connection::connect_to_env().unwrap_or_else(|e| {
        eprintln!("cannot connect to Wayland: {e}");
        std::process::exit(1);
    });
    let (globals, mut queue) = registry_queue_init(&conn).expect("wayland registry");
    let qh = queue.handle();
    let compositor = CompositorState::bind(&globals, &qh).expect("wl_compositor");
    let xdg = XdgShell::bind(&globals, &qh).expect("xdg_wm_base");

    let surface = compositor.create_surface(&qh);
    let window = xdg.create_window(surface, WindowDecorations::RequestServer, &qh);
    window.set_title("Home Dashboard");
    window.set_app_id("home-dashboard");
    if !windowed {
        window.set_fullscreen(None);
    }
    window.commit();

    let (wake_rx, wake_tx) = UnixStream::pair().expect("socketpair");
    wake_rx.set_nonblocking(true).expect("nonblocking");

    let now = Instant::now();
    let scene_data = scenes::load_list(&bg_dir);
    let files: Vec<String> = scene_data.iter().map(|s| s.background.clone()).collect();
    let n = files.len();
    let image_rx = images::spawn(bg_dir, files, wake_tx.try_clone().expect("dup wake fd"));
    let status_slot = monitor::spawn(monitor::Config::from_env(env), wake_tx);
    let scenes = Scenes::new(scene_data, now);
    let first = scenes.view(now);

    let mut app = App {
        registry_state: RegistryState::new(&globals),
        seat_state: SeatState::new(&globals, &qh),
        output_state: OutputState::new(&globals, &qh),
        conn: conn.clone(),
        window,
        pointer: None,
        gfx: None,
        size: DEFAULT_SIZE,
        buffer_scale: 1,
        configured: false,
        frame_pending: false,
        dirty: true,
        exit: false,
        scenes,
        backgrounds: (0..n).map(|_| None).collect(),
        decoded: vec![false; n],
        image_rx,
        status_slot,
        status: None,
        clock_y: Tween::new(first.clock_pos, Duration::from_secs(1)),
        status_y: Tween::new(first.status_pos, Duration::from_secs(1)),
        last_second: None,
        stats: env("DASHBOARD_STATS")
            .is_some_and(|v| !v.is_empty() && v != "0")
            .then(|| Stats {
                since: Instant::now(),
                frames: 0,
                busy: Duration::ZERO,
            }),
    };

    let mut buf = [0u8; 64];
    while !app.exit {
        let now = Instant::now();
        app.update(now);
        app.render(&qh, now);

        if let Err(e) = queue.flush() {
            eprintln!("wayland flush: {e}");
            break;
        }
        let Some(guard) = queue.prepare_read() else {
            // events already queued
            if let Err(e) = queue.dispatch_pending(&mut app) {
                eprintln!("wayland dispatch: {e}");
                break;
            }
            continue;
        };
        // While animating, the frame callback paces us; otherwise sleep until the next tick.
        let timeout = if app.dirty {
            Duration::from_secs(1)
        } else {
            app.timeout(Instant::now())
        };
        let ready = wait(&[guard.connection_fd(), wake_rx.as_fd()], timeout);
        if ready[0] {
            if let Err(e) = guard.read() {
                eprintln!("wayland read: {e}");
                break;
            }
        } else {
            drop(guard);
        }
        if ready[1] {
            while matches!((&wake_rx).read(&mut buf), Ok(n) if n > 0) {}
        }
        if let Err(e) = queue.dispatch_pending(&mut app) {
            eprintln!("wayland dispatch: {e}");
            break;
        }
    }
}
