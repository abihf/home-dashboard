//! Drawing: background, clock card and status bars. All coordinates are in the
//! old web layout's CSS px (600 wide); the canvas is scaled to the surface.

use femtovg::renderer::OpenGl;
use femtovg::{
    Align, Baseline, Canvas, Color, FillRule, FontId, ImageFilter, ImageFlags, ImageId, Paint, Path, PixelFormat,
    RenderTarget, Solidity,
};

use crate::icons::{self, Icon};
use crate::monitor::Status;
use crate::time::LocalTime;

pub const DESIGN_WIDTH: f32 = 600.0;

pub struct Fonts {
    pub semibold: FontId,
    pub bold: FontId,
}

impl Fonts {
    pub fn load(canvas: &mut Canvas<OpenGl>) -> Self {
        let semibold = canvas
            .add_font_mem(include_bytes!("../assets/fonts/JetBrainsMono-SemiBold.ttf"))
            .expect("embedded font");
        let bold = canvas
            .add_font_mem(include_bytes!("../assets/fonts/JetBrainsMono-Bold.ttf"))
            .expect("embedded font");
        Self { semibold, bold }
    }
}

const SIZE_SUFFIX: [&str; 4] = ["K", "M", "G", "T"];

/// `1536 -> "1.50 K"` (port of the web `normalizeSize`).
pub fn normalize_size(size: f64, digits: usize) -> String {
    let mut idx: isize = -1;
    let mut n = size;
    while n > 1024.0 && idx < SIZE_SUFFIX.len() as isize - 1 {
        n /= 1024.0;
        idx += 1;
    }
    let suffix = if idx >= 0 { SIZE_SUFFIX[idx as usize] } else { "" };
    format!("{n:.digits$} {suffix}")
}

/// One progress bar's content.
pub struct Bar {
    pub icon: Icon,
    pub label: String,
    /// Fill in 0..=100.
    pub value: f32,
    pub wide: bool,
}

pub fn bars(s: &Status) -> [Bar; 7] {
    let bar = |icon, label: String, value: f64, wide| Bar {
        icon,
        label,
        value: if value.is_finite() {
            value.clamp(0.0, 100.0) as f32
        } else {
            0.0
        },
        wide,
    };
    let size = |u: f64, d| normalize_size(u, d);
    [
        bar(Icon::Cpu, format!("{:.2}%", s.cpu_usage), s.cpu_usage, false),
        bar(Icon::Temp, format!("{:.2}°C", s.cpu_temp), s.cpu_temp, false),
        bar(Icon::Mem, format!("{}B", size(s.mem.usage, 2)), s.mem.percent, true),
        bar(
            Icon::Disk,
            format!("{}B", size(s.disk_root.usage, 2)),
            s.disk_root.percent,
            false,
        ),
        bar(
            Icon::Media,
            format!("{}B", size(s.disk_media.usage, 2)),
            s.disk_media.percent,
            false,
        ),
        bar(
            Icon::Download,
            format!("{}B/s", size(s.download.usage, 0)),
            s.download.percent,
            false,
        ),
        bar(
            Icon::Upload,
            format!("{}B/s", size(s.upload.usage, 0)),
            s.upload.percent,
            false,
        ),
    ]
}

/// Backdrop blur of the clock card (Tailwind `backdrop-blur-lg`).
const BLUR_LG: f32 = 16.0;
/// Backdrop blur of the status bars (Tailwind `backdrop-blur-md`).
const BLUR_MD: f32 = 12.0;
/// Blurred copies are made at this fraction of the background's size.
const BLUR_DOWNSCALE: f32 = 4.0;

pub struct Background {
    pub image: ImageId,
    /// Pre-blurred, downscaled copies used as the panels' backdrop.
    pub blur_lg: ImageId,
    pub blur_md: ImageId,
    pub width: f32,
    pub height: f32,
}

