//! Read-only access to Scholay's cloud cache. No TikHub token or collector
//! operation is exposed to the renderer, embedded websites, or MCP callers.
use serde_json::{json, Value};

#[tauri::command]
pub async fn pull_label_cloud(_space: crate::spaces::Lease, webview: tauri::Webview) -> Result<Value, String> {
    crate::hot_board::require_main(&webview)?;
    if crate::rssd_center::configured()? {
        return crate::rssd_center::rssd_center_call(webview,"labels".into(),None,None).await;
    }
    crate::publications::run("labels-cloud.mjs", "read", json!({})).await
}
