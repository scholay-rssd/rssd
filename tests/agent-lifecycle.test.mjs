import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {settleHistory} from '../desktop/scripts/agent/session-state.mjs';

test('notebook generation fills its scoped image and reports a missing callback without losing the caption',async t=>{
 const {root,call,states}=await fixture(t);
 for(const file of ['AGENTS.md','README.md','.agents'])await cp(resolve('desktop/resources/workspace-template',file),join(root,file),{recursive:true});
 let task=await call('task_create',{mode:'observation',skill:'unskilled'});
 task=await call('notebook_open',{taskId:task.id});
 task=await call('task_update',{taskId:task.id,expectedRevision:task.revision,patch:{notebook:{...task.notebook,blocks:[{id:'image',type:'image',text:'',requirement:'示例',state:'placeholder',sourceIds:[]},{id:'caption',type:'annotation',role:'caption',targetId:'image',text:'保留这条人工图注',state:'ready',locked:true,sourceIds:[]}]}}});
 await call('notebook_prompt',{taskId:task.id,text:'notebook:image:generated',action:'image',targetIds:['image'],imageMethod:'generate',sources:'combined',expectedRevision:task.revision});
 await until(()=>states.get(task.id)?.busy===false);
 assert.equal(states.get(task.id).status,'已完成');task=await call('task_get',{taskId:task.id});
 const path=task.notebook.blocks[0].text;assert.match(path,/^assets\/notebook\/.*\.webp$/);assert.equal(task.notebook.assets[path].origin,'generated');assert.equal(task.notebook.blocks[1].text,'保留这条人工图注');
 assert.match((await call('notebook_image_read',{taskId:task.id,path})).src,/^data:image\/webp;base64,/);
 await call('notebook_prompt',{taskId:task.id,text:'complete',action:'image',targetIds:['image'],imageMethod:'generate',sources:'combined',expectedRevision:task.revision});
 await until(()=>states.get(task.id)?.busy===false);
 assert.match(states.get(task.id).status,/图片尚未填入/);assert.equal((await call('task_get',{taskId:task.id})).notebook.blocks[0].text,path);
});

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'scholay-lifecycle-'));await mkdir(join(root,'articles'));await mkdir(join(root,'_ops/inventory'),{recursive:true});
 await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));
 const child=spawn(process.execPath,[resolve('desktop/scripts/agent/bridge.mjs')],{env:{...process.env,SCHOLAY_EDITORIAL_ROOT:root,NODE_OPTIONS:'--import='+pathToFileURL(resolve('tests/fixtures/agent/preload.mjs')).href},stdio:['pipe','pipe','pipe']});
 let sequence=0;const pending=new Map(),states=new Map(),events=[];
 createInterface({input:child.stdout}).on('line',line=>{const v=JSON.parse(line);if(v.event){events.push(v.event);if(v.event.type==='task_state')states.set(v.event.taskId,v.event.state);return;}const item=pending.get(v.id);if(item){pending.delete(v.id);clearTimeout(item.timer);v.error?item.reject(Error(v.error)):item.resolve(v.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('bridge timeout: '+method)),12000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 t.after(async()=>{await call('task_shutdown').catch(()=>{});child.stdin.end();await new Promise(r=>child.once('exit',r));await rm(root,{recursive:true,force:true});});
 return {root,call,states,events};
}
async function until(fn){const end=Date.now()+12000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,25));}throw Error('condition timed out');}

test('three isolated workers run, additional tasks queue, cancelled queue never starts, and stop settles tools',async t=>{
 const {call,states,events}=await fixture(t),ids=[];
 assert.equal((await call('task_settings',{parallelism:4})).parallelism,3);
 for(let i=0;i<5;i++)ids.push((await call('task_create',{mode:'observation',title:'fixture '+i})).id);
 for(const taskId of ids)await call('prompt',{taskId,text:'hold'});
 await until(()=>ids.slice(0,3).every(id=>events.some(e=>e.taskId===id&&e.type==='message'&&e.message.role==='tool')));
 assert.equal(states.get(ids[3]).queued,true);assert.equal(states.get(ids[4]).queued,true);
 assert.equal([...states.values()].filter(s=>s.busy&&!s.queued).length,3);
 await assert.rejects(call('task_delete',{taskId:ids[0]}),/先停止/);
 await call('cancel',{taskId:ids[3]});assert.equal(states.get(ids[3]).busy,false);
 assert.equal((await call('task_get',{taskId:ids[3]})).runtime.pendingPrompt,null);
 await call('cancel',{taskId:ids[0]});
 await until(()=>events.some(e=>e.taskId===ids[4]&&e.type==='message'&&e.message.role==='tool'));
 const stopped=await call('status',{taskId:ids[0]});assert.equal(stopped.busy,false);assert.equal(stopped.status,'已停止');assert.equal(stopped.history.find(m=>m.role==='tool').tool.status,'cancelled');
 assert.equal(events.some(e=>e.taskId===ids[3]&&e.type==='message'&&e.message.role==='user'),false);
 for(const id of ids)await call('cancel',{taskId:id});
 await until(()=>[...states.values()].every(s=>!s.busy));
 await call('task_delete',{taskId:ids[0]});assert.equal((await call('task_list')).some(t=>t.id===ids[0]),false);
});

