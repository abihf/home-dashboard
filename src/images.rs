//! Background image decoding on a worker thread.

use std::io::Write;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};
use std::thread;

use zune_jpeg::JpegDecoder;
use zune_jpeg::zune_core::bytestream::ZCursor;
use zune_jpeg::zune_core::colorspace::ColorSpace;
use zune_jpeg::zune_core::options::DecoderOptions;
use zune_png::PngDecoder;

pub struct Decoded {
    pub width: usize,
    pub height: usize,
    /// Tightly packed RGB8.
    pub rgb: Vec<u8>,
}

pub fn decode(path: &Path) -> Result<Decoded, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let is_png = data.starts_with(b"\x89PNG");
    let (width, height, pixels) = if is_png {
        let opts = DecoderOptions::default().png_set_strip_to_8bit(true);
        let mut d = PngDecoder::new_with_options(ZCursor::new(&data), opts);
        let pixels = d.decode_raw().map_err(|e| format!("{e:?}"))?;
        let (w, h) = d.dimensions().ok_or("no dimensions")?;
        (w, h, pixels)
    } else {
        let opts = DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::RGB);
        let mut d = JpegDecoder::new_with_options(ZCursor::new(&data), opts);
        let pixels = d.decode().map_err(|e| format!("{e:?}"))?;
        let info = d.info().ok_or("no image info")?;
        (info.width as usize, info.height as usize, pixels)
    };
    let n = width * height;
    if n == 0 || pixels.len() % n != 0 {
        return Err(format!(
            "unexpected pixel buffer size {} for {width}x{height}",
            pixels.len()
        ));
    }
    let rgb = match pixels.len() / n {
        3 => pixels,
        4 => pixels
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect(),
        1 => pixels.iter().flat_map(|&g| [g, g, g]).collect(),
        2 => pixels
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[0], p[0]])
            .collect(),
        c => return Err(format!("unsupported channel count {c}")),
    };
    Ok(Decoded { width, height, rgb })
}

/// Decodes `files` in order on a worker thread, sending `(index, result)` and
/// writing a byte to `wake` after each one.
pub fn spawn(dir: PathBuf, files: Vec<String>, mut wake: UnixStream) -> Receiver<(usize, Result<Decoded, String>)> {
    let (tx, rx) = channel();
    thread::Builder::new()
        .name("images".into())
        .spawn(move || {
            for (i, file) in files.iter().enumerate() {
                let result = if file.is_empty() || file.starts_with('.') || file.contains('/') {
                    Err("invalid file name".into())
                } else {
                    decode(&dir.join(file))
                };
                if let Err(e) = &result {
                    eprintln!("background {file}: {e}");
                }
                if tx.send((i, result)).is_err() {
                    return;
                }
                let _ = wake.write(&[1]);
            }
        })
        .expect("spawn image thread");
    rx
}
