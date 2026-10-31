//! Route menu, tray and OS quit through the mounted workbench's save guard.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

static GUARDED: AtomicBool = AtomicBool::new(false);
static FINISHING: AtomicBool = AtomicBool::new(false);
static DRAINING: AtomicBool = AtomicBool::new(false);

pub fn clear(){GUARDED.store(false, Ordering::Release);}

#[tauri::command]
pub fn workbench_exit_guard(_space: crate::spaces::Lease, webview: tauri::Webview, enabled: bool) -> Result<(), String> {
    crate::hot_board::require_main(&webview)?;
    GUARDED.store(enabled, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub async fn workbench_finish_exit(_space: crate::spaces::Lease, webview: tauri::Webview, state:tauri::State<'_,crate::cursor_agent::CursorRuntime>) -> Result<(), String> {
    crate::hot_board::require_main(&webview)?;
    GUARDED.store(false, Ordering::Release);
    state.disconnect_all().await;
    FINISHING.store(true,Ordering::Release);
    webview.app_handle().exit(0);
    Ok(())
}

pub fn request(app: &tauri::AppHandle, api: &tauri::ExitRequestApi) {
    if FINISHING.load(Ordering::Acquire){return;}
    if !GUARDED.load(Ordering::Acquire) {
        // The global queue can be active before the writing pane has mounted.
        // Drain every coordinator even when no editor exit guard is installed.
        api.prevent_exit();
        if DRAINING.swap(true,Ordering::AcqRel){return;}
        let app=app.clone();
        tauri::async_runtime::spawn(async move{app.state::<crate::cursor_agent::CursorRuntime>().disconnect_all().await;FINISHING.store(true,Ordering::Release);app.exit(0);});
        return;
    }
    api.prevent_exit();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit_to("main", "workbench-exit-requested", ());
}