impl Background {
    /// Wraps an uploaded image and renders its blurred copies once, so frames
    /// never blur at draw time: a panel just samples the copy under it.
    pub fn new(canvas: &mut Canvas<OpenGl>, image: ImageId, width: usize, height: usize) -> Result<Self, String> {
        let (sw, sh) = (
            (width as f32 / BLUR_DOWNSCALE).ceil() as usize,
            (height as f32 / BLUR_DOWNSCALE).ceil() as usize,
        );
        let err = |e: femtovg::ErrorKind| format!("{e:?}");
        let small = canvas
            .create_image_empty(sw, sh, PixelFormat::Rgba8, ImageFlags::empty())
            .map_err(err)?;
        canvas.save();
        canvas.reset();
        canvas.set_render_target(RenderTarget::Image(small));
        let mut p = Path::new();
        p.rect(0.0, 0.0, sw as f32, sh as f32);
        canvas.fill_path(&p, &Paint::image(image, 0.0, 0.0, sw as f32, sh as f32, 0.0, 1.0));
        let mut blurred = |sigma: f32| -> Result<ImageId, String> {
            // Render targets are stored bottom-up; FLIP_Y samples them upright.
            let out = canvas
                .create_image_empty(sw, sh, PixelFormat::Rgba8, ImageFlags::FLIP_Y)
                .map_err(err)?;
            canvas.filter_image(out, ImageFilter::gaussian_blur(sigma / BLUR_DOWNSCALE), small);
            Ok(out)
        };
        let result = blurred(BLUR_LG).and_then(|lg| Ok((lg, blurred(BLUR_MD)?)));
        canvas.set_render_target(RenderTarget::Screen);
        canvas.restore();
        // `small` stays allocated (a few hundred KB): queued filter commands still read it.
        let (blur_lg, blur_md) = result?;
        Ok(Self {
            image,
            blur_lg,
            blur_md,
            width: width as f32,
            height: height as f32,
        })
    }
}

/// Which pre-blurred copy a panel shows through.
#[derive(Clone, Copy)]
enum Blur {
    Lg,
    Md,
}

/// Shadowed text rendered once into an image and reused until it changes.
struct TextImage {
    key: (String, FontId, u32, u32),
    image: ImageId,
    /// Image size and the text's ink width, in device px.
    width: f32,
    height: f32,
    text_width: f32,
}

/// Slots: 0 date, 1 time, 2.. bar labels.
#[derive(Default)]
pub struct TextCache {
    slots: Vec<Option<TextImage>>,
}

/// Room around cached text for the drop shadow (`0 4px 4px`), in design px.
const TEXT_PAD: f32 = 12.0;

impl TextCache {
    fn slot(
        &mut self,
        canvas: &mut Canvas<OpenGl>,
        idx: usize,
        text: &str,
        font: FontId,
        size: f32,
        scale: f32,
    ) -> Option<&TextImage> {
        if self.slots.len() <= idx {
            self.slots.resize_with(idx + 1, || None);
        }
        let key = (text.to_owned(), font, size.to_bits(), scale.to_bits());
        if self.slots[idx].as_ref().is_some_and(|t| t.key == key) {
            return self.slots[idx].as_ref();
        }
        if let Some(old) = self.slots[idx].take() {
            canvas.delete_image(old.image);
        }
        let paint = Paint::color(Color::white())
            .with_font(&[font])
            .with_font_size(size * scale)
            .with_text_align(Align::Left)
            .with_text_baseline(Baseline::Middle);
        canvas.save();
        canvas.reset();
        let text_width = canvas
            .measure_text(0.0, 0.0, text, &paint)
            .map(|m| m.width())
            .unwrap_or(0.0);
        let pad = (TEXT_PAD * scale).ceil();
        let width = (text_width + 2.0 * pad).ceil();
        let height = (size * scale * 1.5 + 2.0 * pad).ceil();
        let image = canvas
            .create_image_empty(
                width as usize,
                height as usize,
                PixelFormat::Rgba8,
                ImageFlags::PREMULTIPLIED | ImageFlags::FLIP_Y,
            )
            .ok();
        if let Some(image) = image {
            canvas.set_render_target(RenderTarget::Image(image));
            canvas.clear_rect(0, 0, width as u32, height as u32, Color::rgba(0, 0, 0, 0));
            text_shadow(canvas, scale);
            let _ = canvas.fill_text(pad, height / 2.0, text, &paint);
            no_shadow(canvas);
            canvas.set_render_target(RenderTarget::Screen);
        }
        canvas.restore();
        self.slots[idx] = image.map(|image| TextImage {
            key,
            image,
            width,
            height,
            text_width,
        });
        self.slots[idx].as_ref()
    }

