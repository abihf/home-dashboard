# home-dashboard

A native Wayland dashboard for a small portrait touch screen: clock, system
status (CPU, temperature, memory, disks, network) and rotating background
images. It is built to run fullscreen under [cage](https://github.com/cage-kiosk/cage)
and draws with OpenGL ES through EGL ([femtovg](https://github.com/femtovg/femtovg)),
including the frosted-glass backdrop blur.

## Build

Needs a Rust toolchain (1.88+) and `libwayland-client` / `libwayland-egl`
(Debian/Ubuntu: `libwayland-dev`; Fedora: `wayland-devel`). At runtime it loads
`libEGL.so.1` and GLES from the system (Mesa via glvnd).

```bash
cargo build --release
```

The binary is `target/release/home-dashboard`. The font is embedded; background
images are read from disk at runtime.

## Run

```bash
BG_DIR=assets/bg cage -- target/release/home-dashboard
```

In a desktop session, `DASHBOARD_WINDOWED=1` skips the fullscreen request so it
opens as a normal window (the layout is designed for 600×1024 and scales with the
window width).

### Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `BG_DIR` | `assets/bg` | Directory with `list.json` and the background images |
| `MONITOR_NET_IFACE` | `eth1` | Interface for upload/download speed |
| `MONITOR_CPU_SENSOR` | `k10temp` | hwmon `name` used for the CPU temperature (`temp1_input`) |
| `MONITOR_DISK_ROOT` | `/` | First disk bar |
| `MONITOR_DISK_MEDIA` | `/media/data` | Second disk bar |
| `MONITOR_INTERVAL_MS` | `1000` | Sampling interval (min 100) |
| `DASHBOARD_WINDOWED` | unset | Don't request fullscreen |

`BG_DIR/list.json` lists the scenes, shown 20 s each with a 1 s crossfade:

```json
[
  { "background": "frieren.jpg", "clockPos": 100, "statusPos": 720 },
  { "background": "kikuri.jpg", "clockPos": 0, "statusPos": 500 }
]
```

`clockPos` / `statusPos` are the vertical offsets (in 600-px-wide layout units)
of the clock card and the status grid. Images (JPEG or PNG) are drawn at their
natural size from the top-left corner, scaled with the layout.

## Deploy (cage kiosk)

`deploy/` has the kiosk session used on the target machine:

- `deploy/labhf-gui` — picks the display GPU, rotates the output with
  `wlr-randr`, then runs cage with the dashboard (`GUI_APP`, default
  `/var/lib/labhf-bin/home-dashboard`). Install as `/usr/bin/labhf-gui`.
- `deploy/gui.service` — the systemd unit that runs it on tty1 as user `gui`.
  Machine-local overrides go in `/etc/labhf/gui.env` and
  `/etc/labhf/home-dashboard.env`.
- `deploy/gui.service.d-override.conf` — for an image-based (bootc) host whose
  read-only `/usr` still has the browser launcher: a drop-in that runs
  `/var/lib/labhf-bin/labhf-gui` instead.

The `gui` user must be able to reach every path it reads: `BG_DIR` and the
`MONITOR_DISK_*` mount points (`statvfs` fails on a path inside a `0700` home).

## Development

```bash
cargo test
cargo clippy --all-targets -- -D warnings
```

## Licences

- Code: LGPL-3.0-or-later.
- [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) font: SIL Open
  Font License 1.1 (`assets/fonts/OFL.txt`).
- Icons: [Heroicons](https://heroicons.com), MIT.
