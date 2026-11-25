//! Heroicons (MIT, https://heroicons.com) outline paths, 24×24 viewBox, stroke 1.5.

use svgtypes::{SimplePathSegment, SimplifyingPathParser};

/// Builds a femtovg path for an icon, mapping its 24×24 box to `(x, y, size)`.
pub fn to_path(icon: Icon, x: f32, y: f32, size: f32) -> femtovg::Path {
    let k = size / 24.0;
    let p = |px: f64, py: f64| (x + px as f32 * k, y + py as f32 * k);
    let mut path = femtovg::Path::new();
    for d in icon.data() {
        for seg in SimplifyingPathParser::from(*d) {
            match seg.unwrap_or_else(|e| panic!("{icon:?}: {e}")) {
                SimplePathSegment::MoveTo { x, y } => {
                    let (x, y) = p(x, y);
                    path.move_to(x, y)
                }
                SimplePathSegment::LineTo { x, y } => {
                    let (x, y) = p(x, y);
                    path.line_to(x, y)
                }
                SimplePathSegment::CurveTo { x1, y1, x2, y2, x, y } => {
                    let ((x1, y1), (x2, y2), (x, y)) = (p(x1, y1), p(x2, y2), p(x, y));
                    path.bezier_to(x1, y1, x2, y2, x, y)
                }
                SimplePathSegment::Quadratic { x1, y1, x, y } => {
                    let ((x1, y1), (x, y)) = (p(x1, y1), p(x, y));
                    path.quad_to(x1, y1, x, y)
                }
                SimplePathSegment::ClosePath => path.close(),
            }
        }
    }
    path
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Icon {
    Cpu,
    Temp,
    Mem,
    Disk,
    Media,
    Download,
    Upload,
}

impl Icon {
    #[cfg(test)]
    pub const ALL: [Icon; 7] = [
        Icon::Cpu,
        Icon::Temp,
        Icon::Mem,
        Icon::Disk,
        Icon::Media,
        Icon::Download,
        Icon::Upload,
    ];

    pub fn data(self) -> &'static [&'static str] {
        match self {
            Icon::Cpu => CPU,
            Icon::Temp => TEMP,
            Icon::Mem => MEM,
            Icon::Disk => DISK,
            Icon::Media => MEDIA,
            Icon::Download => DOWNLOAD,
            Icon::Upload => UPLOAD,
        }
    }
}

pub const CPU: &[&str] = &[
    "M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z",
];

pub const TEMP: &[&str] = &[
    "M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z",
    "M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z",
];

pub const MEM: &[&str] = &[
    "M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3",
];

pub const DISK: &[&str] = &[
    "M21.75 17.25v-.228a4.5 4.5 0 00-.12-1.03l-2.268-9.64a3.375 3.375 0 00-3.285-2.602H7.923a3.375 3.375 0 00-3.285 2.602l-2.268 9.64a4.5 4.5 0 00-.12 1.03v.228m19.5 0a3 3 0 01-3 3H5.25a3 3 0 01-3-3m19.5 0a3 3 0 00-3-3H5.25a3 3 0 00-3 3m16.5 0h.008v.008h-.008v-.008zm-3 0h.008v.008h-.008v-.008z",
];

pub const MEDIA: &[&str] = &[
    "M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5",
];

pub const DOWNLOAD: &[&str] = &[
    "M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z",
];

pub const UPLOAD: &[&str] = &[
    "M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_icons_parse() {
        for icon in Icon::ALL {
            for d in icon.data() {
                let segs: Vec<_> = SimplifyingPathParser::from(*d).collect::<Result<_, _>>().unwrap();
                assert!(!segs.is_empty(), "{icon:?}");
            }
        }
    }
}
