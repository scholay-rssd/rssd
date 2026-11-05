import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {recoverQueuedTask,authoringQueueJob} from '../desktop/scripts/agent/task-queue.mjs';
import {authoringQueueSnapshot} from '../desktop/scripts/agent/queue-snapshot.mjs';
import {createBridgeClient} from '../desktop/scripts/agent/headless/bridge-client.mjs';

test('an acknowledged queued prompt survives a new store and reuses its original run identity',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-task-queue-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root),task=await store.create({mode:'observation',title:'Saved queued task'});
 const prompt={runId:'same-run',taskId:task.id,text:'Write from the mounted source',attachments:[]};
 await store.enqueuePrompt(task.id,prompt);
 const restored=await new TaskStore(root).get(task.id),admission=await store.admission(task.id),plan=recoverQueuedTask(restored,{history:[]},admission);
 assert.equal(plan.kind,'queued');assert.deepEqual(plan.params,prompt);
 assert.equal(admission.phase,'admitted');assert.equal(admission.runId,prompt.runId);assert.equal(restored.id,task.id);assert.equal(restored.revision,task.revision);
 assert.equal(authoringQueueJob(restored).status,'queued');
});
test('a durable dispatch marker prevents replay after ordinary progress regresses to queued',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-queue-dispatch-marker-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root),task=await store.create({mode:'observation'}),prompt={runId:'original',taskId:task.id,text:'generate'};
 await store.enqueuePrompt(task.id,prompt);await store.dispatchPrompt(task.id,prompt.runId);
 await store.runtime(task.id,{busy:true,queued:true,queuePhase:'queued'});
 const saved=await store.get(task.id),admission=await store.admission(task.id);
 assert.equal(recoverQueuedTask(saved,{history:[]},admission).kind,'attention');
 assert.equal(await store.claimQueuedPrompt(task.id,prompt.runId),false);
 assert.equal(admission.phase,'dispatched');assert.equal(admission.prompt.text,prompt.text);
});
test('admitted prompts survive lost progress files and mismatched run identities require review',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-queue-admission-marker-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root),task=await store.create({mode:'observation'}),prompt={runId:'original',taskId:task.id,text:'generate'};
 await store.enqueuePrompt(task.id,prompt);await writeFile(join(store.dir(task.id),'task.json'),'invalid');await writeFile(join(store.dir(task.id),'recovery.json'),'invalid');
 const saved=await store.get(task.id),admission=await store.admission(task.id);
 assert.deepEqual(recoverQueuedTask(saved,{history:[]},admission).params,prompt);
 assert.equal(saved.id,task.id);assert.equal(saved.revision,task.revision);
 assert.equal(recoverQueuedTask({...saved,runtime:{...saved.runtime,runId:'different'}},{history:[]},admission).kind,'attention');
 await store.cancelPrompt(task.id,prompt.runId);
 assert.equal(recoverQueuedTask(saved,{history:[]},await store.admission(task.id)).status,'已停止');
});
test('a late acknowledgement of a cancelled run cannot clear a newly admitted prompt',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-queue-late-ack-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root),task=await store.create({mode:'observation'});
 await store.enqueuePrompt(task.id,{runId:'first',text:'first'});await store.dispatchPrompt(task.id,'first');await store.cancelPrompt(task.id,'first');await store.runtime(task.id,{busy:false,queued:false,status:'已停止'});
 await store.enqueuePrompt(task.id,{runId:'second',text:'second'});
 assert.equal(await store.acknowledgePrompt(task.id,'first'),false);
 assert.equal((await store.get(task.id)).runtime.pendingPrompt.runId,'second');assert.equal((await store.admission(task.id)).phase,'admitted');
});
test('two local consumers share the persisted concurrency limit and intake rejects duplicate live work',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-queue-admission-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const first=new TaskStore(root),second=new TaskStore(root),tasks=[];
 for(let i=0;i<4;i++){const task=await first.create({mode:'observation'});tasks.push(task);await first.enqueuePrompt(task.id,{runId:'run-'+i,text:'generate'});}
 await assert.rejects(second.enqueuePrompt(tasks[0].id,{runId:'duplicate',text:'generate'}),/正在运行/);
 const results=await Promise.all(tasks.map((task,i)=>(i%2?first:second).startQueuedPrompt(task.id,'run-'+i,3)));
 assert.equal(results.filter(Boolean).length,3);const waiting=results.indexOf(false),finished=results.indexOf(true);
 await first.runtime(tasks[finished].id,{busy:false,queued:false,status:'已完成'});
 assert.equal(await second.startQueuedPrompt(tasks[waiting].id,'run-'+waiting,3),true);
});
test('a crash before or after sending a prompt cannot replay potentially completed tools',()=>{
 const base={id:'task',runtime:{pendingPrompt:{runId:'original',text:'Publish'},runId:'original',busy:true,queuePhase:'dispatching'}};
 assert.equal(recoverQueuedTask(base,{history:[]}).kind,'attention');
 assert.equal(recoverQueuedTask({...base,runtime:{...base.runtime,queuePhase:'queued'}},{history:[{role:'user',turnId:'original'}]}).kind,'attention');
 assert.equal(recoverQueuedTask({...base,runtime:{...base.runtime,pendingPrompt:null,queuePhase:'accepted'}},{history:[]}).kind,'attention');
});
test('a saved terminal turn settles only the matching run instead of enqueuing again',()=>{
 const task={runtime:{pendingPrompt:{runId:'new'},busy:true,queuePhase:'dispatching'}};
 assert.equal(recoverQueuedTask(task,{history:[{role:'turn',turnId:'old',finishedAt:1,status:'已完成'}]}).kind,'attention');
 assert.deepEqual(recoverQueuedTask(task,{history:[{role:'turn',turnId:'new',finishedAt:1,status:'已完成'}]}),{kind:'settled',runId:'new',status:'已完成'});
 assert.equal(recoverQueuedTask({...task,completedAt:'now'},{history:[]}),null);
});
test('queue cards distinguish confirmation and interrupted work from success without exposing prompts',()=>{
 const task={id:'task',articleId:'article',title:'Title',updatedAt:'now',runtime:{runId:'run',pendingPrompt:{runId:'run',text:'private prompt'}}};
 const waiting=authoringQueueJob(task,{busy:true,pending:1},{spaceId:'metho'});
 assert.equal(waiting.status,'attention');assert.equal(waiting.phase,'等待你的确认');assert.equal(waiting.spaceId,'metho');assert.ok(!JSON.stringify(waiting).includes('private prompt'));
 assert.equal(authoringQueueJob(task,{busy:false,recoveryRequired:true,status:'上次执行已中断'}).status,'attention');
 assert.equal(authoringQueueJob(task,{busy:false,status:'已完成'}).status,'complete');
});
test('global snapshots include unvisited spaces and never rewrite or restart their tasks',async t=>{
 const data=await mkdtemp(join(tmpdir(),'today-global-queue-'));t.after(()=>rm(data,{recursive:true,force:true}));
 await writeFile(join(data,'spaces.json'),JSON.stringify({sites:[{id:'metho',spaceId:'metho',name:'研究方法'}]}));
 const root=join(data,'spaces','metho','workspace'),store=new TaskStore(root),task=await store.create({mode:'observation',title:'Unvisited queued task'});
 await store.runtime(task.id,{pendingPrompt:{runId:'same-run',text:'private'},runId:'same-run',busy:true,queued:true,queuePhase:'queued'});
 const before=await readFile(join(store.dir(task.id),'task.json'),'utf8');
 const snapshot=await authoringQueueSnapshot(data);
 assert.equal(snapshot.jobs.length,1);assert.equal(snapshot.jobs[0].spaceName,'研究方法');assert.equal(snapshot.jobs[0].status,'queued');assert.equal(await readFile(join(store.dir(task.id),'task.json'),'utf8'),before);
 assert.ok(!JSON.stringify(snapshot).includes('private'));
});
test('the real bridge saves queued work on shutdown and restarts only the never-started run',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-queue-restart-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'articles'));await mkdir(join(root,'_ops','inventory'),{recursive:true});await writeFile(join(root,'_ops','inventory','article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));
 const env={...process.env,SCHOLAY_EDITORIAL_ROOT:root,NODE_OPTIONS:'--import='+pathToFileURL(resolve('tests/fixtures/agent/preload.mjs')).href};
 const launch=()=>{const child=spawn(process.execPath,[resolve('desktop/scripts/agent/bridge.mjs')],{env,stdio:['pipe','pipe','pipe']});child.stderr.resume();return createBridgeClient(child,{callTimeout:12000,runTimeout:12000});};
 let client=launch();t.after(()=>client.close());const active=[];
 for(let i=0;i<3;i++){const task=await client.call('task_create',{mode:'observation',title:'active '+i});active.push(task.id);await client.call('prompt',{taskId:task.id,text:'hold'});}
 const queued=await client.call('task_create',{mode:'observation',title:'queued restart'}),accepted=await client.call('prompt',{taskId:queued.id,text:'complete'});
 assert.equal(accepted.accepted,true);assert.equal((await client.call('task_get',{taskId:queued.id})).runtime.queuePhase,'queued');
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){const tasks=await new TaskStore(root).list();if(active.every(id=>tasks.some(task=>task.id===id&&task.runtime?.busy&&task.runtime.pendingPrompt===null)))break;await new Promise(resolve=>setTimeout(resolve,20));}
 for(const taskId of active)assert.equal((await new TaskStore(root).get(taskId)).runtime.pendingPrompt,null);
 await client.call('task_shutdown');await client.close();
 const saved=await new TaskStore(root).get(queued.id);assert.equal(saved.runtime.pendingPrompt.runId,accepted.runId);assert.equal(saved.runtime.queued,true);
 client=launch();await client.call('queue_status');await client.idleOf(queued.id,accepted.runId);
 const status=await client.call('status',{taskId:queued.id});assert.equal(status.status,'已完成');assert.equal(status.history.filter(message=>message.role==='user').length,1);
 for(const taskId of active){const task=await client.call('task_get',{taskId});assert.equal(task.runtime.pendingPrompt,null);assert.equal(task.runtime.busy,false);}
 await client.call('task_shutdown');
});