    /// Renders the strings of this frame that changed since the last one.
    /// Must run before anything is drawn to the screen.
    pub fn prepare(&mut self, canvas: &mut Canvas<OpenGl>, fonts: &Fonts, f: &Frame) {
        self.slot(canvas, 0, &f.time.date_string(), fonts.semibold, 36.0, f.scale);
        self.slot(canvas, 1, &f.time.time_string(), fonts.bold, 72.0, f.scale);
        if let Some(bars) = &f.bars {
            for (i, bar) in bars.iter().enumerate() {
                self.slot(canvas, 2 + i, &bar.label, fonts.semibold, 36.0, f.scale);
            }
        }
    }

    /// Draws slot `idx` with its vertical middle at `y`; `x` is the left edge
    /// of the text, or its centre when `centered`.
    fn draw(&self, canvas: &mut Canvas<OpenGl>, idx: usize, x: f32, y: f32, centered: bool, scale: f32) {
        let Some(Some(t)) = self.slots.get(idx) else { return };
        let pad = (TEXT_PAD * scale).ceil();
        let left = if centered {
            x * scale - t.text_width / 2.0
        } else {
            x * scale
        };
        // snap to device pixels so the cached glyphs stay crisp
        let ix = (left - pad).round() / scale;
        let iy = (y * scale - t.height / 2.0).round() / scale;
        let (w, h) = (t.width / scale, t.height / scale);
        let mut p = Path::new();
        p.rect(ix, iy, w, h);
        canvas.fill_path(&p, &Paint::image(t.image, ix, iy, w, h, 0.0, 1.0));
    }
}

pub struct Frame<'a> {
    pub scale: f32,
    pub background: Option<&'a Background>,
    pub next_background: Option<(&'a Background, f32)>,
    pub clock_y: f32,
    pub status_y: f32,
    pub time: LocalTime,
    pub bars: Option<[Bar; 7]>,
}

fn rgba(r: u8, g: u8, b: u8, a: f32) -> Color {
    Color::rgba(r, g, b, (a * 255.0).round() as u8)
}

fn css_hsla(h: f32, s: f32, l: f32, a: f32) -> Color {
    Color::hsla(h.rem_euclid(360.0) / 360.0, s, l, a)
}

fn rounded(x: f32, y: f32, w: f32, h: f32, r: f32) -> Path {
    let mut p = Path::new();
    p.rounded_rect(x, y, w, h, r);
    p
}

pub fn draw(canvas: &mut Canvas<OpenGl>, fonts: &Fonts, texts: &mut TextCache, f: &Frame) {
    texts.prepare(canvas, fonts, f);
    let (w, h) = (canvas.width(), canvas.height());
    canvas.clear_rect(0, 0, w, h, Color::black());
    canvas.reset();
    canvas.scale(f.scale, f.scale);
    let view_h = h as f32 / f.scale;

    if let Some(bg) = f.background {
        draw_background(canvas, bg, 1.0, view_h);
    }
    if let Some((bg, alpha)) = f.next_background {
        draw_background(canvas, bg, alpha, view_h);
    }

    draw_clock(canvas, texts, f, 12.0, f.clock_y + 12.0);
    if let Some(bars) = &f.bars {
        draw_status(canvas, texts, f, 12.0, f.status_y + 12.0, bars);
    }
}

