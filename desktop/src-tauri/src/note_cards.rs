//! Read-only manuscript derivatives, isolated from publication operations.
use serde_json::{json, Value};
use tauri::Webview;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

async fn run(method: &str, params: Value) -> Result<Value,String> {
    let input=serde_json::to_vec(&json!({"method":method,"params":params})).map_err(|e|e.to_string())?;
    if input.len()>26*1024*1024 {return Err("图文笔记内容过大".into());}
    let output=crate::workbench_process::output(
        &mut crate::workbench_runtime::command("desktop/scripts/note-cards.mjs")?,
        &input,std::time::Duration::from_secs(130)).await.map_err(|e|e.to_string())?;
    if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).chars().take(1000).collect());}
    serde_json::from_slice(&output.stdout).map_err(|_|"图文笔记返回格式错误".into())
}

#[tauri::command]
pub async fn note_cards_call(_space:crate::spaces::Lease,webview:Webview,method:String,params:Value)->Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    if !["render","page"].contains(&method.as_str()){return Err("Unknown note-card operation".into());}
    run(&method,params).await
}

#[tauri::command]
pub async fn note_cards_export(_space:crate::spaces::Lease,webview:Webview,id:String,source_hash:String,format:String,platform:String)->Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    // The renderer never supplies a destination or manuscript path.
    let root=crate::editorial::selected_root().await?;
    let (send,receive)=tokio::sync::oneshot::channel();
    webview.dialog().file().set_title("选择图文笔记图片的导出位置").set_parent(&webview.window()).pick_folder(move|folder|{let _=send.send(folder);});
    let Some(folder)=receive.await.map_err(|_|"导出位置选择未完成")? else{return Ok(Value::Null)};
    let directory=folder.into_path().map_err(|_|"请选择本地文件夹")?;
    let result=run("export",json!({"id":id,"sourceHash":source_hash,"format":format,"platform":platform,"directory":directory,"manuscriptRoot":root})).await?;
    if let Some(path)=result["directory"].as_str(){let _=webview.opener().open_path(path,None::<&str>);}
    Ok(result)
}
