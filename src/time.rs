//! Local wall-clock time via libc `localtime_r` (std links libc already).

use std::ffi::{c_char, c_int, c_long};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[repr(C)]
struct Tm {
    tm_sec: c_int,
    tm_min: c_int,
    tm_hour: c_int,
    tm_mday: c_int,
    tm_mon: c_int,
    tm_year: c_int,
    tm_wday: c_int,
    tm_yday: c_int,
    tm_isdst: c_int,
    tm_gmtoff: c_long,
    tm_zone: *const c_char,
}

unsafe extern "C" {
    fn localtime_r(t: *const i64, out: *mut Tm) -> *mut Tm;
    fn tzset();
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalTime {
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    pub day: u32,
    /// 0 = January
    pub month: u32,
    /// 0 = Sunday
    pub weekday: u32,
}

/// Must be called once before the first [`now`] so `TZ`/`/etc/localtime` is honoured.
pub fn init() {
    unsafe { tzset() };
}

pub fn local(at: SystemTime) -> LocalTime {
    let secs = at.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let mut tm = std::mem::MaybeUninit::<Tm>::zeroed();
    let ok = unsafe { !localtime_r(&secs, tm.as_mut_ptr()).is_null() };
    let tm = unsafe { tm.assume_init() };
    if !ok {
        return LocalTime {
            hour: 0,
            minute: 0,
            second: 0,
            day: 1,
            month: 0,
            weekday: 4,
        };
    }
    LocalTime {
        hour: tm.tm_hour as u32,
        minute: tm.tm_min as u32,
        second: tm.tm_sec.min(59) as u32,
        day: tm.tm_mday as u32,
        month: tm.tm_mon as u32,
        weekday: tm.tm_wday as u32,
    }
}

/// Time until the next whole second of the wall clock.
pub fn until_next_second(at: SystemTime) -> Duration {
    let nanos = at.duration_since(UNIX_EPOCH).unwrap_or_default().subsec_nanos();
    Duration::from_nanos(1_000_000_000 - nanos as u64)
}

const WEEKDAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

impl LocalTime {
    /// `Wednesday, Nov 25` (en-US `weekday: long, month: short, day: numeric`).
    pub fn date_string(&self) -> String {
        format!(
            "{}, {} {}",
            WEEKDAYS[self.weekday as usize % 7],
            MONTHS[self.month as usize % 12],
            self.day
        )
    }

    /// `HH:MM:SS`, 24-hour.
    pub fn time_string(&self) -> String {
        format!("{:02}:{:02}:{:02}", self.hour, self.minute, self.second)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_date_and_time() {
        let t = LocalTime {
            hour: 7,
            minute: 5,
            second: 9,
            day: 25,
            month: 10,
            weekday: 3,
        };
        assert_eq!(t.date_string(), "Wednesday, Nov 25");
        assert_eq!(t.time_string(), "07:05:09");
    }

    #[test]
    fn localtime_is_sane() {
        init();
        let t = local(SystemTime::now());
        assert!(t.hour < 24 && t.minute < 60 && t.second < 60);
        assert!((1..=31).contains(&t.day) && t.month < 12 && t.weekday < 7);
    }

    #[test]
    fn next_second_is_within_one_second() {
        let d = until_next_second(UNIX_EPOCH + Duration::from_millis(1_250));
        assert_eq!(d, Duration::from_millis(750));
    }
}
