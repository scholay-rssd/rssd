//! Persistent opt-in for the local multi-site worker. No credential is saved.
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{fs,io::Write,path::Path};

fn inputs(home:&Path)->Result<Value,String>{
    let config=fs::read(home.join("multisite-config.json")).map_err(|_|"无法读取多站配置")?;
    let value:Value=serde_json::from_slice(&config).map_err(|_|"多站配置无效")?;
    if value["enabled"]!=true{return Err("多站配置尚未启用".into());}
    let connection:Value=serde_json::from_slice(&fs::read(home.join("connection.json")).map_err(|_|"无法读取中心连接")?).map_err(|_|"中心连接无效")?;
    if connection["disconnected"]==true{return Err("中心连接已退出".into());}
    let origin=connection["origin"].as_str().filter(|s|!s.is_empty()).ok_or("中心网址无效")?;
    let org=connection["identity"]["orgId"].as_str().filter(|s|!s.is_empty()).ok_or("中心身份无效")?;
    let worker=connection["identity"]["workerId"].as_str().filter(|s|!s.is_empty()).ok_or("中心设备身份无效")?;
    Ok(json!({"version":1,"wanted":true,"configHash":format!("{:x}",Sha256::digest(&config)),"origin":origin,"orgId":org,"workerId":worker}))
}
fn write(home:&Path,value:&Value)->Result<(),String>{
    fs::create_dir_all(home).map_err(|_|"无法创建中心目录")?;
    let temporary=home.join(format!(".multisite-intent-{}-{}.tmp",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"系统时间无效")?.as_nanos()));
    let mut options=fs::OpenOptions::new();options.write(true).create_new(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
    let mut file=options.open(&temporary).map_err(|_|"无法保存多站运行意图")?;
    let result=(||{file.write_all(&serde_json::to_vec(value).map_err(|_|"运行意图无效")?).map_err(|_|"无法保存多站运行意图")?;file.sync_all().map_err(|_|"无法保存多站运行意图")?;fs::rename(&temporary,home.join("multisite-intent.json")).map_err(|_|"无法保存多站运行意图")?;Ok(())})();
    if result.is_err(){let _=fs::remove_file(temporary);}result
}
pub fn enable(home:&Path)->Result<(),String>{write(home,&inputs(home)?)}
pub fn disable(home:&Path)->Result<(),String>{
    write(home,&json!({"version":1,"wanted":false}))
}
pub fn wanted(home:&Path)->Result<bool,String>{
    let saved:Value=match fs::read(home.join("multisite-intent.json")){Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(false),Err(_)=>return Err("无法读取多站运行意图".into()),Ok(bytes)=>serde_json::from_slice(&bytes).map_err(|_|"多站运行意图无效")?};
    if saved["version"]!=1{return Err("多站运行意图版本无效".into());}if saved["wanted"]==false{return Ok(false);}if saved["wanted"]!=true{return Err("多站运行意图无效".into());}
    if saved!=inputs(home)?{return Err("多站配置或中心身份已变更，请重新开启排程".into());}Ok(true)
}
pub fn delay(attempt:usize)->std::time::Duration{std::time::Duration::from_secs(*[5,15,30,300].get(attempt).unwrap_or(&300))}
pub fn can_recover(home:&Path)->bool{
    match fs::read(home.join("worker.json")){
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>true,
        Err(_)=>false,
        Ok(bytes)=>match serde_json::from_slice::<Value>(&bytes){Ok(worker)=>!(worker["mode"]=="multisite"&&worker["state"]=="blocked"),Err(_)=>false}
    }
}

#[cfg(test)] mod tests{
 use super::*;
 fn fixture()->std::path::PathBuf{static NEXT:std::sync::atomic::AtomicUsize=std::sync::atomic::AtomicUsize::new(0);let path=std::env::temp_dir().join(format!("rssd-intent-{}-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));fs::create_dir_all(&path).unwrap();fs::write(path.join("multisite-config.json"),br#"{"enabled":true}"#).unwrap();fs::write(path.join("connection.json"),br#"{"origin":"https://center.example","identity":{"orgId":"org","workerId":"worker"}}"#).unwrap();path}
 #[test] fn explicit_opt_in_is_bound_to_config_and_identity_and_stop_is_durable(){let p=fixture();assert!(!wanted(&p).unwrap());enable(&p).unwrap();assert!(wanted(&p).unwrap());let saved=fs::read_to_string(p.join("multisite-intent.json")).unwrap();assert!(!saved.contains("token"));fs::write(p.join("multisite-config.json"),br#"{"enabled":true,"changed":true}"#).unwrap();assert!(wanted(&p).is_err());disable(&p).unwrap();assert!(!wanted(&p).unwrap());fs::remove_dir_all(p).unwrap();}
 #[test] fn identity_change_is_not_authorized_by_old_intent(){let p=fixture();enable(&p).unwrap();fs::write(p.join("connection.json"),br#"{"origin":"https://center.example","identity":{"orgId":"other","workerId":"worker"}}"#).unwrap();assert!(wanted(&p).is_err());fs::remove_dir_all(p).unwrap();}
 #[test] fn restart_backoff_is_capped(){assert_eq!((0..6).map(|i|delay(i).as_secs()).collect::<Vec<_>>(),vec![5,15,30,300,300,300]);}
 #[test] fn crashed_worker_can_recover_but_explicit_block_or_corrupt_state_cannot(){let p=fixture();assert!(can_recover(&p));fs::write(p.join("worker.json"),br#"{"mode":"multisite","state":"working"}"#).unwrap();assert!(can_recover(&p));fs::write(p.join("worker.json"),br#"{"mode":"multisite","state":"blocked"}"#).unwrap();assert!(!can_recover(&p));fs::write(p.join("worker.json"),b"{").unwrap();assert!(!can_recover(&p));fs::remove_dir_all(p).unwrap();}
}
