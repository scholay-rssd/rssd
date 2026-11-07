//! Per-user OS vault; tokens are never returned to the renderer or stored in manuscripts.
use serde_json::{json,Value};
use tauri_plugin_dialog::DialogExt;
const SERVICE:&str="com.thomas.papr.today-editorial";
pub(crate) static CONNECTION_CHANGES:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());
fn service()->Result<String,String>{Ok(if crate::spaces::legacy(){SERVICE.to_string()}else{format!("{}.{}",SERVICE,crate::spaces::text("siteId")?)})}
pub(crate) fn site_service(site_id:&str,legacy:bool)->String{if legacy{SERVICE.to_string()}else{format!("{}.{}",SERVICE,site_id)}}
static TOKEN_CACHE:std::sync::OnceLock<crate::website_credentials::WebsiteCredentials>=std::sync::OnceLock::new();
static BACKGROUND_VAULT_LOADER:std::sync::OnceLock<BackgroundVaultLoader>=std::sync::OnceLock::new();
#[derive(Default)]
struct BackgroundVaultLoader {active:std::sync::Arc<std::sync::atomic::AtomicBool>}
struct BackgroundVaultGuard(std::sync::Arc<std::sync::atomic::AtomicBool>);
impl Drop for BackgroundVaultGuard {fn drop(&mut self){self.0.store(false,std::sync::atomic::Ordering::Release);}}
impl BackgroundVaultLoader {
    async fn credential<F>(&self,cache:&crate::website_credentials::WebsiteCredentials,service:&str,limit:std::time::Duration,load:F)->Result<Option<String>,String>
    where F:FnOnce()->Result<Option<String>,String>+Send+'static {
        if let Some(token)=cache.cached(service)?{return Ok(Some(token));}
        self.load(limit,load).await
    }
    async fn load<F>(&self,limit:std::time::Duration,load:F)->Result<Option<String>,String>
    where F:FnOnce()->Result<Option<String>,String>+Send+'static {
        use std::sync::atomic::Ordering;
        if self.active.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Ok(None);}
        let active=self.active.clone();
        let worker=tokio::task::spawn_blocking(move||{let _guard=BackgroundVaultGuard(active);load()});
        // Dropping a timed-out JoinHandle cannot stop SecItemCopyMatching.
        // Its guard stays inside the actual blocking worker until it returns,
        // so repeated recovery ticks never accumulate hung vault threads.
        match tokio::time::timeout(limit,worker).await {
            Ok(Ok(result))=>result,
            Ok(Err(_))|Err(_)=>Ok(None),
        }
    }
}
fn token_cache()->&'static crate::website_credentials::WebsiteCredentials { TOKEN_CACHE.get_or_init(Default::default) }
pub(crate) fn cached_token()->Result<Option<String>,String>{token_cache().cached(&service()?)}
pub fn read_token()->Result<Option<String>,String>{read_for(&service()?)}
pub(crate) fn read_for(service:&str)->Result<Option<String>,String>{token_cache().read(service,||read_vault(service))}
pub(crate) fn read_for_fresh(service:&str)->Result<Option<String>,String>{read_vault(service)}
pub(crate) fn read_for_background(service:&str)->Result<Option<String>,String>{background_credential(token_cache(),service,||read_vault_background(service))}
pub(crate) async fn read_for_background_bounded(service:&str)->Result<Option<String>,String>{
    let key=service.to_owned();
    BACKGROUND_VAULT_LOADER.get_or_init(Default::default).credential(token_cache(),service,std::time::Duration::from_secs(2),move||read_for_background(&key)).await
}
fn background_credential(cache:&crate::website_credentials::WebsiteCredentials,service:&str,load:impl FnOnce()->Result<Option<String>,String>)->Result<Option<String>,String>{
    if let Some(token)=cache.cached(service)?{return Ok(Some(token));}
    // Do not call cache.read(): its slot may be held by an interactive vault
    // dialog on another thread. This path must never wait for that dialog.
    load()
}
pub(crate) fn save_for(service:&str,token:&str)->Result<(),String>{token_cache().save(service,token,||save_vault(service,token))}
pub(crate) fn forget_for(service:&str)->Result<(),String>{token_cache().forget(service,||forget_vault(service))}
#[cfg(target_os="macos")]
fn read_vault(service:&str)->Result<Option<String>,String>{match security_framework::passwords::get_generic_password(service,"website"){Ok(v)=>String::from_utf8(v).map(Some).map_err(|_|"凭证格式无效".into()),Err(e) if e.code()==-25300=>Ok(None),Err(_)=>Err("无法读取系统钥匙串".into())}}
#[cfg(windows)]
fn read_vault(service:&str)->Result<Option<String>,String>{crate::windows_credentials::read(service).map_err(|_|"无法读取 Windows 凭据管理器")?.map(String::from_utf8).transpose().map_err(|_|"凭证格式无效".into())}
#[cfg(not(any(target_os="macos",windows)))]
fn read_vault(_service:&str)->Result<Option<String>,String>{Ok(None)}
#[cfg(target_os="macos")]
fn read_vault_background(service:&str)->Result<Option<String>,String>{
    use security_framework::item::{ItemClass,ItemSearchOptions,SearchResult};
    match ItemSearchOptions::new().class(ItemClass::generic_password()).service(service).account("website")
        .load_data(true).load_attributes(false).skip_authenticated_items(true).limit(1).search(){
        Ok(items)=>for item in items{if let SearchResult::Data(bytes)=item{return String::from_utf8(bytes).map(Some).map_err(|_|"凭证格式无效".into());}},
        // Locked, interaction-required and unavailable items remain queued.
        // Background recovery must never open a system authorization prompt.
        Err(_)=>return Ok(None),
    }
    Ok(None)
}
#[cfg(windows)]
fn read_vault_background(service:&str)->Result<Option<String>,String>{crate::windows_credentials::read(service).ok().flatten().map(String::from_utf8).transpose().map_err(|_|"凭证格式无效".into())}
#[cfg(not(any(target_os="macos",windows)))]
fn read_vault_background(_service:&str)->Result<Option<String>,String>{Ok(None)}
fn save_vault(service:&str,token:&str)->Result<(),String>{
    #[cfg(target_os="macos")] return security_framework::passwords::set_generic_password(service,"website",token.as_bytes()).map_err(|_|"无法保存到系统钥匙串".into());
    #[cfg(windows)] return crate::windows_credentials::save(service,token.as_bytes()).map_err(|_|"无法保存到 Windows 凭据管理器".into());
    #[cfg(not(any(target_os="macos",windows)))] {let _=(service,token);Err("此版本尚未提供 Linux 系统凭证存储".into())}
}
fn forget_vault(service:&str)->Result<(),String>{
    #[cfg(target_os="macos")] return match security_framework::passwords::delete_generic_password(service,"website"){Ok(())=>Ok(()),Err(e) if e.code()==-25300=>Ok(()),Err(_)=>Err("无法解除绑定".into())};
    #[cfg(windows)] return crate::windows_credentials::delete(service).map_err(|_|"无法解除绑定".into());
    #[cfg(not(any(target_os="macos",windows)))] {let _=service;Ok(())}
}
fn save(token:&str)->Result<(),String>{save_for(&service()?,token)}
fn forget()->Result<(),String>{forget_for(&service()?)}
// Settings only need existence, not the password. Do not trigger authorization
// simply by opening the local settings panel.
#[cfg(target_os="macos")]
fn credential_present()->Result<bool,String>{
    use security_framework::item::{ItemClass,ItemSearchOptions};
    let key=service()?;
    match ItemSearchOptions::new().class(ItemClass::generic_password()).service(&key).account("website")
        .load_attributes(true).load_data(false).skip_authenticated_items(true).search(){
        Ok(items)=>Ok(!items.is_empty()),
        Err(e) if e.code()==-25300=>Ok(false),
        Err(_)=>Err("无法检查系统钥匙串中的绑定状态".into())
    }
}
#[cfg(not(target_os="macos"))]
fn credential_present()->Result<bool,String>{Ok(read_token()?.is_some())}
async fn verify(token:&str)->Result<Value,String>{
    crate::publications::run("website-connection.mjs", "verify", json!({"token":token})).await
}
#[tauri::command]
pub async fn workbench_connection(_space: crate::spaces::Lease, webview:tauri::Webview,state:tauri::State<'_,crate::cursor_agent::CursorRuntime>,method:String,token:Option<String>)->Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    let _change=CONNECTION_CHANGES.lock().await;
    match method.as_str(){
        "status"=>Ok(json!({"configured":credential_present()?,"origin":crate::spaces::context()?["site"]["origin"],"siteId":crate::spaces::text("siteId")?,"vault":if cfg!(windows){"Windows 凭据管理器"}else if cfg!(target_os="macos"){"macOS 钥匙串"}else{"尚未支持"}})),
        "save"|"import"=>{let token=if method=="import" {
            let (tx,rx)=tokio::sync::oneshot::channel();
            webview.dialog().file().set_title("选择旧版纯文本令牌文件").set_parent(&webview.window()).pick_file(move|file|{let _=tx.send(file);});
            let Some(file)=rx.await.map_err(|_|"文件选择已关闭")? else{return Ok(json!({"cancelled":true}));};
            let path=file.into_path().map_err(|_|"请选择本地授权文件")?;
            if std::fs::metadata(&path).map_err(|_|"无法读取授权文件")?.len()>2049{return Err("授权文件过大".into());}
            Some(std::fs::read_to_string(path).map_err(|_|"无法读取授权文件")?)
        }else{token};let token=token.ok_or("请输入官网授权令牌")?;let token=token.trim();if token.len()<16||token.len()>2048||token.chars().any(|c|!c.is_ascii_graphic()){return Err("令牌格式无效".into());}let result=verify(token).await?;save(token)?;std::fs::write(std::path::Path::new(&crate::spaces::text("stateDirectory")?).join("website-vault-managed"),b"1").map_err(|_|"无法保存绑定状态")?;state.disconnect().await;Ok(result)},
        "test"=>verify(&read_token()?.ok_or("请先绑定官网凭证")?).await,
        "forget"=>{forget()?;std::fs::write(std::path::Path::new(&crate::spaces::text("stateDirectory")?).join("website-vault-managed"),b"1").map_err(|_|"无法保存绑定状态")?;state.disconnect().await;Ok(json!({"configured":false}))},
        _=>Err("Unknown connection operation".into())
    }
}

