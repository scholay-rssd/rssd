//! Import a portable site authorization without exposing its secret in results.
use serde_json::{json,Value};
use tauri_plugin_dialog::DialogExt;
use tauri::{Emitter, Manager};
use crate::workbench_connection::{CONNECTION_CHANGES,site_service,read_for,save_for,forget_for};
const MAX_BYTES:usize=64*1024;

#[tauri::command]
pub async fn space_authorization(_space:crate::spaces::Lease,webview:tauri::Webview,state:tauri::State<'_,crate::cursor_agent::CursorRuntime>,content:Option<String>)->Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    let _change=CONNECTION_CHANGES.lock().await;
    let content=match content{
        Some(value)=>value,
        None=>{
            let (tx,rx)=tokio::sync::oneshot::channel();
            webview.dialog().file().set_title("选择站点授权文件，创建或连接空间").add_filter("站点授权文件",&["json"]).set_parent(&webview.window()).pick_file(move|file|{let _=tx.send(file);});
            let Some(file)=rx.await.map_err(|_|"文件选择已关闭")? else{return Ok(json!({"cancelled":true}));};
            let path=file.into_path().map_err(|_|"请选择本地授权文件")?;
            if tokio::fs::metadata(&path).await.map_err(|_|"无法读取授权文件")?.len()>MAX_BYTES as u64{return Err("授权文件过大（最多 64 KB）".into());}
            tokio::fs::read_to_string(path).await.map_err(|_|"无法读取授权文件")?
        }
    };
    if content.len()>MAX_BYTES{return Err("授权文件过大（最多 64 KB）".into());}
    let authorization:Value=serde_json::from_str(content.trim_start_matches('\u{feff}')).map_err(|_|"授权文件不是有效的 JSON，请使用管理员提供的原始文件")?;
    let (_,data)=crate::workbench_runtime::paths()?;
    let verified=crate::publications::run("space-authorization.mjs","verify",json!({"dataDirectory":data,"authorization":authorization})).await?;
    // Use only the validated identity returned by the bundled verifier. The
    // credential travels through stdin, never an argv, temporary file or log.
    let site=&verified["site"];
    let site_id=site["id"].as_str().ok_or("站点身份无效")?;
    let space_id=site["spaceId"].as_str().ok_or("空间身份无效")?;
    let service=site_service(site_id,site["legacy"].as_bool().unwrap_or(false));
    let token=authorization["credential"]["token"].as_str().ok_or("授权凭证无效")?;
    let previous=read_for(&service)?;
    // Keep a working connection: cloud request receipts are owned by its token.
    // Replacing it just because a file was dropped could orphan pending jobs.
    let mut reused=false;
    if let Some(old)=previous.as_deref(){
        if old==token{reused=true;}else{
            match crate::publications::run("space-authorization.mjs","verify_existing",json!({"dataDirectory":data,"site":site,"token":old})).await{
                Ok(_)=>reused=true,
                Err(error) if error.contains("鉴权失败（401）")||error.contains("鉴权失败（403）")=>{},
                Err(_)=>return Err("新授权有效，但原连接暂时无法核验；为保留原发布回执，请稍后重试".into())
            }
        }
    }
    if !reused{save_for(&service,token)?;}
    let registered=match crate::publications::run("space-authorization.mjs","register",json!({"dataDirectory":data,"site":site})).await{
        Ok(value)=>value,
        Err(error)=>{
            let restore=if reused{Ok(())}else{match previous{Some(old)=>save_for(&service,&old),None=>forget_for(&service)}};
            if restore.is_err(){return Err("空间连接未完成，系统凭证恢复失败；请保留授权文件后重试".into());}
            return Err(error);
        }
    };
    let current=crate::spaces::text("spaceId")?==space_id;
    // This runs only after identity verification and successful registration.
    // Active spaces retain their single writer. Inactive spaces get a local
    // library without selecting the space or touching the current manuscript.
    let subscriptions=if current{
        let library=webview.state::<crate::state::AppState>();
        let conn=library.db.lock().await;
        papr_core::site_subscriptions::initialize(&conn,site_id).map_err(|e|e.to_string())
    }else{
        initialize_subscriptions(&registered,site_id)
    };
    if current{
        if subscriptions.as_ref().is_ok_and(|s|s.added>0){let _=webview.emit("feeds-updated",0);let _=webview.emit("library-changed",());}
        state.disconnect().await;
    }
    let existing=verified["existing"].as_bool().unwrap_or(false);
    let mut message=if reused{"已复用原有连接，稿件、设置和发布回执均已保留"}else if existing{"已连接原有空间，稿件和设置均已保留"}else{"空间已创建并连接，可以进入空间开始工作"}.to_string();
    let (subscription_result,subscription_error)=match subscriptions{
        Ok(result)=>{if result.added>0{message.push_str(&format!("；已加载 {} 条订阅",result.added));}(Some(result),None)},
        // Keep the verified connection and committed workspace. A failed feed
        // transaction leaves no partial pack/receipt, so reimport safely retries.
        Err(_)=>{let error="订阅未能加载，请再次导入授权文件重试；原有订阅与阅读记录未修改";message.push_str(&format!("；{error}"));(None,Some(error))}
    };
    Ok(json!({"connected":true,"spaceId":space_id,"siteId":site_id,"name":verified["name"],"origin":site["origin"],"existing":existing,"reusedConnection":reused,"message":message,"subscriptions":subscription_result,"subscriptionError":subscription_error}))
}

fn initialize_subscriptions(context:&Value,site_id:&str)->Result<papr_core::site_subscriptions::ImportResult,String>{
    let dir=context["stateDirectory"].as_str().ok_or("缺少空间数据目录")?;
    let conn=crate::db::open(&std::path::Path::new(dir).join("papr.db")).map_err(|e|e.to_string())?;
    papr_core::site_subscriptions::initialize(&conn,site_id).map_err(|e|e.to_string())
}

#[cfg(test)]
mod subscription_tests {
    use super::*;
    #[test]
    fn inactive_authorized_space_loads_subscriptions_without_switching_or_resetting() {
        let dir=std::env::temp_dir().join(format!("today-subscription-test-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let context=json!({"stateDirectory":dir});
        let imported=initialize_subscriptions(&context,"metho").unwrap();
        assert!(imported.added>0);
        let db=crate::db::open(&dir.join("papr.db")).unwrap();
        db.execute("UPDATE feeds SET title='本人修改的名称'",[]).unwrap();
        assert!(initialize_subscriptions(&context,"metho").unwrap().already_applied);
        assert!(crate::db::list_feeds(&db).unwrap().iter().all(|f|f.title=="本人修改的名称"));
        drop(db);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
