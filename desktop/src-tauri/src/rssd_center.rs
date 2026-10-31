//! The center credential is global to this PC and stored only in the OS vault.
use serde_json::{json,Value};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
const SERVICE:&str="com.thomas.papr.rssd-center.v1";
static CHANGES:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());

async fn credential()->Result<Option<String>,String>{tokio::task::spawn_blocking(||crate::workbench_connection::read_for(SERVICE)).await.map_err(|_|"无法读取中心凭据")?}
async fn save_credential(token:Option<String>)->Result<(),String>{tokio::task::spawn_blocking(move||match token{Some(value)=>crate::workbench_connection::save_for(SERVICE,&value),None=>crate::workbench_connection::forget_for(SERVICE)}).await.map_err(|_|"无法保存中心凭据")?}

#[tauri::command]
pub async fn rssd_center_call(webview:tauri::Webview,method:String,params:Option<Value>,token:Option<String>)->Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    if !["status","connect","registry","demands","works","work","publications","claim","release","submit","recover","start","stop","save_local","local_draft","delete_local"].contains(&method.as_str()){return Err("未知中心操作".into());}
    let _change=CHANGES.lock().await;
    let params=params.unwrap_or_else(||json!({}));
    let local=["status","stop","save_local","local_draft","delete_local"].contains(&method.as_str());
    let old=if local{None}else{credential().await?};
    let secret=if method=="connect"{Some(token.ok_or("请输入中心设备凭据")?)}else{old.clone()};
    if let Some(ref value)=secret{if !value.starts_with("rssd_device_")||value.len()!=60||!value.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'){return Err("中心设备凭据格式无效".into());}}
    if !local&&secret.is_none(){return Err("请先连接 RSSD 中心".into());}
    let mut command=crate::workbench_runtime::command("desktop/scripts/rssd-center.mjs")?;
    if let Some(ref value)=secret{command.env("RSSD_CENTER_TOKEN",value);}else{command.env_remove("RSSD_CENTER_TOKEN");}
    let mut input=serde_json::to_vec(&json!({"method":method,"params":params})).map_err(|_|"中心请求无效")?;
    if input.len()>24*1024*1024{return Err("中心请求过大".into());}input.push(b'\n');
    if method=="start"{
        let (_,data)=crate::workbench_runtime::paths()?;let home=data.join("center");std::fs::create_dir_all(&home).map_err(|_|"无法创建中心运行目录")?;
        let log=std::fs::OpenOptions::new().create(true).append(true).open(home.join("worker.log")).map_err(|_|"无法记录工作状态")?;
        let mut child=command.arg("--worker").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::from(log)).spawn().map_err(|_|"无法启动中心工作实例")?;
        let pid=child.id();let mut stdin=child.stdin.take().ok_or("无法连接工作实例")?;
        stdin.write_all(&input).await.map_err(|_|"工作实例启动中断")?;stdin.shutdown().await.map_err(|_|"工作实例启动中断")?;drop(stdin);
        tokio::spawn(async move{let _=child.wait().await;});return Ok(json!({"state":"starting","pid":pid}));
    }
    if method=="connect"{save_credential(secret.clone()).await?;}
    let output=crate::workbench_process::output(&mut command,&input,std::time::Duration::from_secs(90)).await;
    let result=match output{Ok(out) if out.status.success()=>serde_json::from_slice(&out.stdout).map_err(|_|"中心响应格式无效".into()),Ok(out)=>Err(String::from_utf8_lossy(&out.stderr).chars().take(1200).collect()),Err(_)=>Err("中心请求暂未完成，已提交内容请查询原请求".into())};
    if method=="connect"&&result.is_err(){save_credential(old).await?;}
    result
}