#[cfg(test)]
mod background_tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn authorization_recovery_reads_vault_changes_from_another_process(){
        let service=format!("scholay-tody.test.authorization.{}",uuid::Uuid::new_v4());
        struct Cleanup(String);
        impl Drop for Cleanup {fn drop(&mut self){let _=forget_for(&self.0);}}
        let _cleanup=Cleanup(service.clone());
        let pending=r#"{"ready":false}"#;
        let ready=r#"{"ready":true,"token":"synthetic"}"#;
        save_for(&service,pending).unwrap();
        // Another protocol process writes the exchanged result without this cache.
        save_vault(&service,ready).unwrap();
        assert_eq!(read_for(&service).unwrap().as_deref(),Some(pending));
        assert_eq!(read_for_fresh(&service).unwrap().as_deref(),Some(ready));
    }
    #[test]
    fn background_recovery_uses_only_the_matching_cached_service(){
        let cache=crate::website_credentials::WebsiteCredentials::default();cache.save("site-a","synthetic",||Ok(())).unwrap();
        assert_eq!(background_credential(&cache,"site-a",||panic!("must use cache")).unwrap().as_deref(),Some("synthetic"));
        assert_eq!(background_credential(&cache,"site-b",||Ok(None)).unwrap(),None);
    }
    #[test]
    fn background_recovery_does_not_wait_for_an_interactive_credential_read(){
        let cache=crate::website_credentials::WebsiteCredentials::default();
        let(started_tx,started_rx)=std::sync::mpsc::channel();let(finish_tx,finish_rx)=std::sync::mpsc::channel();
        std::thread::scope(|scope|{
            let borrowed=&cache;scope.spawn(move||borrowed.read("site-a",||{started_tx.send(()).unwrap();finish_rx.recv().unwrap();Ok(Some("later".into()))}));
            started_rx.recv().unwrap();assert_eq!(background_credential(&cache,"site-a",||Ok(None)).unwrap(),None);finish_tx.send(()).unwrap();
        });
    }
    #[tokio::test]
    async fn a_timed_out_vault_worker_remains_single_in_flight_until_it_really_finishes(){
        use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
        let loader=BackgroundVaultLoader::default();let calls=Arc::new(AtomicUsize::new(0));
        let(started_tx,started_rx)=tokio::sync::oneshot::channel();
        let(finish_tx,finish_rx)=std::sync::mpsc::channel();let count=calls.clone();
        let start=std::time::Instant::now();
        assert_eq!(loader.load(std::time::Duration::from_millis(25),move||{count.fetch_add(1,Ordering::Relaxed);let _=started_tx.send(());finish_rx.recv().unwrap();Ok(None)}).await.unwrap(),None);
        started_rx.await.unwrap();
        assert!(start.elapsed()<std::time::Duration::from_secs(1),"caller must not wait for the blocked OS loader");
        for _ in 0..4 {let count=calls.clone();assert_eq!(loader.load(std::time::Duration::from_millis(25),move||{count.fetch_add(1,Ordering::Relaxed);Ok(None)}).await.unwrap(),None);}
        assert_eq!(calls.load(Ordering::Relaxed),1);
        finish_tx.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1),async{while loader.active.load(Ordering::Acquire){tokio::task::yield_now().await;}}).await.unwrap();
        let count=calls.clone();assert_eq!(loader.load(std::time::Duration::from_secs(1),move||{count.fetch_add(1,Ordering::Relaxed);Ok(Some("synthetic".into()))}).await.unwrap().as_deref(),Some("synthetic"));
        assert_eq!(calls.load(Ordering::Relaxed),2);
    }
    #[tokio::test]
    async fn cached_credentials_remain_usable_while_the_global_os_loader_is_busy(){
        let loader=BackgroundVaultLoader::default();loader.active.store(true,std::sync::atomic::Ordering::Release);
        let cache=crate::website_credentials::WebsiteCredentials::default();cache.save("site-a","synthetic",||Ok(())).unwrap();
        assert_eq!(loader.credential(&cache,"site-a",std::time::Duration::from_millis(25),||panic!("cached token must bypass OS loader")).await.unwrap().as_deref(),Some("synthetic"));
        assert_eq!(loader.credential(&cache,"site-b",std::time::Duration::from_millis(25),||panic!("busy loader must not spawn another thread")).await.unwrap(),None);
    }
}