/// CSS `background-image` defaults: natural size, top-left, repeated.
fn draw_background(canvas: &mut Canvas<OpenGl>, bg: &Background, alpha: f32, view_h: f32) {
    if alpha <= 0.0 {
        return;
    }
    let mut p = Path::new();
    p.rect(0.0, 0.0, DESIGN_WIDTH, view_h);
    canvas.fill_path(&p, &Paint::image(bg.image, 0.0, 0.0, bg.width, bg.height, 0.0, alpha));
}

pub fn background_flags() -> ImageFlags {
    ImageFlags::REPEAT_X | ImageFlags::REPEAT_Y
}

/// Tailwind `shadow-lg`: `0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a`,
/// painted only outside the box like CSS box-shadow.
fn box_shadow(canvas: &mut Canvas<OpenGl>, x: f32, y: f32, w: f32, h: f32, r: f32) {
    for (dy, blur, spread) in [(10.0, 15.0, -3.0), (4.0, 6.0, -4.0)] {
        let (sx, sy, sw, sh) = (x - spread, y + dy - spread, w + 2.0 * spread, h + 2.0 * spread);
        let pad = blur * 2.0;
        let mut p = Path::new();
        p.rect(sx - pad, sy - pad, sw + pad * 2.0, sh + pad * 2.0);
        p.rounded_rect(x, y, w, h, r);
        p.solidity(Solidity::Hole);
        let paint = Paint::box_gradient(
            sx,
            sy,
            sw,
            sh,
            (r + spread).max(0.0),
            blur,
            rgba(0, 0, 0, 0.1),
            rgba(0, 0, 0, 0.0),
        );
        canvas.fill_path(&p, &paint.with_fill_rule(FillRule::EvenOdd));
    }
}

/// A rounded rectangle `(x, y, w, h, radius)`.
type RRect = (f32, f32, f32, f32, f32);

/// A frosted panel: shadow, the blurred background(s) under it, then a translucent fill.
fn glass(canvas: &mut Canvas<OpenGl>, f: &Frame, (x, y, w, h, r): RRect, blur: Blur, tint: Color) {
    box_shadow(canvas, x, y, w, h, r);
    let p = rounded(x, y, w, h, r);
    let backdrop = |bg: &Background, alpha: f32| {
        let id = match blur {
            Blur::Lg => bg.blur_lg,
            Blur::Md => bg.blur_md,
        };
        Paint::image(id, 0.0, 0.0, bg.width, bg.height, 0.0, alpha)
    };
    if let Some(bg) = f.background {
        canvas.fill_path(&p, &backdrop(bg, 1.0));
    }
    if let Some((bg, alpha)) = f.next_background.filter(|(_, a)| *a > 0.0) {
        canvas.fill_path(&p, &backdrop(bg, alpha));
    }
    canvas.fill_path(&p, &Paint::color(tint));
}

fn border(canvas: &mut Canvas<OpenGl>, x: f32, y: f32, w: f32, h: f32, r: f32) {
    let p = rounded(x + 1.0, y + 1.0, w - 2.0, h - 2.0, (r - 1.0).max(0.0));
    canvas.stroke_path(&p, &Paint::color(Color::white()).with_line_width(2.0));
}

/// Tailwind `drop-shadow-lg`: `drop-shadow(0 4px 4px #00000026)`.
fn text_shadow(canvas: &mut Canvas<OpenGl>, scale: f32) {
    canvas.set_shadow_color(rgba(0, 0, 0, 0.15));
    canvas.set_shadow_blur(4.0 * scale);
    canvas.set_shadow_offset(0.0, 4.0 * scale);
}

fn no_shadow(canvas: &mut Canvas<OpenGl>) {
    canvas.set_shadow_color(Color::rgba(0, 0, 0, 0));
}

