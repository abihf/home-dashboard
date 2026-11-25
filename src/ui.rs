//! Drawing: background, clock card and status bars. All coordinates are in the
//! old web layout's CSS px (600 wide); the canvas is scaled to the surface.

use femtovg::renderer::OpenGl;
use femtovg::{Align, Baseline, Canvas, Color, FillRule, FontId, ImageFlags, ImageId, Paint, Path, Solidity};

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
    /// Animated fill in 0..=100.
    pub fill: f32,
    /// Target value, for the gradient colours.
    pub value: f32,
    pub wide: bool,
}

pub fn bars(status: &Status, fills: &[f32; 7]) -> [Bar; 7] {
    let s = status;
    let v = |p: f64| p.min(100.0) as f32;
    let bar = |i: usize, icon, label: String, value: f64, wide| Bar {
        icon,
        label,
        fill: fills[i].min(100.0),
        value: v(value),
        wide,
    };
    [
        bar(0, Icon::Cpu, format!("{:.2}%", s.cpu_usage), s.cpu_usage, false),
        bar(1, Icon::Temp, format!("{:.2}°C", s.cpu_temp), s.cpu_temp, false),
        bar(
            2,
            Icon::Mem,
            format!("{}B", normalize_size(s.mem.usage, 2)),
            s.mem.percent,
            true,
        ),
        bar(
            3,
            Icon::Disk,
            format!("{}B", normalize_size(s.disk_root.usage, 2)),
            s.disk_root.percent,
            false,
        ),
        bar(
            4,
            Icon::Media,
            format!("{}B", normalize_size(s.disk_media.usage, 2)),
            s.disk_media.percent,
            false,
        ),
        bar(
            5,
            Icon::Download,
            format!("{}B/s", normalize_size(s.download.usage, 0)),
            s.download.percent,
            false,
        ),
        bar(
            6,
            Icon::Upload,
            format!("{}B/s", normalize_size(s.upload.usage, 0)),
            s.upload.percent,
            false,
        ),
    ]
}

/// Bar fill targets in the same order as [`bars`].
pub fn bar_targets(s: &Status) -> [f32; 7] {
    [
        s.cpu_usage,
        s.cpu_temp,
        s.mem.percent,
        s.disk_root.percent,
        s.disk_media.percent,
        s.download.percent,
        s.upload.percent,
    ]
    .map(|p| p.clamp(0.0, 100.0) as f32)
}

pub struct Background {
    pub image: ImageId,
    pub width: f32,
    pub height: f32,
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

pub fn draw(canvas: &mut Canvas<OpenGl>, fonts: &Fonts, f: &Frame) {
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

    draw_clock(canvas, fonts, f.scale, 12.0, f.clock_y + 12.0, &f.time);
    if let Some(bars) = &f.bars {
        draw_status(canvas, fonts, f.scale, 12.0, f.status_y + 12.0, bars);
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

/// A frosted panel: shadow, backdrop blur of `sigma`, then a translucent fill.
/// A rounded rectangle `(x, y, w, h, radius)`.
type RRect = (f32, f32, f32, f32, f32);

fn glass(canvas: &mut Canvas<OpenGl>, (x, y, w, h, r): RRect, sigma: f32, tint: Color) {
    box_shadow(canvas, x, y, w, h, r);
    let p = rounded(x, y, w, h, r);
    if let Err(e) = canvas.blur_path(&p, FillRule::NonZero, sigma) {
        eprintln!("backdrop blur: {e:?}");
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

fn text(canvas: &mut Canvas<OpenGl>, font: FontId, size: f32, align: Align, x: f32, y: f32, s: &str) {
    let paint = Paint::color(Color::white())
        .with_font(&[font])
        .with_font_size(size)
        .with_text_align(align)
        .with_text_baseline(Baseline::Middle);
    let _ = canvas.fill_text(x, y, s, &paint);
}

fn draw_clock(canvas: &mut Canvas<OpenGl>, fonts: &Fonts, scale: f32, x: f32, y: f32, t: &LocalTime) {
    // border 2 + p-2 8 + 40 (text-4xl line) + mb-2 8 + 72 (text-7xl line) + 8 + 2
    let (w, h, r) = (DESIGN_WIDTH - 24.0, 140.0, 12.0);
    glass(canvas, (x, y, w, h, r), 16.0, rgba(0, 0, 0, 0.5));
    border(canvas, x, y, w, h, r);
    let cx = x + w / 2.0;
    text_shadow(canvas, scale);
    text(
        canvas,
        fonts.semibold,
        36.0,
        Align::Center,
        cx,
        y + 10.0 + 20.0,
        &t.date_string(),
    );
    text(
        canvas,
        fonts.bold,
        72.0,
        Align::Center,
        cx,
        y + 10.0 + 48.0 + 36.0,
        &t.time_string(),
    );
    no_shadow(canvas);
}

fn draw_status(canvas: &mut Canvas<OpenGl>, fonts: &Fonts, scale: f32, x0: f32, y0: f32, bars: &[Bar; 7]) {
    let gap = 8.0;
    let full = DESIGN_WIDTH - 24.0;
    let col = (full - gap) / 2.0;
    let (mut cx, mut cy) = (0usize, 0usize);
    for bar in bars {
        if bar.wide && cx != 0 {
            cx = 0;
            cy += 1;
        }
        let x = x0 + cx as f32 * (col + gap);
        let y = y0 + cy as f32 * (64.0 + gap);
        let w = if bar.wide { full } else { col };
        draw_bar(canvas, fonts, scale, x, y, w, bar);
        cx += if bar.wide { 2 } else { 1 };
        if cx >= 2 {
            cx = 0;
            cy += 1;
        }
    }
}

fn draw_bar(canvas: &mut Canvas<OpenGl>, fonts: &Fonts, scale: f32, x: f32, y: f32, w: f32, bar: &Bar) {
    let (h, r) = (64.0, 32.0);
    glass(canvas, (x, y, w, h, r), 12.0, rgba(0, 0, 0, 0.05));

    // padding box (inside the 2px border), clipped like overflow:hidden
    let (px, py, pw, ph, pr) = (x + 2.0, y + 2.0, w - 4.0, h - 4.0, r - 2.0);
    canvas.save();
    canvas.intersect_rounded_scissor(px, py, pw, ph, pr);

    let k = bar.fill / 100.0;
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

    text_shadow(canvas, scale);
    text(
        canvas,
        fonts.semibold,
        36.0,
        Align::Left,
        px + 64.0,
        py + 8.0 + 20.0,
        &bar.label,
    );
    no_shadow(canvas);
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
