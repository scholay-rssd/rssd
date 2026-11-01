//! Read-only platform/catalog operations and a separate main-window publisher.
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool,Ordering};
static QUEUE_RECOVERY_ACTIVE:AtomicBool=AtomicBool::new(false);
static QUEUE_RECOVERY_LAST:std::sync::Mutex<Option<std::time::Instant>>=std::sync::Mutex::new(None);
struct QueueRecoveryGuard;
impl Drop for QueueRecoveryGuard {fn drop(&mut self){QUEUE_RECOVERY_ACTIVE.store(false,Ordering::Release);}}

#[tauri::command]
pub async fn publications_call(_space: crate::spaces::Lease, webview: tauri::Webview, method: String, params: Option<Value>) -> Result<Value, String> {
    crate::hot_board::require_main(&webview)?;
    if !["snapshot", "refresh_feishu", "refresh_website", "site_calendar", "legacy_calendar"].contains(&method.as_str()) {
        return Err("Unknown publication center operation".into());
    }
    run("publication-center.mjs", &method, params.unwrap_or_else(||json!({}))).await
}

// Deliberately not exposed through the manuscript MCP permission.
#[tauri::command]
pub async fn website_publish_call(_space: crate::spaces::Lease, webview: tauri::Webview, method: String, params: Value) -> Result<Value, String> {
    crate::hot_board::require_main(&webview)?;
    if method=="queue_resume_pending" {drop(_space);return resume_pending_queue().await;}
    if !["queue_status", "reconcile", "snapshot", "inspect", "prepare", "publish", "save_cloud", "status", "refresh", "pull", "accept_merge", "published", "cloud", "private_notes", "cloud_action", "cloud_action_status", "cloud_action_cached", "local_action"].contains(&method.as_str()) {
        return Err("Unknown website publishing operation".into());
    }
    if ["publish", "save_cloud"].contains(&method.as_str()) && params.get("confirmed").and_then(Value::as_bool) != Some(true) {
        return Err("请在预览后明确确认推送到官网。".into());
    }
    if (method == "cloud_action" || (method == "local_action" && matches!(params.get("action").and_then(Value::as_str), Some("delete" | "discard_pull")))) && params.get("confirmed").and_then(Value::as_bool) != Some(true) {
        return Err("请明确确认作品操作".into());
    }
    run("website-publisher.mjs", &method, params).await
}

pub(crate) async fn run(script_name: &str, method: &str, params: Value) -> Result<Value, String> {
    // Catalogue/detail reads may wait on a slow network for up to 180s,
    // longer than space preparation's 15s budget. Cancel only these reads;
    // saves, publication and reconciliation must reach a definite outcome.
    let cancellation = if cancellable_read(script_name, method) {
        Some(crate::spaces::refresh_cancellation())
    } else { None };
    let recovery_read=script_name=="website-publisher.mjs" && method=="local_action" && params.get("action").and_then(Value::as_str)==Some("recover_deleted");
    let mut input = serde_json::to_vec(&json!({"method":method,"params":params})).map_err(|e|e.to_string())?;
    let limit=if script_name=="space-authorization.mjs"{96*1024}else{20_000};
    if input.len() > limit { return Err("请求过大".into()); }
    input.push(b'\n');
    let mut command = crate::workbench_runtime::command(&format!("desktop/scripts/{}",script_name))?;
    let needs_credential = needs_website_credential(script_name, method) || recovery_read;
    let center_enabled = center_script(script_name) && crate::rssd_center::configured()?;
    let token = if center_enabled && needs_credential {
        crate::rssd_center::credential().await?
    } else if center_enabled && method == "reconcile" {
        crate::rssd_center::background_credential().await?
    } else if needs_credential {
        tokio::task::spawn_blocking(crate::workbench_connection::read_token).await
            .map_err(|_| "无法读取官网凭证")??
    } else if script_name == "website-publisher.mjs" && method == "reconcile" {
        crate::workbench_connection::cached_token()?
    } else { None };
    if let Some(token) = token { command.env(if center_enabled {"RSSD_CENTER_TOKEN"} else {"SCHOLAY_TODAY_TOKEN"}, token); }
    let limit=if script_name=="workspace-location.mjs" && method=="info" {10}else{180};
    let output = crate::workbench_process::output_cancellable(&mut command, &input, std::time::Duration::from_secs(limit), cancellation).await
        .map_err(|error| if error.kind()==std::io::ErrorKind::TimedOut {"操作超时。如已推送，请先查询原任务，勿重新生成预览。".into()} else {error.to_string()})?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).chars().take(1000).collect()); }
    serde_json::from_slice(&output.stdout).map_err(|_| "发布中心返回格式异常。".into())
}

fn cancellable_read(script: &str, method: &str) -> bool {
    match script {
        "publication-center.mjs" => matches!(method, "snapshot" | "refresh_website" | "site_calendar"),
        "website-publisher.mjs" => matches!(method, "snapshot" | "queue_status" | "published" | "cloud" | "private_notes"),
        _ => false,
    }
}

