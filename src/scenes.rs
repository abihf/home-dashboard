//! Background scene rotation (port of the old `scenes.ts`).
//!
//! A scene is shown for [`SCENE_INTERVAL`]; then the next scene's background fades
//! in over [`FADE`] while the clock/status blocks slide to its positions, and after
//! [`TRANSITION`] the next scene becomes current.

use std::path::Path;
use std::time::{Duration, Instant};

use serde::Deserialize;

pub const SCENE_INTERVAL: Duration = Duration::from_secs(20);
pub const TRANSITION: Duration = Duration::from_millis(1500);
pub const FADE: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneData {
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub clock_pos: f32,
    #[serde(default = "default_status_pos")]
    pub status_pos: f32,
}

fn default_status_pos() -> f32 {
    500.0
}

pub fn default_scenes() -> Vec<SceneData> {
    vec![SceneData {
        background: String::new(),
        clock_pos: 0.0,
        status_pos: 500.0,
    }]
}

pub fn parse_list(text: &str) -> Result<Vec<SceneData>, String> {
    let scenes: Vec<SceneData> = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if scenes.is_empty() {
        Err("list.json has no scenes".into())
    } else {
        Ok(scenes)
    }
}

pub fn load_list(dir: &Path) -> Vec<SceneData> {
    let path = dir.join("list.json");
    match std::fs::read_to_string(&path)
        .map_err(|e| e.to_string())
        .and_then(|t| parse_list(&t))
    {
        Ok(scenes) => scenes,
        Err(e) => {
            eprintln!("{}: {e}", path.display());
            default_scenes()
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Stage {
    Ready { since: Instant },
    Transition { next: usize, since: Instant },
}

#[derive(Debug)]
pub struct Scenes {
    pub data: Vec<SceneData>,
    pub idx: usize,
    pub stage: Stage,
    /// +1 forward, -1 backward (kept for a future swipe gesture).
    pub dir: isize,
}

/// What to draw for the scenes at an instant.
#[derive(Debug, Clone, PartialEq)]
pub struct View {
    pub background: usize,
    /// The incoming background and the raw fade progress in [0, 1].
    pub next: Option<(usize, f32)>,
    /// Target positions; the UI eases toward them.
    pub clock_pos: f32,
    pub status_pos: f32,
}

impl Scenes {
    pub fn new(data: Vec<SceneData>, now: Instant) -> Self {
        let data = if data.is_empty() { default_scenes() } else { data };
        Self {
            data,
            idx: 0,
            stage: Stage::Ready { since: now },
            dir: 1,
        }
    }

    pub fn next_idx(&self) -> usize {
        let n = self.data.len() as isize;
        ((self.idx as isize + self.dir) % n + n) as usize % self.data.len()
    }

    /// Advances the timeline. `ready(i)` tells whether scene `i`'s image is loaded;
    /// a transition waits for it. Returns true when the stage changed.
    pub fn tick(&mut self, now: Instant, ready: impl Fn(usize) -> bool) -> bool {
        match self.stage {
            Stage::Ready { since } => {
                let next = self.next_idx();
                if self.data.len() > 1 && now >= since + SCENE_INTERVAL && ready(next) {
                    self.stage = Stage::Transition { next, since: now };
                    return true;
                }
            }
            Stage::Transition { next, since } => {
                if now >= since + TRANSITION {
                    self.idx = next;
                    self.stage = Stage::Ready { since: now };
                    return true;
                }
            }
        }
        false
    }

    /// When [`tick`](Self::tick) next needs to run.
    pub fn deadline(&self) -> Option<Instant> {
        match self.stage {
            Stage::Ready { since } if self.data.len() > 1 => Some(since + SCENE_INTERVAL),
            Stage::Ready { .. } => None,
            Stage::Transition { since, .. } => Some(since + TRANSITION),
        }
    }

    pub fn view(&self, now: Instant) -> View {
        match self.stage {
            Stage::Ready { .. } => {
                let s = &self.data[self.idx];
                View {
                    background: self.idx,
                    next: None,
                    clock_pos: s.clock_pos,
                    status_pos: s.status_pos,
                }
            }
            Stage::Transition { next, since } => {
                let s = &self.data[next];
                let t = (now.saturating_duration_since(since).as_secs_f32() / FADE.as_secs_f32()).min(1.0);
                View {
                    background: self.idx,
                    next: Some((next, t)),
                    clock_pos: s.clock_pos,
                    status_pos: s.status_pos,
                }
            }
        }
    }

    pub fn animating(&self) -> bool {
        matches!(self.stage, Stage::Transition { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> Vec<SceneData> {
        ["a.jpg", "b.jpg", "c.jpg"]
            .iter()
            .enumerate()
            .map(|(i, b)| SceneData {
                background: (*b).into(),
                clock_pos: i as f32 * 10.0,
                status_pos: i as f32 * 10.0,
            })
            .collect()
    }

    #[test]
    fn parses_list_json() {
        let s =
            parse_list(r#"[{"background":"a.jpg","clockPos":0,"statusPos":600},{"background":"b.png","clockPos":70}]"#)
                .unwrap();
        assert_eq!(
            s[0],
            SceneData {
                background: "a.jpg".into(),
                clock_pos: 0.0,
                status_pos: 600.0
            }
        );
        assert_eq!(s[1].status_pos, 500.0);
        assert!(parse_list("[]").is_err());
        assert!(parse_list("{}").is_err());
    }

    #[test]
    fn rotates_through_scenes_and_wraps() {
        let t0 = Instant::now();
        let mut s = Scenes::new(data(), t0);
        assert_eq!(s.deadline(), Some(t0 + SCENE_INTERVAL));
        assert!(!s.tick(t0 + Duration::from_secs(1), |_| true));

        let t1 = t0 + SCENE_INTERVAL;
        assert!(s.tick(t1, |_| true));
        assert_eq!(s.stage, Stage::Transition { next: 1, since: t1 });
        let v = s.view(t1 + Duration::from_millis(500));
        assert_eq!(v.background, 0);
        assert_eq!(v.next, Some((1, 0.5)));
        assert_eq!(v.clock_pos, 10.0);
        assert_eq!(s.view(t1 + Duration::from_millis(1200)).next, Some((1, 1.0)));

        let t2 = t1 + TRANSITION;
        assert!(s.tick(t2, |_| true));
        assert_eq!(s.idx, 1);
        assert_eq!(s.view(t2).next, None);

        s.idx = 2;
        assert_eq!(s.next_idx(), 0);
        s.dir = -1;
        s.idx = 0;
        assert_eq!(s.next_idx(), 2);
    }

    #[test]
    fn waits_for_next_image() {
        let t0 = Instant::now();
        let mut s = Scenes::new(data(), t0);
        assert!(!s.tick(t0 + SCENE_INTERVAL, |i| i != 1));
        assert!(s.tick(t0 + SCENE_INTERVAL * 2, |_| true));
    }

    #[test]
    fn single_scene_never_transitions() {
        let t0 = Instant::now();
        let mut s = Scenes::new(default_scenes(), t0);
        assert_eq!(s.deadline(), None);
        assert!(!s.tick(t0 + SCENE_INTERVAL * 3, |_| true));
    }
}
