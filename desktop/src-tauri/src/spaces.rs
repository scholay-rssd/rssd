//! Switch the active space only after all native work has released its lease.
use serde_json::Value;
use std::{path::Path, sync::{OnceLock, RwLock}};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
static CONTEXT:OnceLock<RwLock<Value>>=OnceLock::new();
mod lifecycle;
pub use lifecycle::{Lease,refresh_cancellation};
fn registry_command(root:&Path,data:&Path,method:&str,id:Option<&str>)->std::process::Command{
    let bundled=root.join(if cfg!(windows){"node.exe"}else{"node"});
    let node=if bundled.is_file(){bundled}else{std::path::PathBuf::from(if cfg!(target_os="macos"){"/opt/homebrew/opt/node@24/bin/node"}else{"node"})};
    let mut cmd=std::process::Command::new(node);cmd.arg(root.join("scripts/space-registry.mjs")).arg(method).arg(data);
    if let Some(id)=id{cmd.arg(id);}
    #[cfg(windows)] {use std::os::windows::process::CommandExt;cmd.creation_flags(0x08000000);}
    cmd
}
fn registry_output(output:std::process::Output)->Result<Value,String>{
    if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).chars().take(600).collect());}
    serde_json::from_slice(&output.stdout).map_err(|_|"空间配置格式无效".into())
}
// setup() runs before the event loop; every live-window caller uses async I/O.
fn call(root:&Path,data:&Path,method:&str,id:Option<&str>)->Result<Value,String>{
    registry_output(registry_command(root,data,method,id).output().map_err(|_|"无法初始化创作空间")?)
}
async fn call_async(root:&Path,data:&Path,method:&str,id:Option<&str>)->Result<Value,String>{
    let output=crate::workbench_process::output(
        &mut tokio::process::Command::from(registry_command(root,data,method,id)),
        &[],std::time::Duration::from_secs(10)).await
        .map_err(|error|if error.kind()==std::io::ErrorKind::TimedOut {"空间配置操作超时，请检查工作目录是否可用"}else{"无法读取创作空间配置"})?;
    registry_output(output)
}
async fn selection_committed(data:&Path,id:&str)->bool {
    tokio::fs::read(data.join("spaces.json")).await.ok()
        .and_then(|bytes|serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|registry|registry["activeSpaceId"].as_str()==Some(id))
}
pub fn init(root:&Path,data:&Path)->Result<(),String>{let context=call(root,data,"info",None)?;let _=CONTEXT.set(RwLock::new(context));Ok(())}
pub fn context()->Result<Value,String>{let mut value=CONTEXT.get().ok_or("空间尚未初始化")?.read().unwrap_or_else(|e|e.into_inner()).clone();value["runtimeEpoch"]=lifecycle::epoch().into();Ok(value)}
pub fn text(key:&str)->Result<String,String>{context()?.get(key).and_then(Value::as_str).map(str::to_owned).ok_or(format!("空间缺少 {}",key))}
pub fn legacy()->bool{context().ok().and_then(|v|v["site"]["legacy"].as_bool()).unwrap_or(false)}
#[tauri::command]
pub async fn space_context(_space: crate::spaces::Lease, webview:tauri::Webview)->Result<Value,String>{crate::hot_board::require_main(&webview)?;let (root,data)=crate::workbench_runtime::paths()?;let mut value=call_async(root,data,"refresh",Some(&text("spaceId")?)).await?;*CONTEXT.get().ok_or("空间尚未初始化")?.write().unwrap_or_else(|e|e.into_inner())=value.clone();value["runtimeEpoch"]=lifecycle::epoch().into();Ok(value)}
#[tauri::command]
pub async fn space_config(_space: crate::spaces::Lease, webview:tauri::Webview,method:String)->Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    let _change=crate::workbench_connection::CONNECTION_CHANGES.lock().await;
    let (tx,rx)=tokio::sync::oneshot::channel();
    let picker=webview.dialog().file().add_filter("站点配置",&["json"]).set_parent(&webview.window());
    match method.as_str(){
        "import"=>picker.set_title("导入已部署站点的配置").pick_file(move|file|{let _=tx.send(file);}),
        "export"=>picker.set_title("导出当前站点配置").set_file_name(format!("{}.site.json",text("siteId")?)).save_file(move|file|{let _=tx.send(file);}),
        _=>return Err("未知配置操作".into())
    }
    let Some(file)=rx.await.map_err(|_|"文件选择已关闭")? else{return Ok(serde_json::json!({"cancelled":true}));};
    let path=file.into_path().map_err(|_|"请选择本地文件")?;
    if method=="import"{
        if std::fs::metadata(&path).map_err(|_|"无法读取配置")?.len()>65536{return Err("站点配置过大".into());}
        let (root,data)=crate::workbench_runtime::paths()?;
        call_async(root,data,"import",Some(path.to_str().ok_or("文件路径无效")?)).await?;
        Ok(serde_json::json!({"message":"已导入站点配置，可以从创作空间列表切换；绑定时会验证服务器身份"}))
    }else{
        std::fs::write(path,serde_json::to_vec_pretty(&context()?["site"]).map_err(|_|"配置格式无效")?).map_err(|_|"无法保存配置")?;
        Ok(serde_json::json!({"message":"已导出当前空间与站点配置（不包含凭证、订阅或稿件）"}))
    }
}
#[tauri::command]
pub fn space_quiesce(_space:Lease,webview:tauri::Webview)->Result<(),String>{
    crate::hot_board::require_main(&webview)?;
    lifecycle::cancel_refresh();
    Ok(())
}
#[tauri::command]
pub async fn space_select(webview:tauri::Webview,space_id:String)->Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    let _switch = lifecycle::begin_switch().await?;
    if text("spaceId")?==space_id{return context();}
    let (root,data)=crate::workbench_runtime::paths()?;
    // Prepare everything before changing the persisted selection or active state.
    let next=call_async(root,data,"refresh",Some(&space_id)).await?;
    let dir=std::path::PathBuf::from(next["stateDirectory"].as_str().ok_or("空间目录无效")?);
    let prepare_dir=dir.clone();
    let legacy=next["site"]["legacy"].as_bool().unwrap_or(false);
    // Migrations, seed writes and SQLite busy waits must not occupy the async
    // executor that is also responsible for draining and closing old pages.
    let prepared=tauri::async_runtime::spawn_blocking(move||crate::state::AppState::open_space(&prepare_dir,legacy))
        .await.map_err(|error|format!("无法打开空间资料库：{error}"))??;
    crate::page_view::close_space_pages(webview.app_handle()).await?;
    if let Err(error)=call_async(root,data,"select",Some(&space_id)).await {
        // The child is reaped before call_async returns. If its atomic rename
        // succeeded but its reply did not arrive, finish the prepared switch
        // instead of leaving disk and the running app in different spaces.
        if !selection_committed(data,&space_id).await {return Err(error);}
    }
    webview.state::<crate::state::AppState>().replace(prepared).await;
    webview.state::<crate::hot_board::HotBoardState>().set_path(dir.join("hot-board.db"));
    *CONTEXT.get().ok_or("空间尚未初始化")?.write().unwrap_or_else(|e|e.into_inner())=next.clone();
    lifecycle::advance();
    crate::ai_formatted::clear_space_cache();
    crate::article_clean::clear_space_jobs();
    crate::workbench_exit::clear();
    crate::library_service::spawn(webview.app_handle().clone());
    crate::tray::refresh(webview.app_handle()).await;
    context()
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn lost_selection_reply_is_recovered_only_after_the_target_was_committed() {
        let data=std::env::temp_dir().join(format!("today-selection-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&data).unwrap();
        assert!(!super::selection_committed(&data,"pets").await);
        std::fs::write(data.join("spaces.json"),r#"{"activeSpaceId":"academic"}"#).unwrap();
        assert!(!super::selection_committed(&data,"pets").await);
        std::fs::write(data.join("spaces.json"),r#"{"activeSpaceId":"pets"}"#).unwrap();
        assert!(super::selection_committed(&data,"pets").await);
        std::fs::remove_dir_all(data).unwrap();
    }
}
