//! The center credential is global to this PC and stored only in the OS vault.
use serde_json::{json,Value};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use std::sync::atomic::{AtomicBool,Ordering};
const SERVICE:&str="com.thomas.papr.rssd-center.v1";
static CHANGES:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());
static UPDATING:AtomicBool=AtomicBool::new(false);
static WORKER_ACTIVE:AtomicBool=AtomicBool::new(false);

pub(crate) async fn credential()->Result<Option<String>,String>{tokio::task::spawn_blocking(||crate::workbench_connection::read_for(SERVICE)).await.map_err(|_|"无法读取中心凭据")?}
pub(crate) async fn background_credential()->Result<Option<String>,String>{crate::workbench_connection::read_for_background_bounded(SERVICE).await}
async fn save_credential(token:Option<String>)->Result<(),String>{tokio::task::spawn_blocking(move||match token{Some(value)=>crate::workbench_connection::save_for(SERVICE,&value),None=>crate::workbench_connection::forget_for(SERVICE)}).await.map_err(|_|"无法保存中心凭据")?}

pub(crate) fn configured()->Result<bool,String>{let (_,data)=crate::workbench_runtime::paths()?;Ok(data.join("center/connection.json").try_exists().map_err(|_|"无法读取中心连接配置")?)}

#[tauri::command]
pub async fn rssd_center_call(webview:tauri::Webview,method:String,params:Option<Value>,token:Option<String>)->Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    if !["status","connect","registry","demands","works","work","publications","labels","claim","release","submit","recover","start","stop","save_local","local_draft","delete_local","prepare_update","cancel_update"].contains(&method.as_str()){return Err("未知中心操作".into());}
    let _change=CHANGES.lock().await;
    if method=="cancel_update"{UPDATING.store(false,Ordering::SeqCst);return Ok(json!({"cancelled":true}));}
    if method=="prepare_update"&&WORKER_ACTIVE.load(Ordering::SeqCst){return Err("中心生产任务仍在运行，请先停止领取并等待本单完成后安装更新".into());}
    if method=="start"&&(UPDATING.load(Ordering::SeqCst)||WORKER_ACTIVE.load(Ordering::SeqCst)){return Err("正在准备更新或已有生产实例运行，暂不能启动新实例".into());}
    let params=params.unwrap_or_else(||json!({}));
    let local=["status","stop","save_local","local_draft","delete_local","prepare_update"].contains(&method.as_str());
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
        WORKER_ACTIVE.store(true,Ordering::SeqCst);
        tokio::spawn(async move{let _=child.wait().await;WORKER_ACTIVE.store(false,Ordering::SeqCst);});
        stdin.write_all(&input).await.map_err(|_|"工作实例启动中断")?;stdin.shutdown().await.map_err(|_|"工作实例启动中断")?;drop(stdin);
        return Ok(json!({"state":"starting","pid":pid}));
    }
    if method=="connect"{save_credential(secret.clone()).await?;}
    let output=crate::workbench_process::output(&mut command,&input,std::time::Duration::from_secs(90)).await;
    let result=match output{Ok(out) if out.status.success()=>serde_json::from_slice(&out.stdout).map_err(|_|"中心响应格式无效".into()),Ok(out)=>Err(String::from_utf8_lossy(&out.stderr).chars().take(1200).collect()),Err(_)=>Err("中心请求暂未完成，已提交内容请查询原请求".into())};
    if method=="connect"&&result.is_err(){save_credential(old).await?;}
    if method=="prepare_update"&&result.is_ok(){UPDATING.store(true,Ordering::SeqCst);}
    result
}