async fn queue_recovery_command(method:&str,params:Value,token:Option<&str>)->Result<Value,String>{
    let mut command=crate::workbench_runtime::command("scripts/publication-queue-recover.mjs")?;
    if method=="resume" {
        command.env("SCHOLAY_EDITORIAL_ROOT",params["root"].as_str().ok_or("后台工作区无效")?)
            .env("SCHOLAY_SITE_JSON",params["site"].to_string())
            .env("SCHOLAY_SITE_ID",params["site"]["id"].as_str().ok_or("后台站点身份无效")?)
            .env_remove("SCHOLAY_SITE_CONFIG");
    }
    if let Some(token)=token {command.env(if crate::rssd_center::configured()? {"RSSD_CENTER_TOKEN"}else{"SCHOLAY_TODAY_TOKEN"},token);}
    let mut input=serde_json::to_vec(&json!({"method":method,"params":params})).map_err(|_|"后台恢复请求无效")?;input.push(b'\n');
    let output=crate::workbench_process::output(&mut command,&input,std::time::Duration::from_secs(10)).await.map_err(|_|"后台任务恢复暂时不可用")?;
    if !output.status.success(){return Err("后台任务恢复暂时不可用，原任务已保留".into());}
    serde_json::from_slice(&output.stdout).map_err(|_|"后台任务恢复响应无效".into())
}
async fn resume_pending_queue()->Result<Value,String>{
    if QUEUE_RECOVERY_ACTIVE.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Ok(json!({"started":false,"busy":true}));}
    let _guard=QueueRecoveryGuard;
    {
        let mut last=QUEUE_RECOVERY_LAST.lock().map_err(|_|"后台恢复状态不可用")?;
        if last.is_some_and(|at|at.elapsed()<std::time::Duration::from_secs(60)){return Ok(json!({"started":false,"throttled":true}));}
        *last=Some(std::time::Instant::now());
    }
    let result=queue_recovery_command("candidates",json!({}),None).await?;
    let center_enabled=crate::rssd_center::configured()?;
    let center_token=if center_enabled{crate::rssd_center::background_credential().await?}else{None};
    let mut credentials:std::collections::HashMap<String,Option<String>>=std::collections::HashMap::new();
    let(mut resumed,mut attention)=(0usize,0usize);
    for candidate in result["candidates"].as_array().into_iter().flatten(){
        let site=&candidate["site"];
        let Some(site_id)=site["id"].as_str() else{attention+=1;continue;};
        let legacy=site["legacy"].as_bool().unwrap_or(false);
        if site_id.len()>50||site_id.is_empty()||!site_id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-')||legacy&&site_id!="scholay-today" {attention+=1;continue;}
        let service=crate::workbench_connection::site_service(site_id,legacy);
        if !center_enabled && !credentials.contains_key(&service){
            let token=crate::workbench_connection::read_for_background_bounded(&service).await?;
            credentials.insert(service.clone(),token);
        }
        let Some(token)=(if center_enabled {center_token.as_deref()}else{credentials.get(&service).and_then(Option::as_deref)}) else{attention+=1;continue;};
        let params=json!({"id":candidate["id"],"root":candidate["root"],"site":site});
        if queue_recovery_command("resume",params,Some(token)).await.is_ok(){resumed+=1;}else{attention+=1;}
    }
    Ok(json!({"started":true,"resumed":resumed,"attention":attention}))
}

// Opening local work must not prompt for website credentials. Recovery may reuse
// this site's credential only after an explicit cloud operation in this session.
fn center_script(script:&str)->bool {matches!(script,"publication-center.mjs"|"website-publisher.mjs")}
fn needs_website_credential(script: &str, method: &str) -> bool {
    (script == "publication-center.mjs" && method == "refresh_website") ||
    (script == "website-publisher.mjs" && ["prepare", "publish", "save_cloud", "status", "refresh", "pull", "accept_merge", "published", "cloud", "private_notes", "cloud_export", "cloud_action", "cloud_action_status"].contains(&method)) ||
    (script == "labels-cloud.mjs" && method == "read")
}
#[cfg(test)]
mod tests {
    use super::needs_website_credential;
    #[test]
    fn switching_cancels_catalog_reads_but_never_editor_or_publication_writes() {
        for method in ["snapshot", "refresh_website", "site_calendar"] {
            assert!(super::cancellable_read("publication-center.mjs", method));
        }
        for method in ["snapshot", "queue_status", "published", "cloud", "private_notes"] {
            assert!(super::cancellable_read("website-publisher.mjs", method));
        }
        for method in ["prepare", "save_cloud", "publish", "reconcile", "pull", "accept_merge", "local_action", "cloud_action", "cloud_action_status", "status"] {
            assert!(!super::cancellable_read("website-publisher.mjs", method));
        }
        assert!(!super::cancellable_read("editorial-workspace.mjs", "draft_save"));
    }
    #[test]
    fn local_work_does_not_open_vault() {
        for method in ["snapshot", "inspect", "queue_status", "queue_resume_pending", "local_action", "cloud_action_cached", "reconcile"] {
            assert!(!needs_website_credential("website-publisher.mjs", method));
        }
        assert!(!needs_website_credential("publication-center.mjs", "site_calendar"));
        assert!(!needs_website_credential("space-authorization.mjs", "verify"));
        assert!(needs_website_credential("website-publisher.mjs", "publish"));
        assert!(needs_website_credential("website-publisher.mjs", "prepare"));
        assert!(needs_website_credential("website-publisher.mjs", "cloud_export"));
        assert!(needs_website_credential("publication-center.mjs", "refresh_website"));
        assert!(needs_website_credential("labels-cloud.mjs", "read"));
        assert!(!needs_website_credential("labels-cloud.mjs", "collect"));
        assert!(super::center_script("website-publisher.mjs"));
        assert!(super::center_script("publication-center.mjs"));
        assert!(!super::center_script("space-authorization.mjs"));
    }
}
