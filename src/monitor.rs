//! System metrics from /proc, /sys and statvfs (port of the old `monitor.ts`).

use std::ffi::{CString, c_char, c_int, c_ulong};
use std::fs;
use std::io::Write;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Usage {
    /// Bytes (or bytes/s for network).
    pub usage: f64,
    pub percent: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Status {
    pub cpu_usage: f64,
    pub cpu_temp: f64,
    pub mem: Usage,
    pub disk_root: Usage,
    pub disk_media: Usage,
    pub download: Usage,
    pub upload: Usage,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub net_iface: String,
    pub cpu_sensor: String,
    pub disk_root: String,
    pub disk_media: String,
    pub interval: Duration,
}

impl Config {
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Self {
        let var = |k: &str, d: &str| get(k).filter(|v| !v.is_empty()).unwrap_or_else(|| d.into());
        let interval = get("MONITOR_INTERVAL_MS")
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v >= 100.0)
            .unwrap_or(1000.0);
        Self {
            net_iface: var("MONITOR_NET_IFACE", "eth1"),
            cpu_sensor: var("MONITOR_CPU_SENSOR", "k10temp"),
            disk_root: var("MONITOR_DISK_ROOT", "/"),
            disk_media: var("MONITOR_DISK_MEDIA", "/media/data"),
            interval: Duration::from_secs_f64(interval / 1000.0),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CpuSample {
    pub idle: u64,
    pub total: u64,
}

pub fn parse_cpu_sample(stat: &str) -> Option<CpuSample> {
    let line = stat.lines().find(|l| l.starts_with("cpu "))?;
    let values: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .map(|v| v.parse().ok())
        .collect::<Option<_>>()?;
    if values.len() < 4 {
        return None;
    }
    let idle = values[3] + values.get(4).copied().unwrap_or(0);
    Some(CpuSample {
        idle,
        total: values.iter().sum(),
    })
}

/// Returns `(MemTotal, MemAvailable)` in kB.
pub fn parse_meminfo(meminfo: &str) -> (Option<u64>, Option<u64>) {
    let (mut total, mut avail) = (None, None);
    for line in meminfo.lines() {
        let mut it = line.split_whitespace();
        let (Some(key), Some(val)) = (it.next(), it.next()) else {
            continue;
        };
        match key {
            "MemTotal:" => total = val.parse().ok(),
            "MemAvailable:" => avail = val.parse().ok(),
            _ => continue,
        }
        if total.is_some() && avail.is_some() {
            break;
        }
    }
    (total, avail)
}

pub fn mem_usage(total_kb: u64, available_kb: u64) -> Usage {
    if total_kb == 0 {
        return Usage::default();
    }
    let used = total_kb.saturating_sub(available_kb) as f64 * 1024.0;
    Usage {
        usage: used,
        percent: clamp(100.0 * used / (total_kb as f64 * 1024.0)),
    }
}

pub fn fs_usage(block_size: u64, blocks: u64, free: u64) -> Usage {
    let used = blocks.saturating_sub(free);
    Usage {
        usage: (used * block_size) as f64,
        percent: if blocks > 0 {
            clamp(100.0 * used as f64 / blocks as f64)
        } else {
            0.0
        },
    }
}

/// Bytes/s between two counter readings; percent scaled like the web version (100 kB/s = 1 %).
pub fn net_speed(new: u64, old: Option<u64>, elapsed: Option<Duration>) -> Usage {
    let (Some(old), Some(elapsed)) = (old, elapsed) else {
        return Usage::default();
    };
    if old == 0 || elapsed.is_zero() {
        return Usage::default();
    }
    let speed = new.saturating_sub(old) as f64 / elapsed.as_secs_f64();
    Usage {
        usage: speed,
        percent: speed / 100_000.0,
    }
}

fn clamp(v: f64) -> f64 {
    if v.is_finite() { v.clamp(0.0, 100.0) } else { 0.0 }
}

#[repr(C)]
struct StatVfs {
    f_bsize: c_ulong,
    f_frsize: c_ulong,
    f_blocks: u64,
    f_bfree: u64,
    f_bavail: u64,
    f_files: u64,
    f_ffree: u64,
    f_favail: u64,
    f_fsid: c_ulong,
    f_flag: c_ulong,
    f_namemax: c_ulong,
    _spare: [c_int; 6],
}

unsafe extern "C" {
    fn statvfs(path: *const c_char, buf: *mut StatVfs) -> c_int;
}

fn read_disk(path: &str) -> Option<Usage> {
    let c = CString::new(path).ok()?;
    let mut buf = std::mem::MaybeUninit::<StatVfs>::zeroed();
    if unsafe { statvfs(c.as_ptr(), buf.as_mut_ptr()) } != 0 {
        eprintln!("statvfs {path}: {}", std::io::Error::last_os_error());
        return None;
    }
    let s = unsafe { buf.assume_init() };
    Some(fs_usage(s.f_frsize, s.f_blocks, s.f_bfree))
}

fn read_number(path: &str) -> u64 {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

fn find_hwmon(sensor: &str) -> Option<PathBuf> {
    let mut dirs: Vec<_> = fs::read_dir("/sys/class/hwmon")
        .ok()?
        .flatten()
        .map(|e| e.path())
        .collect();
    dirs.sort();
    dirs.into_iter()
        .find(|d| fs::read_to_string(d.join("name")).is_ok_and(|n| n.trim() == sensor))
        .map(|d| d.join("temp1_input"))
}

/// Stateful reader: keeps the previous CPU and network samples for deltas.
pub struct Reader {
    config: Config,
    prev_cpu: Option<CpuSample>,
    hwmon: Option<Option<PathBuf>>,
    prev_net: Option<(Instant, u64, u64)>,
}

impl Reader {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            prev_cpu: None,
            hwmon: None,
            prev_net: None,
        }
    }

    fn cpu_usage(&mut self) -> f64 {
        let Some(cur) = fs::read_to_string("/proc/stat")
            .ok()
            .as_deref()
            .and_then(parse_cpu_sample)
        else {
            return 0.0;
        };
        let Some(prev) = self.prev_cpu.replace(cur) else {
            return 0.0;
        };
        let total = cur.total.saturating_sub(prev.total);
        let idle = cur.idle.saturating_sub(prev.idle);
        if total == 0 {
            0.0
        } else {
            clamp(100.0 * total.saturating_sub(idle) as f64 / total as f64)
        }
    }

    fn cpu_temp(&mut self) -> f64 {
        let sensor = &self.config.cpu_sensor;
        let path = self.hwmon.get_or_insert_with(|| find_hwmon(sensor));
        match path {
            Some(p) => read_number(&p.to_string_lossy()) as f64 / 1000.0,
            None => 0.0,
        }
    }

    pub fn read(&mut self) -> Status {
        let (total, avail) = fs::read_to_string("/proc/meminfo")
            .map(|s| parse_meminfo(&s))
            .unwrap_or_default();
        let iface = &self.config.net_iface;
        let rx = read_number(&format!("/sys/class/net/{iface}/statistics/rx_bytes"));
        let tx = read_number(&format!("/sys/class/net/{iface}/statistics/tx_bytes"));
        let now = Instant::now();
        let prev = self.prev_net.replace((now, rx, tx));
        let elapsed = prev.map(|(t, ..)| now - t);
        Status {
            cpu_usage: self.cpu_usage(),
            cpu_temp: self.cpu_temp(),
            mem: mem_usage(total.unwrap_or(0), avail.unwrap_or(0)),
            disk_root: read_disk(&self.config.disk_root).unwrap_or_default(),
            disk_media: read_disk(&self.config.disk_media).unwrap_or_default(),
            download: net_speed(rx, prev.map(|p| p.1), elapsed),
            upload: net_speed(tx, prev.map(|p| p.2), elapsed),
        }
    }
}

/// Spawns the sampling thread. Each new [`Status`] is stored in the returned slot
/// and a byte is written to `wake` so the event loop's `poll` returns.
pub fn spawn(config: Config, mut wake: UnixStream) -> Arc<Mutex<Option<Status>>> {
    let slot = Arc::new(Mutex::new(None));
    let out = slot.clone();
    thread::Builder::new()
        .name("monitor".into())
        .spawn(move || {
            let interval = config.interval;
            let mut reader = Reader::new(config);
            loop {
                let status = reader.read();
                *out.lock().unwrap() = Some(status);
                let _ = wake.write(&[1]);
                thread::sleep(interval);
            }
        })
        .expect("spawn monitor thread");
    slot
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_sample_from_proc_stat() {
        assert_eq!(
            parse_cpu_sample("cpu  1 2 3 4 5 6 7 8 9 10\ncpu0 1 1 1 1"),
            Some(CpuSample { idle: 9, total: 55 })
        );
        assert_eq!(parse_cpu_sample("cpu0 1 2 3 4"), None);
        assert_eq!(parse_cpu_sample("cpu  a b c d"), None);
        assert_eq!(parse_cpu_sample("cpu  1 2 3"), None);
    }

    #[test]
    fn meminfo_fields() {
        let text = "MemFree:        100000 kB\nMemTotal:       1000000 kB\nBuffers:         100000 kB\nMemAvailable:    500000 kB\n";
        assert_eq!(parse_meminfo(text), (Some(1_000_000), Some(500_000)));
        let u = mem_usage(1_000_000, 500_000);
        assert_eq!(u.usage, 500_000.0 * 1024.0);
        assert_eq!(u.percent, 50.0);
        assert_eq!(mem_usage(0, 0), Usage::default());
    }

    #[test]
    fn statfs_usage() {
        assert_eq!(
            fs_usage(4096, 100, 75),
            Usage {
                usage: 25.0 * 4096.0,
                percent: 25.0
            }
        );
        assert_eq!(fs_usage(4096, 0, 0), Usage::default());
    }

    #[test]
    fn network_speed() {
        assert_eq!(net_speed(1000, None, None), Usage::default());
        let u = net_speed(300_000, Some(100_000), Some(Duration::from_secs(2)));
        assert_eq!(
            u,
            Usage {
                usage: 100_000.0,
                percent: 1.0
            }
        );
        // counter reset
        assert_eq!(net_speed(5, Some(100), Some(Duration::from_secs(1))).usage, 0.0);
    }

    #[test]
    fn config_defaults_and_overrides() {
        let c = Config::from_env(|_| None);
        assert_eq!(c.net_iface, "eth1");
        assert_eq!(c.cpu_sensor, "k10temp");
        assert_eq!(c.disk_root, "/");
        assert_eq!(c.disk_media, "/media/data");
        assert_eq!(c.interval, Duration::from_secs(1));

        let c = Config::from_env(|k| match k {
            "MONITOR_NET_IFACE" => Some("enp1s0".into()),
            "MONITOR_INTERVAL_MS" => Some("50".into()),
            _ => None,
        });
        assert_eq!(c.net_iface, "enp1s0");
        assert_eq!(c.interval, Duration::from_secs(1), "below 100ms is ignored");
        let c = Config::from_env(|k| (k == "MONITOR_INTERVAL_MS").then(|| "250".into()));
        assert_eq!(c.interval, Duration::from_millis(250));
    }

    #[test]
    fn reads_this_machine() {
        let mut r = Reader::new(Config::from_env(|_| None));
        let s = r.read();
        assert!(s.mem.usage > 0.0);
        assert!(s.disk_root.percent > 0.0);
    }
}
