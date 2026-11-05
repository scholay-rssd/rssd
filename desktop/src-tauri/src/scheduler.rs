//! The desktop refresh scheduler: a Tauri-aware wrapper around the UI-free
//! [`papr_core::ingestion::refresh::refresh_core`].
//!
//! `refresh_all` adds what only the desktop app needs — single-flight locking,
//! a progress channel to the webview, new-article notifications, FreshRSS sync
//! and tray/badge updates — while the actual fetch/parse/ingest pipeline lives
//! in `papr-core` so the agent CLI can drive the same code headlessly.

use crate::error::AppResult;
use crate::ingestion::refresh;
use crate::models::RefreshProgress;
use crate::state::AppState;
use crate::{notify, sync, tray};
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle, Emitter, Manager};

// Re-exported so existing callers (`commands`, `tray`) keep referring to
// `scheduler::RefreshScope`.
pub use refresh::RefreshScope;

/// Refresh feeds selected by `scope`, streaming per-feed progress over
/// `progress` when provided, then running the desktop-only tail: emit
/// `feeds-updated`, notify, reconcile with FreshRSS, and refresh the tray.
/// Returns the new-article count.
pub async fn refresh_all(
    app: &AppHandle,
    progress: Option<Channel<RefreshProgress>>,
    wait_if_busy: bool,
    scope: RefreshScope,
) -> AppResult<usize> {
    let mut cancellation=crate::spaces::refresh_cancellation();
    let Ok(_space) = crate::spaces::Lease::acquire() else { return Ok(0); };
    tokio::select! {
        result=refresh_in_space(app,progress,wait_if_busy,scope)=>result,
        _=cancellation.changed()=>Ok(0),
    }
}

async fn refresh_in_space(app:&AppHandle,progress:Option<Channel<RefreshProgress>>,wait_if_busy:bool,scope:RefreshScope)->AppResult<usize>{
    let state = app.state::<AppState>();

    // Only one refresh at a time: the manual command and the periodic scheduler
    // would otherwise duplicate every fetch. `wait_if_busy` callers (OPML
    // import) queue behind an in-flight run so their freshly added feeds still
    // get fetched; everyone else bows out cleanly.
    let _refresh_guard = if wait_if_busy {
        state.refresh_lock.lock().await
    } else {
        match state.refresh_lock.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                log::debug!("refresh already in progress; skipping this run");
                if let Some(p) = &progress {
                    let _ = p.send(RefreshProgress::Started { total: 0 });
                    let _ = p.send(RefreshProgress::Finished { new_articles: 0 });
                }
                return Ok(0);
            }
        }
    };

    let client = state.http();
    let summary = refresh::refresh_core(&state.db, &client, scope, |event| {
        if let Some(p) = &progress {
            let _ = p.send(event);
        }
    })
    .await?;

    // Background scheduler with nothing due this cycle: bow out before the
    // heavier tail (sync, notifications, tray) so an idle tick is genuinely idle.
    if !summary.ran {
        return Ok(0);
    }

    let total_new = summary.new_articles;
    let _ = app.emit("feeds-updated", total_new);

    notify::notify_new_articles(app, total_new).await;

    // Reconcile read/starred state with the sync server, if one is connected.
    // A sync mutates article state and may add feeds, so emit `feeds-updated`
    // again afterwards — the first emit fired before the sync touched the DB.
    match sync::run_if_connected(&state.db, &client).await {
        Ok(true) => {
            let _ = app.emit("feeds-updated", 0);
        }
        Ok(false) => {}
        Err(e) => log::warn!("sync failed: {e}"),
    }

    notify::update_badge(app).await;
    tray::refresh(app).await;
    Ok(total_new)
}

// Refresh registered inactive libraries without selecting them or emitting active-space
// UI events. A switch cancels this pass through the same lifecycle as normal refresh.
async fn refresh_inactive_spaces() -> Result<(), String> {
    let (_, data) = crate::workbench_runtime::paths()?;
    let bytes = tokio::fs::read(data.join("spaces.json")).await.map_err(|e|e.to_string())?;
    let registry: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
    let sites = registry["sites"].as_array().ok_or("Missing workspace registry")?;
    for site in sites {
        let Some(id) = site["spaceId"].as_str() else { continue; };
        if id.is_empty() || !id.bytes().all(|c|c.is_ascii_lowercase() || c.is_ascii_digit() || c==b'-') { continue; }
        let mut cancellation = crate::spaces::refresh_cancellation();
        let Ok(_lease) = crate::spaces::Lease::acquire() else { return Ok(()); };
        if crate::spaces::text("spaceId")?.as_str() == id { continue; }
        let dir = if site["legacy"].as_bool()==Some(true) { data.to_path_buf() } else { data.join("spaces").join(id) };
        let path = dir.join("papr.db");
        // Do not initialize a workspace merely because a profile is registered.
        if !path.is_file() { continue; }
        let db = match crate::db::open(&path) { Ok(db)=>db, Err(e)=>{log::warn!("inactive RSS {id}: {e}");continue;} };
        let client = crate::ingestion::fetch::build_client_from_settings(&db);
        let db = tokio::sync::Mutex::new(db);
        tokio::select! {
            result=refresh::refresh_core(&db,&client,RefreshScope::Due,|_|{})=>{
                if let Err(e)=result { log::warn!("inactive RSS {id}: {e}"); }
            }
            _=cancellation.changed()=>return Ok(()),
        }
    }
    Ok(())
}

/// How often the background loop wakes to look for *due* feeds. Each tick is a
/// cheap indexed query (and an early return when nothing is due), so a short,
/// fixed cadence keeps per-feed intervals honoured to within one tick.
const SCHEDULER_TICK: Duration = Duration::from_secs(60);

/// Spawn the background refresh loop. The app must stay resident (tray) for this
/// to run — macOS does not execute the process after the app is quit.
pub fn spawn_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        loop {
            if let Err(e) = refresh_all(&app, None, false, RefreshScope::Due).await {
                log::warn!("scheduled refresh failed: {e}");
            }
            if let Err(e)=refresh_inactive_spaces().await {
                log::warn!("inactive workspace refresh failed: {e}");
            }
            tokio::time::sleep(SCHEDULER_TICK).await;
        }
    });
}