test('cancelling during initialization cannot later start a prompt',async t=>{
 const {call,states,events}=await fixture(t),task=await call('task_create',{mode:'observation'});
 await call('prompt',{taskId:task.id,text:'must not run'});
 await until(()=>states.get(task.id)?.status==='正在连接…');
 await call('cancel',{taskId:task.id});await until(()=>!states.get(task.id)?.busy);
 await new Promise(r=>setTimeout(r,250));
 assert.equal(events.some(e=>e.type==='message'&&e.message.role==='user'),false);assert.equal(states.get(task.id).status,'已停止');
});

test('provider completion and unexpected exit clear stale tool activity without claiming tool success',async t=>{
 const {call,states}=await fixture(t),task=await call('task_create',{mode:'observation'});
 for(const text of ['complete','crash']){
  await call('prompt',{taskId:task.id,text});await until(()=>!states.get(task.id)?.busy);
  const s=await call('status',{taskId:task.id});assert.equal(s.busy,false);
  const tool=s.history.findLast(m=>m.role==='tool');assert.equal(tool.tool.status,'interrupted');
  assert.equal(s.history.at(-1).role,'turn');
 }
});

test('permanent deletion keeps manuscript files and prevents legacy re-import',async t=>{
 const root=await mkdtemp(join(tmpdir(),'scholay-delete-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const legacy=join(root,'.local/cursor');await mkdir(legacy,{recursive:true});await writeFile(join(legacy,'session.json'),JSON.stringify({sessionId:'old',root,history:[{role:'user',text:'old conversation'}]}));
 const store=new TaskStore(root),[task]=await store.list();const article=join(root,'article.md');await writeFile(article,'Keep manuscript');
 await store.remove(task.id);assert.deepEqual(await store.list(),[]);assert.equal(await readFile(article,'utf8'),'Keep manuscript');
 await assert.rejects(access(store.dir(task.id)));await assert.rejects(store.update(task.id,{title:'resurrect'}),/已删除/);
});

test('old stopped history is normalized while another live turn stays active',()=>{
 const h=[{id:'u',role:'user',turnId:'old'}, {id:'t',role:'tool',turnId:'old',tool:{status:'in_progress'}},{id:'old',role:'turn',turnId:'old',status:'已停止'},{id:'next',role:'tool',turnId:'live',tool:{status:'in_progress'}}];
 const v=settleHistory(h,'live');assert.equal(v[1].tool.status,'cancelled');assert.equal(v[3].tool.status,'in_progress');assert.equal(h[1].tool.status,'in_progress');
});

test('an ended task cannot reconnect or generate again; a new conversation remains independent',async t=>{
 const {call,events}=await fixture(t),task=await call('task_create',{mode:'observation'});
 const ended=await call('task_finish',{taskId:task.id});assert.ok(ended.completedAt);
 for(const method of ['prompt','connect','task_run'])await assert.rejects(call(method,{taskId:task.id,text:'complete',action:'topic'}),/对话已结束/);
 assert.equal((await call('status',{taskId:task.id})).busy,false);
 assert.equal(events.some(e=>e.taskId===task.id&&e.type==='message'),false);
 const next=await call('task_create',{mode:'observation'});assert.notEqual(next.id,task.id);assert.equal(next.completedAt,undefined);
});

test('gallery conversation scopes generation, retains readable messages, and stops independently',async t=>{
 const {call,events,states}=await fixture(t);
 const article=await call('task_create',{mode:'observation'});
 await assert.rejects(call('gallery_prompt',{taskId:article.id,text:'生成图片'}),/本地图库/);
 const image=await call('task_create',{mode:'image'});
 await assert.rejects(call('gallery_prompt',{taskId:image.id,text:' '}),/图片要求/);
 const first=await call('gallery_prompt',{taskId:image.id,text:'蓝色的科研流程图'});
 assert.ok(first.runId);
 await assert.rejects(call('gallery_prompt',{taskId:image.id,text:'重复请求'}),/正在运行/);
 await until(()=>events.some(e=>e.taskId===image.id&&e.type==='message'&&e.message.role==='user'));
 let status=await call('status',{taskId:image.id});
 assert.equal(status.history.find(m=>m.role==='user').text,'蓝色的科研流程图');
 assert.equal((await call('task_get',{taskId:image.id})).workflow.authorized,true);
 await call('cancel',{taskId:image.id,runId:first.runId});await until(()=>!states.get(image.id)?.busy);
 const next=await call('gallery_prompt',{taskId:image.id,text:'改成绿色'});assert.notEqual(next.runId,first.runId);
 await until(()=>events.some(e=>e.taskId===image.id&&e.type==='message'&&e.message.text==='改成绿色'));
 status=await call('status',{taskId:image.id});assert.equal(status.history.filter(m=>m.role==='user').length,2);
 await call('cancel',{taskId:image.id,runId:next.runId});await until(()=>!states.get(image.id)?.busy);
 await call('task_finish',{taskId:image.id});
 await assert.rejects(call('gallery_prompt',{taskId:image.id,text:'结束后再生图'}),/已结束/);
 assert.equal(states.has(article.id),false);
});

test('reopening reports interrupted persisted runs and retains run identity without replaying generation',async t=>{
 const {root,call,events}=await fixture(t),task=await call('task_create',{mode:'observation'});
 const store=new TaskStore(root);await store.runtime(task.id,{runId:'interrupted-run',busy:true,queued:false,status:'正在处理'});
 const snapshot=await call('task_states');assert.equal(snapshot[task.id].runId,'interrupted-run');assert.equal(snapshot[task.id].busy,false);assert.match(snapshot[task.id].status,/中断/);
 assert.equal((await store.get(task.id)).runtime.lastRunStatus,'上次执行已中断');
 assert.equal(events.some(e=>e.type==='message'),false);
});

test('gallery provider completion without an actual registered file is an error, not success',async t=>{
 const {call,states}=await fixture(t),task=await call('task_create',{mode:'image'});
 await call('gallery_prompt',{taskId:task.id,text:'图库无文件验收'});await until(()=>!states.get(task.id)?.busy);
 assert.match(states.get(task.id).status,/图片登记失败/);
 assert.equal((await call('task_get',{taskId:task.id})).assets.length,0);
 assert.match((await call('status',{taskId:task.id})).history.at(-1).status,/图片登记失败/);
});
test('authorized workflow permissions settle automatically per task without replacing business decisions',async t=>{
 const {root,call,states,events}=await fixture(t);
 for(const file of ['AGENTS.md','README.md','.agents'])await cp(resolve('desktop/resources/workspace-template',file),join(root,file),{recursive:true});
 const ids=[];
 for(const text of ['permission:auto:mcp','permission:deny:execute']){
  let task=await call('task_create',{mode:'observation'});ids.push(task.id);
  task=await call('task_workflow',{taskId:task.id,action:'configure',authorized:true,sources:'combined',expectedRevision:task.revision});
  await call('prompt',{taskId:task.id,text,workflow:true});
 }
 await until(()=>ids.every(id=>states.get(id)?.busy===false));
 const allowed=await call('status',{taskId:ids[0]}),denied=await call('status',{taskId:ids[1]});
 assert.match(allowed.history.findLast(e=>e.role==='assistant').text,/selected/);
 assert.match(denied.history.findLast(e=>e.role==='assistant').text,/cancelled/);
 assert.equal(events.some(e=>ids.includes(e.taskId)&&e.type==='request'),false,'ACP tool permissions must not become interactive cards in an authorized workflow');
});

test('whole-article completion saves only a successful ready run; unfinished and cancelled runs stay editable',async t=>{
 const {root,call,states}=await fixture(t);
 for(const file of ['AGENTS.md','README.md','.agents'])await cp(resolve('desktop/resources/workspace-template',file),join(root,file),{recursive:true});
 for(const scenario of ['ready','unfinished','cancelled']){
  let task=await call('task_create',{mode:'observation',skill:'unskilled'});task=await call('notebook_open',{taskId:task.id});
  task=await call('task_update',{taskId:task.id,expectedRevision:task.revision,patch:{notebook:{...task.notebook,sectionId:'observations',title:'统一完成验收',blocks:[{id:'manual',type:'paragraph',text:'保留这段作者原文。',state:'ready',locked:true,sourceIds:[]},...(scenario==='unfinished'?[{id:'pending',type:'paragraph',text:'',requirement:'需要补充的背景',state:'placeholder',sourceIds:[]}]:[])]}}});
  await call('notebook_prompt',{taskId:task.id,text:scenario==='cancelled'?'wait':'complete',action:'complete',sources:'rss',expectedRevision:task.revision});
  if(scenario==='cancelled'){await until(()=>states.get(task.id)?.busy&&!states.get(task.id)?.queued);await call('cancel',{taskId:task.id});}
  await until(()=>states.get(task.id)?.busy===false);
  task=await call('task_get',{taskId:task.id});assert.equal(task.notebook.blocks[0].text,'保留这段作者原文。');
  if(scenario==='ready'){assert.ok(task.completedAt);assert.equal(task.delivery.destination,'local');assert.match(await readFile(join(root,task.delivery.canonicalPath),'utf8'),/保留这段作者原文/);}
  else{assert.equal(task.completedAt,undefined);assert.match(states.get(task.id).status,scenario==='cancelled'?/停止/:/占位/);}
 }
});
