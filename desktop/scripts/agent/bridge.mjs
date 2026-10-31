import {acceptNotebookTurn} from './notebook-turns.mjs';
import {writingCatalog} from './writing-skill-catalog.mjs';
import {changeNotebookTemplate} from './notebook-template-store.mjs';
import {brandLibrary} from './brand-library.mjs';
import {searchNotebookImages} from './notebook-images.mjs';
import {beginNotebookPrompt,applyNotebookImage,openNotebook,reloadNotebookDraft,readNotebookImage,importNotebookImage,checkNotebook,exportNotebook} from './notebook-store.mjs';
import {getWritingContext,listContextConnectors,browseContextConnector,mountResource,unmountResource,setMountEnabled,adjustMountScope,searchMount,readMount,setContextNetwork,addContextCandidate,applyMountList} from './writing-context-store.mjs';
import {galleryList,galleryBytes,articleImages,replaceImageSlot} from './image-library.mjs';
// One coordinator per workspace. Each task owns an isolated ACP worker.
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {configuredWorkspace} from '../../../scripts/editorial-location.mjs';
import {optionalJson} from '../../../scripts/editorial-sync.mjs';
import {settleHistory,attachmentBlocks} from './session-state.mjs';
import {TaskStore} from './task-store.mjs';
import {AgentRegistry} from './agent-registry.mjs';
import {AgentManager} from './agent-manager.mjs';
import {probeAgent} from './agent-probe.mjs';
import {workflowPrompt,workflowCheck} from './workflow.mjs';
import {recoverQueuedTask,authoringQueueJob} from './task-queue.mjs';
const root=configuredWorkspace(),store=new TaskStore(root),workers=new Map(),queue=[],states=new Map(),runtimeWrites=new Map(),starting=new Set(),enqueuing=new Set(),galleryStarting=new Set(),cancelled=new Set(),deleting=new Set(),finishedTasks=new Set();
let sequence=0,pumping=false,closed=false,shuttingDown=false,pumpTimer,pumpDrain=Promise.resolve();
const output=v=>{if(!closed)process.stdout.write(JSON.stringify(v)+'\n');};
const agents=new AgentRegistry(),agentManager=new AgentManager(agents,event=>output({event})),switching=new Set();
function report(id,patch){const previous=states.get(id);if(patch.runId&&previous?.runId&&patch.runId!==previous.runId&&!patch.queued)return;if(patch.busy===false&&['已完成','已停止'].includes(patch.status))patch={...patch,recoveryRequired:false};const s={...previous,...patch,taskId:id};states.set(id,s);const persisted={runId:s.runId,busy:!!s.busy,status:s.status,queued:!!s.queued,coordinatorPid:process.pid,queueUpdatedAt:new Date().toISOString(),...(patch.queuePhase?{queuePhase:patch.queuePhase}:{}),...(patch.recoveryRequired!==undefined?{recoveryRequired:patch.recoveryRequired}:{})};const writing=(runtimeWrites.get(id)||Promise.resolve()).catch(()=>{}).then(()=>store.runtime(id,persisted));runtimeWrites.set(id,writing);void writing.catch(()=>{});output({event:{type:'task_state',taskId:id,state:s}});}
async function flushRuntime(id){await runtimeWrites.get(id);}
async function restoreQueue(){
 for(const task of (await store.list()).sort((a,b)=>(a.runtime?.queuedAt||a.updatedAt).localeCompare(b.runtime?.queuedAt||b.updatedAt))){
  // A local GUI and a headless producer may inspect the same workspace. A
  // living owner keeps its queue; only dead-owner work is recoverable here.
  if(task.runtime?.coordinatorPid&&task.runtime.coordinatorPid!==process.pid){try{process.kill(task.runtime.coordinatorPid,0);states.set(task.id,{...task.runtime,taskId:task.id,foreignCoordinator:true});continue;}catch(error){if(error.code!=='ESRCH')continue;}}
  const saved=await optionalJson(join(store.dir(task.id),'cursor/session.json'));
  const recovery=recoverQueuedTask(task,saved,await store.admission(task.id));
  if(recovery?.kind==='queued'){
   if(!await store.claimQueuedPrompt(task.id,recovery.runId))continue;
   states.set(task.id,{...task.runtime,runId:recovery.runId,taskId:task.id,busy:true,queued:true,connected:false,pending:0,status:'排队中',recoveryRequired:false});
   queue.push({id:task.id,params:recovery.params});
  }else if(recovery){
   const patch={runId:recovery.runId,busy:false,queued:false,connected:false,pending:0,status:recovery.status,recoveryRequired:recovery.kind==='attention',queuePhase:recovery.kind==='attention'?'interrupted':'settled',...(recovery.kind==='settled'?{pendingPrompt:null}:{})};
   await store.runtime(task.id,patch);states.set(task.id,{...task.runtime,...patch,taskId:task.id});
  }else if(task.runtime)states.set(task.id,{...task.runtime,taskId:task.id,busy:false,queued:false,connected:false,pending:0});
 }
 void pump();
}
async function persisted(id){const c=await optionalJson(join(store.dir(id),'cursor/session.json')),task=await store.get(id),agentId=task.agentId||'cursor';return {taskId:id,agentId,agentName:(await agents.get(agentId).catch(()=>null))?.name||agentId,connected:false,busy:false,status:'尚未连接',history:settleHistory(c?.history||[]),configuration:(c?.agentId||'cursor')===agentId?c?.configuration:undefined,pending:[],sessionId:(c?.agentId||'cursor')===agentId?c?.sessionId:undefined};}
function start(id){
 if(workers.has(id))return workers.get(id);
 const child=spawn(process.execPath,[join(dirname(fileURLToPath(import.meta.url)),'worker.mjs'),...process.argv.slice(2)],{cwd:root,env:{...process.env,SCHOLAY_TASK_ID:id},windowsHide:true,stdio:['pipe','pipe','ignore']});
 const w={child,pending:new Map(),state:null};workers.set(id,w);
 createInterface({input:child.stdout,crlfDelay:Infinity}).on('line',line=>{try{if(workers.get(id)!==w||deleting.has(id))return;const v=JSON.parse(line);if(v.event){const e={...v.event,taskId:id};if(e.type==='state'){w.state=e;report(id,{runId:e.runId||states.get(id)?.runId,busy:e.busy||starting.has(id),connected:e.connected,status:e.status,pending:e.pending?.length||0,queued:false});if(!e.busy){if(finishedTasks.has(id))w.child.stdin.end();void pump();}}if(e.type==='request')report(id,{pending:(states.get(id)?.pending||0)+1});if(e.type==='resolved')report(id,{pending:Math.max(0,(states.get(id)?.pending||1)-1)});if(e.type==='task_changed')void store.get(id).then(t=>{if(t.completedAt){finishedTasks.add(id);if(!states.get(id)?.busy)w.child.stdin.end();}}).catch(()=>{});output({event:e});}else{const p=w.pending.get(v.id);if(p){w.pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error)):p.resolve(v.result);}}}catch{}});
 const end=()=>{if(workers.get(id)!==w||deleting.has(id))return;const interrupted=states.get(id)?.busy;workers.delete(id);starting.delete(id);for(const p of w.pending.values()){clearTimeout(p.timer);p.reject(Error('任务连接已中断，可重新连接继续'));}w.pending.clear();report(id,{busy:false,connected:false,queued:false,status:cancelled.has(states.get(id)?.runId)?'已停止':interrupted?'任务连接已中断，可重新连接继续':states.get(id)?.status||'连接已结束，可继续',pending:0});void store.releaseOwner(id);void pump();};child.on('error',end);child.on('exit',end);return w;
}
async function rpc(id,method,params={}){const w=start(id),key=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{w.pending.delete(key);reject(Error('任务响应超时，请查询状态或停止'));},115000);w.pending.set(key,{resolve,reject,timer});w.child.stdin.write(JSON.stringify({id:key,method,params})+'\n');});}
async function runQueued(item){
 let handed=false;
 try{
  await flushRuntime(item.id);await rpc(item.id,'connect');
  if(cancelled.has(item.params.runId)||shuttingDown)throw Error('已停止');
  // Commit the ambiguity boundary before sending. A crash beyond this point
  // needs review of the existing session, never a blind prompt/tool replay.
  report(item.id,{runId:item.params.runId,busy:true,queued:false,status:'正在处理',queuePhase:'dispatching'});await flushRuntime(item.id);
  await store.dispatchPrompt(item.id,item.params.runId);
  if(cancelled.has(item.params.runId)||shuttingDown)throw Error('已停止');
  await rpc(item.id,'prompt',item.params);handed=true;
  await store.acknowledgePrompt(item.id,item.params.runId);
 }catch(error){
  const status=cancelled.has(item.params.runId)?'已停止':error.message;
  report(item.id,{runId:item.params.runId,busy:false,queued:false,status,recoveryRequired:status!=='已停止'});
  if(status!=='已停止')output({event:{taskId:item.id,type:'error',text:status}});
 }finally{
  starting.delete(item.id);const state=workers.get(item.id)?.state;
  if(handed&&state&&!state.busy)report(item.id,{runId:item.params.runId,busy:false,status:cancelled.has(item.params.runId)?'已停止':state.status});
  void flushRuntime(item.id).then(pump).catch(()=>{});
 }
}
async function pump(){
 if(pumping||closed||shuttingDown)return;
 clearTimeout(pumpTimer);pumping=true;let drained;pumpDrain=new Promise(resolve=>{drained=resolve;});
 try{
  const {parallelism}=await store.settings();
  while(queue.length&&!shuttingDown){
   const item=queue[0];if(!await store.startQueuedPrompt(item.id,item.params.runId,parallelism))break;
   if(shuttingDown){await store.runtime(item.id,{busy:false,queued:true,status:'排队中',queuePhase:'queued'});break;}
   const index=queue.indexOf(item);
   if(index<0||cancelled.has(item.params.runId)){if(index>=0)queue.splice(index,1);await flushRuntime(item.id);await store.runtime(item.id,{busy:false,queued:false,pendingPrompt:null,status:'已停止',queuePhase:'stopped'});continue;}
   queue.splice(index,1);starting.add(item.id);
   report(item.id,{runId:item.params.runId,busy:true,queued:false,status:'正在连接…',queuePhase:'connecting'});void runQueued(item);
  }
 }finally{
  pumping=false;drained();
  if(queue.length&&!closed&&!shuttingDown){pumpTimer=setTimeout(()=>void pump(),5000);pumpTimer.unref();}
 }
}
const ready=restoreQueue();
async function dispatch(method,p={}){
 await ready;
 if(shuttingDown)throw Error('正在退出，请重新打开工作台');
 if(method==='agent_list')return {agents:await agents.list(),defaultAgentId:(await store.settings()).defaultAgentId||'cursor'};
 if(method==='agent_save')return agents.save(p);
 if(method==='agent_remove')return agents.remove(p.agentId);
 if(method==='agent_check')return probeAgent(agents,p.agentId);
 if(method==='agent_login')return agentManager.login(p.agentId);
 if(method==='agent_login_cancel')return agentManager.cancel(p.agentId);
 if(method==='agent_default'){await agents.launch(p.agentId);await store.settings({defaultAgentId:p.agentId});return {ok:true};}
 if(method==='notebook_brands')return brandLibrary();
 if(method==='notebook_brand_save')return brandLibrary({brand:p.brand,expectedVersion:p.expectedVersion});
 if(method==='notebook_catalog')return writingCatalog(root);
 if(method==='gallery_list')return galleryList(store);
 if(method==='gallery_read'){const sharp=(await import('sharp')).default;return {src:'data:image/webp;base64,'+(await sharp(await galleryBytes(store,p.taskId,p.assetId)).resize({width:640,withoutEnlargement:true}).webp().toBuffer()).toString('base64')};}
 if(method==='article_images')return articleImages(store,p.articleId);
 if(method==='article_image_replace'){const result=await replaceImageSlot(store,p);output({event:{type:'changed',id:p.articleId}});return result;}
 if(method==='task_list')return store.list(p.query||'');
 if(method==='queue_status')return {jobs:(await store.list()).map(task=>authoringQueueJob(task,states.get(task.id)?.foreignCoordinator?{}:states.get(task.id))).filter(Boolean)};
 if(method==='task_create'){const agentId=p.agentId||(await store.settings()).defaultAgentId||'cursor';await agents.get(agentId);return store.create({...p,agentId});}
 if(method==='task_settings'){const v=await store.settings(p.parallelism!==undefined||p.selectedTask!==undefined?{...(p.parallelism!==undefined?{parallelism:p.parallelism}:{}),...(p.selectedTask!==undefined?{selectedTask:p.selectedTask}:{})}:undefined);void pump();return v;}
 if(method==='task_states'){
  for(const t of await store.list())if(!states.has(t.id)&&t.runtime){
   const interrupted=t.runtime.busy||t.runtime.queued;
   const state={...t.runtime,taskId:t.id,runId:t.runtime.runId||t.ui.flowPending?.runId,busy:false,queued:false,connected:false,pending:0,...(interrupted?{status:'上次执行已中断',lastRunStatus:'上次执行已中断'}:{})};
   states.set(t.id,state);
   if(interrupted)await store.runtime(t.id,{runId:state.runId,busy:false,queued:false,status:state.status});
  }
  return Object.fromEntries(states);
 }
 if(method==='task_leases')return store.leases();
 if(method==='task_shutdown'){await shutdown();return {ok:true};}
 if(shuttingDown)throw Error('正在退出，请重新打开工作台');
 if(method==='task_lease'&&p.editorId==='library')return store.lease(p.articleId,'editor-library',!!p.release);
 let id=p.taskId;if(!id&&['status','connect','login'].includes(method)){const tasks=await store.list();id=tasks.find(t=>!t.deleted&&!t.archived)?.id||(await store.create({mode:'observation',title:'智能体连接检查',agentId:(await store.settings()).defaultAgentId||'cursor'})).id;}if(!id)throw Error('请选择一个任务');if(deleting.has(id))throw Error('任务正在删除');const task=await store.get(id);
 if(method==='task_delete'){
  if(states.get(id)?.busy||starting.has(id))throw Error('请先停止任务再删除');
  deleting.add(id);
  try{const w=workers.get(id);if(w){await new Promise(resolve=>{w.child.once('exit',resolve);w.child.stdin.end();setTimeout(()=>{w.child.kill();resolve();},5000).unref();});workers.delete(id);}
   await flushRuntime(id);await store.remove(id);states.delete(id);runtimeWrites.delete(id);return {ok:true};
  }finally{deleting.delete(id);}
 }
 if(method==='task_get')return task;
 if(switching.has(id))throw Error('正在切换智能体，请稍后重试');
 if(method==='agent_select'){
  switching.add(id);try{
   if(states.get(id)?.busy||starting.has(id)||states.get(id)?.queued)throw Error('请等待当前运行结束');
   await agents.launch(p.agentId);await flushRuntime(id);
   const result=await store.selectAgent(id,p.agentId),w=workers.get(id);
   if(w){await new Promise(resolve=>{w.child.once('exit',resolve);w.child.stdin.end();setTimeout(()=>{w.child.kill();resolve();},5000).unref();});workers.delete(id);}
   output({event:{type:'task_changed',taskId:id}});output({event:{type:'state',...await persisted(id)}});return result;
  }finally{switching.delete(id);}
 }
 if(method==='login')return agentManager.login(task.agentId||'cursor');
 if(method==='notebook_reload')return reloadNotebookDraft(store,id,p.expectedRevision);
 if(method==='notebook_reopen'){const result=await reloadNotebookDraft(store,id,p.expectedRevision,{reopen:true});finishedTasks.delete(id);output({event:{type:'task_changed',taskId:id}});return result;}
 if(method==='notebook_open')return openNotebook(store,id,p);
 if(method==='notebook_template'){
  if(states.get(id)?.busy||starting.has(id)||states.get(id)?.queued)throw Error('请等待当前对话完成');
  await flushRuntime(id);const result=await changeNotebookTemplate(store,id,p);
  output({event:{type:'task_changed',taskId:id}});return result;
 }
 if(method==='notebook_check'){const c=await checkNotebook(store,task,{preparing:p.phase==='prepare'});return {ready:c.ready,issues:c.issues};}
 if(method==='notebook_image_read')return readNotebookImage(store,id,p.path);
 if(method==='notebook_image')return importNotebookImage(store,id,p);
 if(method==='notebook_image_search')return searchNotebookImages(store,p);
 if(method==='notebook_image_apply')return applyNotebookImage(store,id,p);
 if(method==='notebook_export'){if(states.get(id)?.busy||starting.has(id))throw Error('请等待对话完成');await flushRuntime(id);const result=await exportNotebook(store,id,p.expectedRevision);finishedTasks.add(id);workers.get(id)?.child.stdin.end();output({event:{type:'task_changed',taskId:id}});return result;}
 if(method==='notebook_accept'){await flushRuntime(id);const value=await acceptNotebookTurn(store,id,p);output({event:{type:'task_changed',taskId:id}});return value;}
 if(method==='context_get')return getWritingContext(store,task);
 if(method==='context_connectors')return listContextConnectors(store,task,{signals:p.signals});
 if(method==='context_browse')return browseContextConnector(store,task,p.kind,p.query||'');
 if(method==='context_mount')return mountResource(store,task,p.spec||p,{signals:p.signals,fetcher:p.fetcher});
 if(method==='context_mounts')return applyMountList(store,task,p.mounts||[],{signals:p.signals});
 if(method==='context_unmount')return unmountResource(store,task,p.mountId,p);
 if(method==='context_enable')return setMountEnabled(store,task,p.mountId,p.enabled!==false,p);
 if(method==='context_scope')return adjustMountScope(store,task,p.mountId,p.scope||{},p);
 if(method==='context_search')return searchMount(store,task,p.mountId,p.query||'',p);
 if(method==='context_read')return readMount(store,task,p.mountId,p.locator||{},p);
 if(method==='context_candidate')return addContextCandidate(store,task,p,p);
 if(method==='context_network')return setContextNetwork(store,task,p.allowNetwork===true,p);
 if(method==='notebook_prompt'){
  if(!task.notebook||task.completedAt)throw Error('请先打开可编辑文章板');
  if(states.get(id)?.busy||starting.has(id))throw Error('请等待当前对话完成');
  if(p.expectedRevision!==task.revision)throw Error('文章板已有新版，请重新读取');
  const text=String(p.text||'').trim();if(!text||text.length>8000)throw Error('请填写 1–8000 字的写作要求');
  attachmentBlocks(p.attachments||[],{promptCapabilities:{image:true}});
  await flushRuntime(id);await beginNotebookPrompt(store,id,p);output({event:{type:'task_changed',taskId:id}});
  try{return await dispatch('prompt',{taskId:id,text,userText:text,attachments:p.attachments||[],workflow:true,stageLabel:p.action==='complete'?'完成文章':p.action==='research'?'检索素材':p.action==='image'?'补全图片':'更新子弹笔记'});}catch(error){await store.runtime(id,{notebookAction:null});throw error;}
 }
 if(method==='task_finish'){if(states.get(id)?.busy||starting.has(id))throw Error('请先等待当前步骤结束');await flushRuntime(id);if(states.get(id)?.busy||starting.has(id))throw Error('请先等待当前步骤结束');const result=await store.finish(id,p);finishedTasks.add(id);report(id,{busy:false,queued:false,pending:0,status:'已完成',lastRunStatus:'已完成'});workers.get(id)?.child.stdin.end();output({event:{type:'task_changed',taskId:id}});return result;}
 if(task.completedAt&&['gallery_prompt','task_run','task_confirm','task_workflow','task_asset','prompt','connect','configure','review','respond'].includes(method))throw Error('对话已结束，请新建对话');
 if(method==='gallery_prompt'){
  if(task.mode!=='image')throw Error('图片对话只在本地图库中使用');
  const text=String(p.text||'').trim();if(!text||text.length>4000)throw Error('请填写不超过 4000 字的图片要求');
  if(states.get(id)?.busy||galleryStarting.has(id))throw Error('此图片对话正在运行');
  galleryStarting.add(id);
  try{
   let current=await store.update(id,{brief:text,...(!task.brief&&!task.assets.length?{title:text.slice(0,60)}:{})},task.revision);
   if(!current.workflow?.authorized)current=await store.workflow(id,{action:'configure',authorized:true,sources:'combined',expectedRevision:current.revision});
   await store.runtime(id,{lastAction:{action:'image'}});
   return await dispatch('prompt',{taskId:id,text:workflowPrompt(current,{action:'image'}),userText:text,attachments:p.attachments||[],workflow:true,stageLabel:'图库对话'});
  }finally{galleryStarting.delete(id);}
 }
 if(method==='task_workflow'){if(states.get(id)?.busy)throw Error('请先等待当前步骤结束');return store.workflow(id,p);}
 if(method==='task_check')return workflowCheck(root,task);
 if(method==='task_run'){const text=workflowPrompt(task,p);await store.runtime(id,{lastAction:{action:p.action,target:p.target,notes:p.notes||''},...(p.action==='topic'?{collection:Object.fromEntries(task.board.sections.flatMap(s=>(s.slots||[]).filter(slot=>slot.mode==='smart'&&(!p.target||slot.id===p.target)&&!s.items.some(i=>i.id===slot.id)).map(slot=>[slot.id,{status:'queued'}])))}:{})});return dispatch('prompt',{taskId:id,text,workflow:true,stageLabel:({topic:'选题',section:'补充栏目素材',append:'追加素材',item:'替换素材',outline:'生成',block:'修改内容块',draft:'正文生成',image:'生成配图'})[p.action]||'执行记录'});}
 if(method==='task_update'){if((p.patch.deleted||p.patch.archived)&&states.get(id)?.busy)throw Error('请先停止任务再归档或删除');return store.update(id,p.patch,p.expectedRevision);}
 if(method==='task_confirm')return store.confirm(id,p.stage,p.expectedRevision);
 if(method==='task_asset_read')return store.assetRead(id,p.assetId);
 if(method==='task_lease')return store.lease(p.articleId,'editor-'+id,!!p.release);
 if(method==='task_asset'){await store.lease(p.articleId||task.articleId,'editor-'+id);try{return await store.asset(id,p);}finally{await store.lease(p.articleId||task.articleId,'editor-'+id,true);}}
 if(method==='status'){const s=workers.has(id)?await rpc(id,'status'):await persisted(id);return {...s,...(states.get(id)?.queued?{busy:true,status:'排队中'}:{})};}
 if(task.deleted||task.archived)throw Error('请先恢复任务');
 if(method==='prompt'){if(states.get(id)?.busy||enqueuing.has(id))throw Error('此任务正在运行');enqueuing.add(id);p={...p,runId:randomUUID()};try{await flushRuntime(id);await store.enqueuePrompt(id,p);report(id,{runId:p.runId,busy:true,queued:true,status:'排队中',queuePhase:'queued',recoveryRequired:false});await flushRuntime(id);queue.push({id,params:p});void pump();return {started:true,accepted:true,queued:true,runId:p.runId};}catch(e){if(!/正在运行/.test(e.message))report(id,{busy:false,queued:false,status:'任务保存失败：'+e.message});throw e;}finally{enqueuing.delete(id);}}
 if(method==='cancel'){
  if(p.runId&&p.runId!==states.get(id)?.runId)throw Error('运行已变化，请重新读取任务');
  cancelled.add(states.get(id)?.runId);
  await store.cancelPrompt(id,states.get(id)?.runId);
  const q=queue.findIndex(x=>x.id===id);
  if(q>=0){queue.splice(q,1);report(id,{busy:false,queued:false,pending:0,status:'已停止'});void pump();return {ok:true};}
  if(!workers.has(id)){report(id,{busy:false,queued:false,pending:0,status:'已停止'});return {ok:true};}
 }
 if(p.runId&&states.get(id)?.runId&&p.runId!==states.get(id).runId)throw Error('运行已变化，请重新读取任务');
 return rpc(id,method,p);
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
let shutdownPromise;
function shutdown(){return shutdownPromise??=(async()=>{shuttingDown=true;clearTimeout(pumpTimer);await pumpDrain;agentManager.close();for(const item of queue.splice(0))report(item.id,{busy:false,queued:true,status:'排队中',queuePhase:'queued'});await Promise.all([...workers.values()].map(w=>new Promise(resolve=>{if(w.child.exitCode!==null){resolve();return;}w.child.once('exit',resolve);w.child.stdin.end();setTimeout(()=>{w.child.kill();resolve();},5000).unref();})));await Promise.allSettled([...runtimeWrites.values()]);})();}
input.on('line',line=>{if(line.length>8000000)return;void(async()=>{let m;try{m=JSON.parse(line);output({id:m.id,result:await dispatch(m.method,m.params)});}catch(e){output({id:m?.id,error:e.message});}})();});
input.on('close',()=>{void ready.then(shutdown).finally(()=>{closed=true;process.exit(0);});});
process.stdout.on('error',()=>{closed=true;for(const w of workers.values())w.child.stdin.end();process.exit(0);});
