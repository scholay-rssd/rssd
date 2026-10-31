//! Keeps the main window inside its monitor.
//!
//! The window-state plugin stores the size in physical pixels. With displays of
//! different scale factors attached (a 2× 4K next to a 1× 1080p) it can restore
//! that size against the wrong scale, leaving a window twice as wide as the
//! screen that has to be dragged back by hand. This runs after the restore and
//! whenever the scale factor changes, and puts an oversized window back.

use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

/// The size (physical px) an oversized window should take on a monitor, or
/// `None` when it already fits. A dimension that only overflows because it was
/// applied without the monitor's scale factor is divided back; anything still
/// too large is clamped to the monitor.
pub fn fitted(w: u32, h: u32, mon_w: u32, mon_h: u32, scale: f64) -> Option<(u32, u32)> {
    let fix = |v: u32, m: u32| {
        if v <= m {
            return v;
        }
        let unscaled = (v as f64 / scale).round() as u32;
        if scale > 1.0 && unscaled > 0 && unscaled <= m { unscaled } else { m }
    };
    let next = (fix(w, mon_w), fix(h, mon_h));
    (next != (w, h)).then_some(next)
}

/// The main window's size as the window-state plugin last saved it (physical px).
fn saved_size(app: &AppHandle) -> Option<(u32, u32)> {
    let path = app.path().app_config_dir().ok()?.join(".window-state.json");
    let state: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let main = state.get("main")?;
    Some((main.get("width")?.as_u64()? as u32, main.get("height")?.as_u64()? as u32))
}

fn apply(win: &WebviewWindow, saved: Option<(u32, u32)>) {
    if win.is_fullscreen().unwrap_or(false) || win.is_maximized().unwrap_or(false) {
        return;
    }
    let Ok(size) = win.outer_size() else { return };
    let monitor = match win.current_monitor() {
        Ok(Some(m)) => m,
        _ => match win.primary_monitor() {
            Ok(Some(m)) => m,
            _ => return,
        },
    };
    let (mon_size, mon_pos) = (monitor.size(), monitor.position());
    let Some(clamped) = fitted(size.width, size.height, mon_size.width, mon_size.height, monitor.scale_factor()) else {
        return;
    };
    // A mis-scaled restore also gets its height cut to the screen by the OS, so
    // the saved size, when it fits this monitor, is the one the user had.
    let (w, h) = saved.filter(|(w, h)| *w <= mon_size.width && *h <= mon_size.height).unwrap_or(clamped);
    let _ = win.set_size(PhysicalSize::new(w, h));
    if let Ok(pos) = win.outer_position() {
        let x = pos.x.clamp(mon_pos.x, mon_pos.x + (mon_size.width as i32 - w as i32).max(0));
        let y = pos.y.clamp(mon_pos.y, mon_pos.y + (mon_size.height as i32 - h as i32).max(0));
        if (x, y) != (pos.x, pos.y) {
            let _ = win.set_position(PhysicalPosition::new(x, y));
        }
    }
}

fn apply_on_main(win: &WebviewWindow, saved: Option<(u32, u32)>) {
    let target = win.clone();
    let _ = win.run_on_main_thread(move || apply(&target, saved));
}

pub fn install(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let saved = saved_size(app);
    apply(&win, saved);
    let observed = win.clone();
    win.on_window_event(move |event| {
        if matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
            apply_on_main(&observed, None);
        }
    });
    // The plugin's restore and macOS's own placement can land after setup.
    for delay in [400u64, 1500] {
        let win = win.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay));
            apply_on_main(&win, saved);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::fitted;

    #[test]
    fn leaves_a_window_that_fits_alone() {
        assert_eq!(fitted(3464, 2100, 3840, 2160, 2.0), None);
    }

    #[test]
    fn divides_back_a_width_restored_without_the_scale_factor() {
        // 3464 physical px restored as 3464 points on a 2× display = 6928 px.
        assert_eq!(fitted(6928, 2100, 3840, 2160, 2.0), Some((3464, 2100)));
    }

    #[test]
    fn clamps_what_is_still_too_large() {
        assert_eq!(fitted(9000, 5000, 3840, 2160, 2.0), Some((3840, 2160)));
        assert_eq!(fitted(3464, 2100, 1920, 1080, 1.0), Some((1920, 1080)));
    }
}
