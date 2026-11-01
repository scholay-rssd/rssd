//! Native authorization: the renderer never receives PKCE verifiers or tokens.
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use tauri_plugin_opener::OpenerExt;
use base64::{Engine,engine::general_purpose::URL_SAFE_NO_PAD};
const SERVICE:&str="com.thomas.papr.rssd-center.v1.authorization";
const CALLBACK:&str="papr://center-auth";
static LOCK:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());
static RESULT:std::sync::Mutex<Option<Value>>=std::sync::Mutex::new(None);
static COMPLETED:std::sync::Mutex<Option<String>>=std::sync::Mutex::new(None);
fn text<'a>(value:&'a Value,key:&str)->Result<&'a str,String>{value[key].as_str().ok_or_else(||"授权响应无效".into())}
fn now()->u64{std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()}
fn origin(value:&str)->Result<String,String>{let url=url::Url::parse(value).map_err(|_|"中心网址无效")?;if url.scheme()!="https"||url.host_str().is_none()||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some()||!matches!(url.path(),""|"/"){return Err("中心地址必须是 HTTPS 域名".into());}Ok(url.origin().ascii_serialization())}
async fn request(origin:&str,path:&str,body:Value)->Result<Value,String>{
 let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(30)).build().map_err(|_|"无法连接中心")?;
 let response=client.post(format!("{origin}/api/rssd/v1/auth/{path}")).json(&body).send().await.map_err(|_|"中心连接中断，请重试授权")?;
 let ok=response.status().is_success();let data:Value=response.json().await.map_err(|_|"授权响应无效")?;
 if !ok{return Err(data["message"].as_str().unwrap_or("中心拒绝了授权请求").to_string());}Ok(data)
}
pub(crate) fn status()->Value{let value=RESULT.lock().ok().and_then(|r|r.clone()).unwrap_or(json!({"state":"idle"}));if value["state"]=="waiting"&&value["expires"].as_u64().unwrap_or(0)<=now(){return json!({"state":"expired","message":"授权请求已过期，请重新登录"});}value}
fn report(value:Value){if let Ok(mut state)=RESULT.lock(){*state=Some(value);}}
pub(crate) async fn begin(app:&tauri::AppHandle,params:Value)->Result<Value,String>{
 let _lock=LOCK.lock().await;
 crate::rssd_center::ensure_connection_idle().await?;
 let center=origin(text(&params,"origin")?)?;
 let verifier=format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple());
 let state=format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple());
 let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
 let response=request(&center,"start",json!({"mode":"desktop","name":params["name"].as_str().unwrap_or("RSSD Desktop"),"redirectUri":CALLBACK,"codeChallengeMethod":"S256","codeChallenge":challenge,"state":state})).await?;
 let verification=text(&response,"verificationUriComplete")?.to_string();let parsed=url::Url::parse(&verification).map_err(|_|"授权地址无效")?;
 if parsed.origin().ascii_serialization()!=center||parsed.path()!="/rssd/authorize"{return Err("中心返回了不匹配的授权地址".into());}
 let session=json!({"origin":center,"verifier":verifier,"state":state,"expires":now()+300}).to_string();
 tokio::task::spawn_blocking(move||crate::workbench_connection::save_for(SERVICE,&session)).await.map_err(|_|"无法保存授权请求")??;
 report(json!({"state":"waiting","expires":now()+300,"message":"请在浏览器确认设备授权"}));
 if app.opener().open_url(&verification,None::<&str>).is_err(){report(json!({"state":"error","message":"无法打开浏览器，请重试"}));return Err("无法打开浏览器，请重试".into());}
 Ok(json!({"state":"waiting"}))
}
pub(crate) async fn cancel()->Result<Value,String>{let _lock=LOCK.lock().await;tokio::task::spawn_blocking(||crate::workbench_connection::forget_for(SERVICE)).await.map_err(|_|"无法取消授权")??;report(json!({"state":"cancelled"}));Ok(status())}
pub(crate) fn callback(app:&tauri::AppHandle,raw:&str)->bool{
 let Ok(url)=url::Url::parse(raw) else{return false};
 if url.scheme()!="papr"||url.host_str()!=Some("center-auth")||!matches!(url.path(),""|"/"){return false;}
 let raw=raw.to_string();let app=app.clone();
 tauri::async_runtime::spawn(async move{
  if let Err(message)=complete(&raw).await{report(json!({"state":"error","message":message}));}
  use tauri::Manager;
  if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.unminimize();let _=window.set_focus();}
 });true
}
async fn complete(raw:&str)->Result<(),String>{
 let _lock=LOCK.lock().await;
 let callback_hash=format!("{:x}",Sha256::digest(raw.as_bytes()));
 if COMPLETED.lock().ok().and_then(|v|v.clone()).as_deref()==Some(callback_hash.as_str()){return Ok(());}
 let value=tokio::task::spawn_blocking(||crate::workbench_connection::read_for(SERVICE)).await.map_err(|_|"无法读取授权请求")??.ok_or("没有待完成的授权请求，请重新登录")?;
 let session:Value=serde_json::from_str(&value).map_err(|_|"授权请求无效")?;
 let url=url::Url::parse(raw).map_err(|_|"授权回调无效")?;
 let pairs:Vec<_>=url.query_pairs().collect();
 let field=|key:&str|->Result<String,String>{let values:Vec<_>=pairs.iter().filter(|(k,_)|k==key).collect();if values.len()!=1{return Err("授权回调无效".into());}Ok(values[0].1.to_string())};
 if field("state")?!=text(&session,"state")?||session["expires"].as_u64().unwrap_or(0)<=now(){return Err("授权请求已过期或不匹配，请重新登录".into());}
 if session["ready"]==true{return install_ready().await;}
 if pairs.iter().any(|(k,_)|k=="error"){
  tokio::task::spawn_blocking(||crate::workbench_connection::forget_for(SERVICE)).await.map_err(|_|"无法清除授权请求")??;
  report(json!({"state":"cancelled","message":"已取消设备授权"}));return Ok(());
 }
 let center=origin(text(&session,"origin")?)?;
 let response=request(&center,"token",json!({"grantType":"authorization_code","code":field("code")?,"codeVerifier":text(&session,"verifier")?,"redirectUri":CALLBACK})).await?;
 let token=text(&response,"token")?.to_string();
 // Retain a successfully exchanged credential in the vault if installation is
 // interrupted, so a vault prompt or connection lock does not lose the token.
 let ready=json!({"origin":center,"token":token,"ready":true,"state":session["state"],"expires":session["expires"],"callbackHash":callback_hash}).to_string();
 tokio::task::spawn_blocking(move||crate::workbench_connection::save_for(SERVICE,&ready)).await.map_err(|_|"无法保存设备授权")??;
 install_ready().await
}
async fn install_ready()->Result<(),String>{
 let value=tokio::task::spawn_blocking(||crate::workbench_connection::read_for(SERVICE)).await.map_err(|_|"无法读取设备授权")??.ok_or("没有待恢复的授权")?;
 let value:Value=serde_json::from_str(&value).map_err(|_|"设备授权无效")?;
 if value["ready"]!=true{return Err("请先在浏览器完成授权".into());}
 crate::rssd_center::connect_native(text(&value,"origin")?.to_string(),text(&value,"token")?.to_string()).await?;
 if let Ok(mut done)=COMPLETED.lock(){*done=value["callbackHash"].as_str().map(str::to_owned);}
 tokio::task::spawn_blocking(||crate::workbench_connection::forget_for(SERVICE)).await.map_err(|_|"无法清除临时授权")??;
 report(json!({"state":"connected","message":"设备已连接，工作模式尚未开启"}));Ok(())
}
pub(crate) async fn retry()->Result<Value,String>{let _lock=LOCK.lock().await;install_ready().await?;Ok(status())}

#[cfg(test)]mod tests{use super::*;
 #[test]fn pkce_matches_rfc_vector(){assert_eq!(URL_SAFE_NO_PAD.encode(Sha256::digest(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")),"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");}
 #[test]fn only_https_origins_are_accepted(){for invalid in ["http://example.org","https://a.example/path","https://user@a.example","https://a.example?x=1"]{assert!(origin(invalid).is_err());}assert_eq!(origin("https://a.example/").unwrap(),"https://a.example");}
}
