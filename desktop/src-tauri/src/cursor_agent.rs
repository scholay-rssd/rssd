//! Main-window-only ACP bridge. No remote webview can start agents or approve tools.
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, process::Stdio, sync::{Arc, atomic::{AtomicBool, AtomicU64, Ordering}}};
use tauri::{Emitter, Manager};
use tokio::{io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader}, process::{Child, ChildStdin}, sync::{Mutex, oneshot}};
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value,String>>>>>;
struct Bridge { stdin: ChildStdin, child: Child, pending: Pending, space_id: String, site_id: String, space_name: String }
#[derive(Default)]
pub struct CursorRuntime { bridges: Mutex<HashMap<PathBuf,Bridge>>, sequence: AtomicU64, closing: AtomicBool, shutdown: Mutex<()> }
async fn shutdown_request<W: AsyncWrite + Unpin>(stdin: &mut W, request: &[u8], response: oneshot::Receiver<Result<Value,String>>, limit: std::time::Duration) {
    // The budget must include the write; a full pipe otherwise never reaches
    // the response timeout and prevents switching even when no task is running.
    let _ = tokio::time::timeout(limit, async {
        stdin.write_all(request).await?;
        let _ = response.await;
        Ok::<_,std::io::Error>(())
    }).await;
}
async fn close_bridge(mut bridge: Bridge) {
    drop(bridge.stdin);
    if tokio::time::timeout(std::time::Duration::from_secs(3), bridge.child.wait()).await.is_err() {
        let _ = bridge.child.kill().await;
    }
    for (_,sender) in bridge.pending.lock().await.drain() {
        let _ = sender.send(Err("智能体桥接已断开，请重新连接".into()));
    }
}
impl CursorRuntime {
    fn require_open(&self)->Result<(),String>{
        if self.closing.load(Ordering::Acquire){return Err("工作台正在退出，后台队列已保留".into());}
        Ok(())
    }
    pub async fn disconnect(&self) {
        // Reauthorization applies to the current space only. Other spaces can
        // still be writing; switching selection is not a shutdown operation.
        if let Ok(root)=crate::editorial::selected_root().await {
            let _shutdown=self.shutdown.lock().await;
            let bridge=self.bridges.lock().await.remove(&root);
            if let Some(bridge)=bridge {self.shutdown_bridge(bridge).await;}
        }
    }
    pub async fn disconnect_all(&self) {
        self.closing.store(true,Ordering::Release);
        // Repeated quit requests wait for the same saves instead of returning
        // early just because another caller already drained the map.
        let _shutdown=self.shutdown.lock().await;
        let bridges:Vec<_>=self.bridges.lock().await.drain().map(|(_,bridge)|bridge).collect();
        for bridge in bridges {self.shutdown_bridge(bridge).await;}
    }
    async fn shutdown_bridge(&self, mut bridge:Bridge) {
            // Shutdown is terminal for this bridge. Do it only once native
            // transition preparation has succeeded, and await worker saves
            // before closing stdin (whose fallback exit only allows 1.5s).
            let id = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
            let (tx, rx) = oneshot::channel();
            bridge.pending.lock().await.insert(id, tx);
            let request = format!("{}\n", json!({"id":id,"method":"task_shutdown","params":{}}));
            shutdown_request(&mut bridge.stdin, request.as_bytes(), rx, std::time::Duration::from_secs(6)).await;
            bridge.pending.lock().await.remove(&id);
            close_bridge(bridge).await;
    }
    async fn resident_queue_status(&self)->Result<Value,String>{
        let guard=self.bridges.lock().await;self.require_open()?;
        let residents:Vec<_>=guard.iter().map(|(root,bridge)|(root.clone(),bridge.space_id.clone(),bridge.site_id.clone(),bridge.space_name.clone())).collect();
        drop(guard);
        let mut value=json!({"jobs":[]});
        // Status reads may inspect existing coordinators, never start one.
        for (root,space_id,site_id,space_name) in residents {
            let key=self.sequence.fetch_add(1,Ordering::Relaxed)+1;let(tx,rx)=oneshot::channel();
            let mut guard=self.bridges.lock().await;self.require_open()?;
            if let Some(bridge)=guard.get_mut(&root){
                bridge.pending.lock().await.insert(key,tx);
                let written=crate::workbench_process::write_request(&mut bridge.stdin,format!("{}\n",json!({"id":key,"method":"queue_status","params":{}})).as_bytes(),std::time::Duration::from_secs(3)).await;
                drop(guard);
                if written.is_ok(){if let Ok(Ok(Ok(mut snapshot)))=tokio::time::timeout(std::time::Duration::from_secs(5),rx).await {
                    tag_jobs(&mut snapshot,&space_id,&site_id,&space_name);
                    if let (Some(jobs),Some(more))=(value["jobs"].as_array_mut(),snapshot["jobs"].as_array()){jobs.extend(more.iter().cloned());}
                }}
                if let Some(bridge)=self.bridges.lock().await.get_mut(&root){bridge.pending.lock().await.remove(&key);}
            }
        }
        self.require_open()?;
        Ok(value)
    }
}
async fn queue_status_snapshot(runtime:&CursorRuntime)->Result<Value,String>{
    let mut value=runtime.resident_queue_status().await?;
    // Include unvisited spaces from disk without activating their runtime.
    let mut command=crate::workbench_runtime::command("desktop/scripts/agent/queue-snapshot.mjs")?;
    command.arg(&crate::workbench_runtime::paths()?.1);
    if let Ok(output)=crate::workbench_process::output(&mut command,&[],std::time::Duration::from_secs(8)).await {
        if let Ok(snapshot)=serde_json::from_slice::<Value>(&output.stdout){
            if let (Some(jobs),Some(more))=(value["jobs"].as_array_mut(),snapshot["jobs"].as_array()){
                for job in more {if !jobs.iter().any(|old|old["id"]==job["id"]&&old["spaceId"]==job["spaceId"]){jobs.push(job.clone());}}
            }
        }
    }
    runtime.require_open()?;
    Ok(value)
}
#[tauri::command]
pub async fn cursor_agent_call(_space: crate::spaces::Lease, webview: tauri::Webview, state: tauri::State<'_,CursorRuntime>, method: String, params: Value) -> Result<Value,String> {
    crate::hot_board::require_main(&webview)?;
    if !["queue_status","agent_list","agent_save","agent_remove","agent_check","agent_login","agent_login_cancel","agent_default","agent_select","status","connect","prompt","respond","cancel","login","sessions","configure","review","task_list","task_create","task_get","task_update","task_delete","task_finish","task_confirm","task_workflow","task_run","task_check","task_asset","task_asset_read","task_settings","task_lease","task_leases","task_states","task_shutdown","gallery_list","gallery_read","gallery_prompt","article_images","article_image_replace","notebook_catalog","notebook_brands","notebook_brand_save","notebook_open","notebook_template","notebook_reload","notebook_reopen","notebook_check","notebook_image","notebook_image_read","notebook_image_search","notebook_image_apply","notebook_export","notebook_prompt","notebook_accept","context_get","context_connectors","context_browse","context_mount","context_mounts","context_unmount","context_enable","context_scope","context_search","context_read","context_candidate","context_network"].contains(&method.as_str()) { return Err("Unknown agent operation".into()); }
    if serde_json::to_vec(&params).map_err(|e|e.to_string())?.len()>5_000_000 {return Err("Agent request too large".into());}
    // This snapshot includes every resident space and the global queue on
    // disk. It does not read or mutate the selected space's database.
    if method=="queue_status" {drop(_space);return queue_status_snapshot(&state).await;}
    let root=crate::editorial::selected_root().await?;
    if method=="task_shutdown" {state.disconnect_all().await;return Ok(json!({"ok":true}));}
    let app=webview.app_handle().clone();
    let id=state.sequence.fetch_add(1,Ordering::Relaxed)+1;
    let (tx,rx)=oneshot::channel();
    {
        let mut guard=tokio::time::timeout(std::time::Duration::from_secs(10),state.bridges.lock()).await
            .map_err(|_|"智能体连接暂时繁忙，请稍后重试")?;
        state.require_open()?;
        let restart=match guard.get_mut(&root){Some(b)=>b.child.try_wait().map_err(|e|e.to_string())?.is_some(),None=>true};
        if restart {
            // Closing stdin lets the coordinator cancel its own child processes.
            if let Some(old) = guard.remove(&root) { close_bridge(old).await; }
            let project=&crate::workbench_runtime::paths()?.0;
            let resource=app.path().resource_dir().map_err(|e|e.to_string())?.join("mcp").join(if cfg!(windows){"scholay-mcp.exe"}else{"scholay-mcp"});
            let companion=if resource.is_file(){resource}else{project.join("desktop/target/release").join(if cfg!(windows){"scholay-mcp.exe"}else{"scholay-mcp"})};
            let data=PathBuf::from(crate::spaces::text("stateDirectory")?);
            let socket=scholay_local_ipc::endpoint(&data).map_err(|e|format!("无法定位 RSS 本地连接：{e}"))?;
            let mut child=crate::workbench_runtime::command("desktop/scripts/agent/bridge.mjs")?.arg(companion).arg(socket)
                .env("SCHOLAY_EDITORIAL_ROOT",&root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true).spawn().map_err(|e|format!("无法启动 智能体桥接：{e}"))?;
            let stdin=child.stdin.take().ok_or("Missing agent stdin")?;
            let stdout=child.stdout.take().ok_or("Missing agent stdout")?;
            let pending:Pending=Arc::new(Mutex::new(HashMap::new()));
            let incoming=pending.clone();
            let bridge_space=crate::spaces::text("spaceId")?;
            let event_space=bridge_space.clone();
            let site_id=crate::spaces::text("siteId")?;
            let space_name=crate::spaces::context()?["site"]["name"].as_str().unwrap_or(&bridge_space).to_owned();
            tauri::async_runtime::spawn(async move {
                let mut lines=BufReader::new(stdout).lines();
                while let Ok(Some(line))=lines.next_line().await {
                    if line.len()>12_000_000 {continue;}
                    if let Ok(value)=serde_json::from_str::<Value>(&line){
                        if let Some(event)=value.get("event"){
                            let mut tagged=event.clone();tagged["spaceId"]=event_space.clone().into();
                            if matches!(tagged["type"].as_str(),Some("task_state"|"changed"|"task_changed"|"error"|"asset")) {
                                let _=app.emit_to("main","background-task-event",&tagged);
                            }
                            if crate::spaces::text("spaceId").ok().as_deref()==Some(event_space.as_str()){let _=app.emit_to("main","cursor-agent-event",&tagged);}
                        }
                        else if let Some(id)=value.get("id").and_then(Value::as_u64){if let Some(sender)=incoming.lock().await.remove(&id){let result=if let Some(error)=value.get("error"){Err(error.as_str().unwrap_or("Agent error").to_string())}else{Ok(value["result"].clone())};let _=sender.send(result);}}
                    }
                }
                for (_,sender) in incoming.lock().await.drain(){let _=sender.send(Err("智能体桥接已断开，请重新连接".into()));}
            });
            guard.insert(root.clone(),Bridge{stdin,child,pending,space_id:bridge_space,site_id,space_name});
        }
        let bridge=guard.get_mut(&root).unwrap();bridge.pending.lock().await.insert(id,tx);
        if let Err(e)=crate::workbench_process::write_request(&mut bridge.stdin,format!("{}\n",json!({"id":id,"method":method,"params":params})).as_bytes(),std::time::Duration::from_secs(3)).await {
            // A cancelled write may have sent half a JSON line. Discard this
            // connection instead of corrupting the next request on that pipe.
            let broken=guard.remove(&root).unwrap();
            drop(guard);
            close_bridge(broken).await;
            return Err(e.to_string());
        }
    }
    match tokio::time::timeout(std::time::Duration::from_secs(120),rx).await {
        Ok(Ok(result))=>result,
        _=>{if let Some(b)=state.bridges.lock().await.get_mut(&root){b.pending.lock().await.remove(&id);}Err("智能体响应超时；可查看侧栏状态或停止当前任务".into())}
    }
}
fn tag_jobs(value:&mut Value,space_id:&str,site_id:&str,space_name:&str){
    if let Some(jobs)=value["jobs"].as_array_mut(){for job in jobs {job["spaceId"]=space_id.into();job["siteId"]=site_id.into();job["spaceName"]=space_name.into();}}
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn readonly_status_does_not_create_a_coordinator_or_bypass_shutdown(){
        let runtime=CursorRuntime::default();
        for _ in 0..3 {assert_eq!(runtime.resident_queue_status().await.unwrap(),json!({"jobs":[]}));}
        assert!(runtime.bridges.lock().await.is_empty());
        assert_eq!(runtime.sequence.load(Ordering::Relaxed),0);
        runtime.closing.store(true,Ordering::Release);
        assert!(runtime.resident_queue_status().await.is_err());
        assert!(runtime.bridges.lock().await.is_empty());
    }
    #[tokio::test]
    async fn quitting_marks_runtime_closed_before_waiting_for_the_bridge_map() {
        let runtime=Arc::new(CursorRuntime::default());
        let map=runtime.bridges.lock().await;
        let quitting=runtime.clone();let stopped=tokio::spawn(async move{quitting.disconnect_all().await;});
        tokio::task::yield_now().await;
        assert!(runtime.closing.load(Ordering::Acquire));
        assert!(!stopped.is_finished());
        drop(map);stopped.await.unwrap();
        let _map=runtime.bridges.lock().await;
        assert!(runtime.require_open().is_err(),"a late status poll must not recreate a coordinator");
    }
    #[tokio::test]
    async fn concurrent_quit_requests_wait_for_an_existing_shutdown() {
        let runtime=Arc::new(CursorRuntime::default());let saving=runtime.shutdown.lock().await;
        let first=runtime.clone();let one=tokio::spawn(async move{first.disconnect_all().await;});
        let second=runtime.clone();let two=tokio::spawn(async move{second.disconnect_all().await;});
        tokio::task::yield_now().await;
        assert!(runtime.closing.load(Ordering::Acquire));assert!(!one.is_finished());assert!(!two.is_finished());
        drop(saving);one.await.unwrap();two.await.unwrap();
    }
    #[test]
    fn queue_events_keep_their_workspace_identity() {
        let mut value=json!({"jobs":[{"id":"task","status":"running"}]});
        tag_jobs(&mut value,"metho","metho","研究方法");
        assert_eq!(value["jobs"][0]["spaceId"],"metho");
        assert_eq!(value["jobs"][0]["spaceName"],"研究方法");
        assert_eq!(value["jobs"][0]["status"],"running");
    }
    #[tokio::test]
    async fn shutdown_budget_covers_both_a_full_pipe_and_a_missing_ack() {
        for capacity in [1, 1024] {
            let (mut writer, _reader) = tokio::io::duplex(capacity);
            let (_sender, response) = oneshot::channel();
            tokio::time::timeout(std::time::Duration::from_secs(2),
                shutdown_request(&mut writer, b"shutdown request\n", response, std::time::Duration::from_millis(25)))
                .await.expect("shutdown must return even if the bridge is stuck");
        }
    }
}