fn draw_clock(canvas: &mut Canvas<OpenGl>, texts: &TextCache, f: &Frame, x: f32, y: f32) {
    // border 2 + p-2 8 + 40 (text-4xl line) + mb-2 8 + 72 (text-7xl line) + 8 + 2
    let (w, h, r) = (DESIGN_WIDTH - 24.0, 140.0, 12.0);
    glass(canvas, f, (x, y, w, h, r), Blur::Lg, rgba(0, 0, 0, 0.5));
    border(canvas, x, y, w, h, r);
    let cx = x + w / 2.0;
    texts.draw(canvas, 0, cx, y + 10.0 + 20.0, true, f.scale);
    texts.draw(canvas, 1, cx, y + 10.0 + 48.0 + 36.0, true, f.scale);
}

fn draw_status(canvas: &mut Canvas<OpenGl>, texts: &TextCache, f: &Frame, x0: f32, y0: f32, bars: &[Bar; 7]) {
    let gap = 8.0;
    let full = DESIGN_WIDTH - 24.0;
    let col = (full - gap) / 2.0;
    let (mut cx, mut cy) = (0usize, 0usize);
    for (i, bar) in bars.iter().enumerate() {
        if bar.wide && cx != 0 {
            cx = 0;
            cy += 1;
        }
        let x = x0 + cx as f32 * (col + gap);
        let y = y0 + cy as f32 * (64.0 + gap);
        let w = if bar.wide { full } else { col };
        draw_bar(canvas, texts, f, (x, y, w), 2 + i, bar);
        cx += if bar.wide { 2 } else { 1 };
        if cx >= 2 {
            cx = 0;
            cy += 1;
        }
    }
}

fn draw_bar(
    canvas: &mut Canvas<OpenGl>,
    texts: &TextCache,
    f: &Frame,
    (x, y, w): (f32, f32, f32),
    text_slot: usize,
    bar: &Bar,
) {
    let (h, r) = (64.0, 32.0);
    glass(canvas, f, (x, y, w, h, r), Blur::Md, rgba(0, 0, 0, 0.05));

    // padding box (inside the 2px border), clipped like overflow:hidden
    let (px, py, pw, ph, pr) = (x + 2.0, y + 2.0, w - 4.0, h - 4.0, r - 2.0);
    canvas.save();
    canvas.intersect_rounded_scissor(px, py, pw, ph, pr);

    let k = bar.value / 100.0;
    let v = bar.value;
    if k > 0.0 {
        let fw = pw * k;
        let mut p = Path::new();
        p.rect(px, py, fw, ph);
        let paint = Paint::linear_gradient(
            px,
            py,
            px + fw,
            py,
            css_hsla(130.0 - v, 0.8, 0.3, 1.0),
            css_hsla(80.0 - v * 0.8, 0.8, 0.4, 0.7),
        );
        canvas.fill_path(&p, &paint);
    }
    if k < 1.0 {
        let mut p = Path::new();
        p.rect(px + pw * k, py, pw * (1.0 - k), ph);
        canvas.fill_path(&p, &Paint::color(rgba(0, 0, 0, 0.4)));
    }

    // icon circle: 60×60 at the padding box origin, icon 32px centred
    let mut circle = Path::new();
    circle.circle(px + 30.0, py + 30.0, 30.0);
    canvas.fill_path(&circle, &Paint::color(rgba(0, 0, 0, 0.3)));
    let icon = icons::to_path(bar.icon, px + 14.0, py + 14.0, 32.0);
    let stroke = Paint::color(Color::white())
        .with_line_width(1.5 * 32.0 / 24.0)
        .with_line_cap(femtovg::LineCap::Round)
        .with_line_join(femtovg::LineJoin::Round);
    canvas.stroke_path(&icon, &stroke);

    texts.draw(canvas, text_slot, px + 64.0, py + 8.0 + 20.0, false, f.scale);
    canvas.restore();

    border(canvas, x, y, w, h, r);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_sizes() {
        assert_eq!(normalize_size(512.0, 2), "512.00 ");
        assert_eq!(normalize_size(1536.0, 2), "1.50 K");
        assert_eq!(normalize_size(5.0 * 1024.0 * 1024.0 * 1024.0, 1), "5.0 G");
        assert_eq!(normalize_size(2048.0, 0), "2 K");
    }
}
