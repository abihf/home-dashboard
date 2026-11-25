//! CSS-style easing and tweens.

use std::time::{Duration, Instant};

/// Solves a CSS `cubic-bezier(x1, y1, x2, y2)` timing function at progress `t` in [0, 1].
pub fn cubic_bezier(x1: f32, y1: f32, x2: f32, y2: f32, t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    let bez = |a: f32, b: f32, s: f32| {
        let u = 1.0 - s;
        3.0 * u * u * s * a + 3.0 * u * s * s * b + s * s * s
    };
    // Newton iterations on x(s) = t, falling back to bisection.
    let mut s = t;
    for _ in 0..8 {
        let x = bez(x1, x2, s) - t;
        let u = 1.0 - s;
        let dx = 3.0 * u * u * x1 + 6.0 * u * s * (x2 - x1) + 3.0 * s * s * (1.0 - x2);
        if x.abs() < 1e-5 {
            return bez(y1, y2, s);
        }
        if dx.abs() < 1e-6 {
            break;
        }
        s = (s - x / dx).clamp(0.0, 1.0);
    }
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    for _ in 0..30 {
        s = (lo + hi) / 2.0;
        if bez(x1, x2, s) < t { lo = s } else { hi = s }
    }
    bez(y1, y2, s)
}

/// The CSS `ease` timing function.
#[cfg(test)]
pub fn ease(t: f32) -> f32 {
    cubic_bezier(0.25, 0.1, 0.25, 1.0, t)
}

/// Tailwind's default transition timing, `cubic-bezier(0.4, 0, 0.2, 1)`.
pub fn tw_ease(t: f32) -> f32 {
    cubic_bezier(0.4, 0.0, 0.2, 1.0, t)
}

/// Animates a value toward a target like a CSS `transition` on that property:
/// retargeting starts from the current animated value.
#[derive(Debug, Clone, Copy)]
pub struct Tween {
    from: f32,
    to: f32,
    start: Instant,
    duration: Duration,
}

impl Tween {
    pub fn new(value: f32, duration: Duration) -> Self {
        Self {
            from: value,
            to: value,
            start: Instant::now() - duration,
            duration,
        }
    }

    pub fn set(&mut self, to: f32, now: Instant) {
        if to == self.to {
            return;
        }
        self.from = self.value(now);
        self.to = to;
        self.start = now;
    }

    pub fn progress(&self, now: Instant) -> f32 {
        if self.duration.is_zero() {
            return 1.0;
        }
        (now.saturating_duration_since(self.start).as_secs_f32() / self.duration.as_secs_f32()).min(1.0)
    }

    pub fn value(&self, now: Instant) -> f32 {
        self.from + (self.to - self.from) * tw_ease(self.progress(now))
    }

    pub fn animating(&self, now: Instant) -> bool {
        self.progress(now) < 1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ease_endpoints_and_midpoint() {
        assert_eq!(ease(0.0), 0.0);
        assert!((ease(1.0) - 1.0).abs() < 1e-4);
        // CSS ease at 50% time is ~80.24% progress
        assert!((ease(0.5) - 0.8024).abs() < 1e-3, "{}", ease(0.5));
        let linear = cubic_bezier(0.0, 0.0, 1.0, 1.0, 0.3);
        assert!((linear - 0.3).abs() < 1e-4);
    }

    #[test]
    fn tween_retargets_from_current_value() {
        let mut tw = Tween::new(0.0, Duration::from_secs(1));
        let t0 = Instant::now();
        assert!(!tw.animating(t0));
        tw.set(100.0, t0);
        assert!(tw.animating(t0));
        assert_eq!(tw.value(t0), 0.0);
        let mid = tw.value(t0 + Duration::from_millis(500));
        assert!(mid > 50.0 && mid < 100.0);
        assert_eq!(tw.value(t0 + Duration::from_secs(2)), 100.0);
        tw.set(0.0, t0 + Duration::from_millis(500));
        assert!((tw.value(t0 + Duration::from_millis(500)) - mid).abs() < 1e-3);
    }
}
