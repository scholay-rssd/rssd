import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,readFile,rm,realpath,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {withCursorGalleryBridge,inspectCursorGalleryOrphan} from '../scripts/rssd-cursor-bridge-lifecycle.mjs';
import {fixtureImagePolicy,approveSyntheticReviews} from './fixtures/rssd-image-policy.mjs';
const fixtureCommand={command:process.execPath,args:[resolve('tests/fixtures/rssd-cursor-bridge/synthetic-bridge.cjs')],callTimeout:1000};
async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'rssd-gallery-bridge-')));await chmod(root,0o700);t.after(()=>rm(root,{recursive:true,force:true}));return {root,mode:'fixture',enabled:true,fixtureCommand};}
const create=(b,id='one')=>b.call('task_create',{agentId:'cursor',mode:'image',title:'RSSD '+id});
const prompt=(b,taskId,id='one')=>b.call('gallery_prompt',{taskId,text:'RSSD '+id+'\nSynthetic only'});

test('production and disabled paths fail closed before any child or workspace is created',async t=>{
 const f=await fixture(t);let used=false;
 await assert.rejects(withCursorGalleryBridge({...f,mode:'production'},()=>{used=true;}),{code:'image_pending'});
 await assert.rejects(withCursorGalleryBridge({...f,enabled:false},()=>{used=true;}),{code:'image_pending'});
 assert.equal(used,false);assert.equal(await inspectCursorGalleryOrphan(f.root),null);
});

test('one private coordinator restricts RPCs, cancels exact run, and closes cleanly',async t=>{
 const f=await fixture(t);
 await withCursorGalleryBridge(f,async b=>{
  await assert.rejects(b.call('task_run',{}),/not permitted/);await assert.rejects(create(b,'!'),/only identified/i);
  const task=await create(b),run=await prompt(b,task.id);assert.equal(run.runId,'run-1');
  await assert.rejects(prompt(b,task.id),/already dispatched/);
  await assert.rejects(b.call('cancel',{taskId:task.id,runId:'other'}),/different run/);
  await assert.rejects(b.call('task_get',{taskId:'other'}),/outside/);
  await b.call('cancel',{taskId:task.id,runId:'run-1'});assert.equal((await b.call('status',{taskId:task.id})).status,'已停止');
 });
 const state=await inspectCursorGalleryOrphan(f.root);assert.equal(state.phase,'closed');assert.equal(state.tasks[0].taskId,'task-1');assert.equal(state.tasks[0].phase,'settled');
 await withCursorGalleryBridge(f,async b=>assert.deepEqual(await b.call('task_list'),[]));
});

test('concurrent coordinators cannot enter the same private gallery workspace',async t=>{
 const f=await fixture(t);let release,entered;const wait=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const running=withCursorGalleryBridge(f,async()=>{entered();await wait;});await ready;
 await assert.rejects(withCursorGalleryBridge({...f,lockTimeout:50},async()=>{}),/文件正在保存/);
 release();await running;
});

test('interrupted or ambiguous tasks are only inspected with original identity, never replayed',async t=>{
 const f=await fixture(t);
 await withCursorGalleryBridge(f,async b=>{const task=await create(b);await prompt(b,task.id);});
 const before=await readFile(join(f.root,'bridge-lifecycle.json'),'utf8'),state=await inspectCursorGalleryOrphan(f.root);
 assert.equal(state.phase,'orphaned');assert.deepEqual(state.tasks,[{marker:'RSSD one',taskId:'task-1',runId:'run-1',phase:'sent'}]);
 await assert.rejects(withCursorGalleryBridge(f,async()=>assert.fail()),{code:'image_pending'});
 assert.equal(await readFile(join(f.root,'bridge-lifecycle.json'),'utf8'),before);
});

test('abort during ambiguous create preserves its marker and returned task without generating',async t=>{
 const f=await fixture(t),abort=new AbortController();
 const running=withCursorGalleryBridge({...f,signal:abort.signal},async b=>{setTimeout(()=>abort.abort(),50);await create(b,'slow');});
 await assert.rejects(running,{code:'image_pending'});const state=await inspectCursorGalleryOrphan(f.root);
 assert.equal(state.phase,'orphaned');assert.equal(state.tasks[0].marker,'RSSD slow');assert.equal(state.tasks[0].taskId,'task-1');assert.equal(state.tasks[0].phase,'created');
 await assert.rejects(withCursorGalleryBridge(f,async()=>assert.fail()),{code:'image_pending'});
});

test('rejects shared, symlink and malformed state before launch',async t=>{
 const f=await fixture(t);await chmod(f.root,0o755);await assert.rejects(withCursorGalleryBridge(f,async()=>{}),/private/);await chmod(f.root,0o700);
 const link=f.root+'-link';t.after(()=>rm(link,{force:true}));await symlink(f.root,link);await assert.rejects(withCursorGalleryBridge({...f,root:link},async()=>{}),/private/);
 await writeFile(join(f.root,'bridge-lifecycle.json'),'{}');await assert.rejects(withCursorGalleryBridge(f,async()=>{}),{code:'image_pending'});
});

test('macOS sandbox denies synthetic private read and write to descendant processes', {skip:process.platform!=='darwin'},async t=>{
 const {spawnSync}=await import('node:child_process');const f=await fixture(t),secret=join(f.root,'secret.txt');await writeFile(secret,'synthetic-private');
 const profile=`(version 1) (allow default) (deny file-read* (literal "${secret}")) (deny file-write* (literal "${secret}"))`;
 const code=`const fs=require('node:fs'),{spawnSync}=require('node:child_process');let read=false,write=false;try{fs.readFileSync(${JSON.stringify(secret)});read=true}catch{}try{fs.writeFileSync(${JSON.stringify(secret)},'changed');write=true}catch{}const descendant=spawnSync('/bin/cat',[${JSON.stringify(secret)}],{encoding:'utf8'});process.stdout.write(JSON.stringify({read,write,childStatus:descendant.status}));`;
 const result=spawnSync('/usr/bin/sandbox-exec',['-p',profile,process.execPath,'-e',code],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{read:false,write:false,childStatus:1});assert.equal(await readFile(secret,'utf8'),'synthetic-private');
});

test('actual RSSD bridge opens and closes an empty synthetic gallery without starting an agent',async t=>{
 const f=await fixture(t),{mkdir}=await import('node:fs/promises');const workspace=join(f.root,'workspace');
 await mkdir(join(workspace,'_ops/inventory'),{recursive:true,mode:0o700});await mkdir(join(workspace,'articles'),{mode:0o700});
 await writeFile(join(workspace,'_ops/inventory/article-index.json'),JSON.stringify({version:1,articles:{},annexColumns:[]}));
 const actual={...f,fixtureCommand:{command:process.execPath,args:[resolve('desktop/scripts/agent/bridge.mjs')],callTimeout:6000}};
 await withCursorGalleryBridge(actual,async bridge=>assert.deepEqual(await bridge.call('task_list'),[]));
 assert.deepEqual(await inspectCursorGalleryOrphan(f.root),{phase:'closed',tasks:[]});
});

test('existing image provider keeps one original task through a bridge interruption',async t=>{
 const {createCursorGalleryProvider}=await import('../scripts/rssd-cursor-image-provider.mjs');const f=await fixture(t);
 const scope={requirement:'A purely synthetic blue circle'};
 await withCursorGalleryBridge(f,async bridge=>{
  const provider=createCursorGalleryProvider({bridge,workspace:join(f.root,'workspace'),stateDirectory:join(f.root,'provider-state'),enabled:true});
  assert.equal((await provider.start({requestId:'image-one',scope})).status,'pending');
 });
 const state=await inspectCursorGalleryOrphan(f.root);assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].marker,'RSSD image-one');assert.equal(state.tasks[0].taskId,'task-1');assert.equal(state.tasks[0].phase,'sent');
 await assert.rejects(withCursorGalleryBridge(f,async()=>assert.fail()),{code:'image_pending'});
});

test('real gallery bridge and worker enforce original permissions and register a synthetic ACP result with reference attachment',async t=>{
 const {mkdir}=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');
 const {createHash}=await import('node:crypto'),{createCursorGalleryProvider}=await import('../scripts/rssd-cursor-image-provider.mjs');
 const f=await fixture(t),workspace=join(f.root,'workspace'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
 await mkdir(join(workspace,'_ops/inventory'),{recursive:true,mode:0o700});await mkdir(join(workspace,'articles'),{mode:0o700});await writeFile(join(workspace,'_ops/inventory/article-index.json'),JSON.stringify({version:1,articles:{},annexColumns:[]}));await writeFile(join(workspace,'synthetic.png'),png);
 const actual={...f,fixtureCommand:{command:process.execPath,args:[resolve('desktop/scripts/agent/bridge.mjs')],nodeOptions:'--import='+pathToFileURL(resolve('tests/fixtures/rssd-cursor-bridge/preload.mjs')).href,callTimeout:6000}};
 const scope={requirement:'A purely synthetic blue circle.',referenceSha256:createHash('sha256').update(png).digest('hex')};
 await withCursorGalleryBridge(actual,async bridge=>{
  const provider=createCursorGalleryProvider({bridge,workspace,stateDirectory:join(f.root,'provider-state'),enabled:true,reference:{bytes:png}});
  assert.equal((await provider.start({requestId:'fixture-image-one',scope})).status,'pending');
  const deadline=Date.now()+10000;let image;
  while(Date.now()<deadline){image=await provider.lookup({requestId:'fixture-image-one',scope});if(image.status==='ready')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(image.status,'ready');assert.equal(image.registration.taskId,(await inspectCursorGalleryOrphan(f.root)).tasks[0].taskId);
  const task=await bridge.call('task_get',{taskId:image.registration.taskId}),status=await bridge.call('status',{taskId:image.registration.taskId});
  assert.equal(task.mode,'image');assert.equal(task.agentId,'cursor');assert.equal(task.workflow.authorized,true);assert.equal(task.assets.length,1);
  const text=status.history.filter(m=>m.role==='assistant').map(m=>m.text).join('');
  for(const value of ['fixture-permission-101=selected','fixture-permission-102=cancelled','fixture-permission-103=cancelled','fixture-permission-104=selected','fixture-permission-105=cancelled','fixture-reference-sha256='+scope.referenceSha256])assert.ok(text.includes(value),value);
  assert.equal(createHash('sha256').update(image.bytes).digest('hex'),image.registration.sha256);
  await assert.rejects(readFile(join(workspace,'permission-canary.txt')),{code:'ENOENT'});
 });
 assert.equal((await inspectCursorGalleryOrphan(f.root)).phase,'closed');
});

test('gallery ACP permissions alone cannot confine direct writes by an adversarial agent process',async t=>{
 const {mkdir}=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');
 const f=await fixture(t),workspace=join(f.root,'workspace'),outside=join(f.root,'synthetic-outside-gallery.txt');
 await mkdir(join(workspace,'_ops/inventory'),{recursive:true,mode:0o700});await mkdir(join(workspace,'articles'),{mode:0o700});await writeFile(join(workspace,'_ops/inventory/article-index.json'),JSON.stringify({version:1,articles:{},annexColumns:[]}));await writeFile(outside,'synthetic original');
 const actual={...f,fixtureCommand:{command:process.execPath,args:[resolve('desktop/scripts/agent/bridge.mjs')],nodeOptions:'--import='+pathToFileURL(resolve('tests/fixtures/rssd-cursor-bridge/bypass-preload.mjs')).href,callTimeout:6000}};
 await withCursorGalleryBridge(actual,async bridge=>{
  const task=await create(bridge,'bypass');await prompt(bridge,task.id,'bypass');
  const end=Date.now()+6000;while(Date.now()<end){if((await readFile(outside,'utf8'))!=='synthetic original')break;await new Promise(r=>setTimeout(r,25));}
  assert.equal(await readFile(outside,'utf8'),'modified by synthetic ACP');
 });
 // Demonstrates the boundary's limitation; does not imply the real Cursor
 // executable performs such an operation.
});

test('imageStage candidate runs real bridge with synthetic ACP through registered, staged and uploaded slots',async t=>{
 const {mkdir}=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');
 const {createHash}=await import('node:crypto'),{createCursorGalleryImageStage}=await import('../scripts/rssd-cursor-gallery-image-stage.mjs');
 const {createBoundOriginalSearch,createAutomaticRightsVerifier}=await import('../scripts/rssd-original-rights-verifier.mjs');
 const protocol=(await import('../contracts/rssd-v1.cjs')).default,f=await fixture(t),workspace=join(f.root,'workspace'),job=join(f.root,'job'),home=join(f.root,'host');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
 await mkdir(join(workspace,'_ops/inventory'),{recursive:true,mode:0o700});await mkdir(join(workspace,'articles'),{mode:0o700});await mkdir(job,{mode:0o700});await mkdir(home,{mode:0o700});await writeFile(join(workspace,'_ops/inventory/article-index.json'),JSON.stringify({version:1,articles:{},annexColumns:[]}));await writeFile(join(workspace,'synthetic.png'),png);
 const options={mode:'fixture',enabled:true,fixtureCommand:{command:process.execPath,args:[resolve('desktop/scripts/agent/bridge.mjs')],nodeOptions:'--import='+pathToFileURL(resolve('tests/fixtures/rssd-cursor-bridge/preload.mjs')).href,callTimeout:6000}};
 const rows=new Map();let uploads=0;const client={origin:'https://center.example',async request(path,opts){if(opts?.method==='POST'){uploads++;const id='media-'+protocol.hash(['enter',opts.body.sha256]).slice(0,48);const row={id,workspaceId:'enter',manifest:{sha256:opts.body.sha256,mime:opts.body.mime,bytes:opts.body.bytes,path:opts.body.path}};rows.set(id,row);return row;}const row=rows.get(path.split('/').pop());if(!row)throw Object.assign(Error('not found'),{status:404});return row;}};
 const sha=createHash('sha256').update(png).digest('hex'),slot=id=>({blockId:id,requirement:'A synthetic blue circle',alt:'一张用于测试的八乘八像素合成图片不代表任何真实研究',caption:'合成测试示意图',referenceSha256:sha});
 let searches=0;const originalSource={search:createBoundOriginalSearch(async({query})=>{searches++;assert.equal(query,'A synthetic blue circle');return {complete:true,candidates:[]};}),review:createAutomaticRightsVerifier({trustedSources:[]}),registrar:{start:async()=>assert.fail(),lookup:async()=>assert.fail()}};
 const stage=createCursorGalleryImageStage({client,home,siteId:'enter',workspaceId:'enter',resolveImagePolicy:fixtureImagePolicy,jobId:'demand-one',galleryRoot:f.root,bridgeOptions:options,reference:{bytes:png},originalSource,timeoutMs:10000,pollMs:50});
 const args={plan:{claimId:'demand-one',slots:[slot('hero'),slot('body-image')]},directory:job};
 await assert.rejects(stage.prepare(args),{code:'image_pending'});assert.equal(uploads,0);await approveSyntheticReviews(job);
 await assert.rejects(stage.prepare(args),{code:'image_pending'});assert.equal(uploads,0);await approveSyntheticReviews(job);
 const images=await stage.prepare(args);assert.equal(images.length,2);assert.ok(images.every(i=>i.uploaded));assert.equal(uploads,1);assert.notEqual(images[0].registration.taskId,images[1].registration.taskId);assert.equal(searches,2);
 assert.equal((await inspectCursorGalleryOrphan(f.root)).phase,'closed');
});

test('orphan recovery reads only the original task and never replays an admitted queue',async t=>{
 const {mkdir}=await import('node:fs/promises');
 for(const phase of ['dispatched','admitted']){
  const f=await fixture(t),id='task-1',dir=join(f.root,'workspace/.local/workbench/tasks',id);await mkdir(join(dir,'cursor'),{recursive:true,mode:0o700});
  const prompt={runId:'run-1',text:'synthetic original'};
  await writeFile(join(f.root,'bridge-lifecycle.json'),JSON.stringify({version:1,phase:'orphaned',tasks:[{marker:'RSSD one',taskId:id,runId:'run-1',phase:'sent'}]}));
  await writeFile(join(dir,'task.json'),JSON.stringify({id,mode:'image',agentId:'cursor',runtime:{runId:'run-1',pendingPrompt:prompt,queuePhase:phase==='admitted'?'queued':'dispatching'}}));
  await writeFile(join(dir,'queue-admission.json'),JSON.stringify({version:1,taskId:id,runId:'run-1',phase,prompt}));await writeFile(join(dir,'cursor/session.json'),JSON.stringify({history:[]}));
  const saved=await readFile(join(f.root,'bridge-lifecycle.json'),'utf8');
  if(phase==='admitted'){
   await assert.rejects(withCursorGalleryBridge({...f,recover:true},async()=>assert.fail()),{code:'image_pending'});assert.equal(await readFile(join(f.root,'bridge-lifecycle.json'),'utf8'),saved);
  }else await withCursorGalleryBridge({...f,recover:true},async bridge=>{
   assert.equal((await bridge.call('task_get',{taskId:id})).id,id);await assert.rejects(promptBridge(),/not permitted/);
   async function promptBridge(){return bridge.call('gallery_prompt',{taskId:id,text:'RSSD one\nSynthetic only'});}
  });
 }
});

test('changed installed runtime identity blocks production before spawning or writing state', {skip:process.platform!=='darwin'},async t=>{
 const {cursorGalleryRuntimeIdentity}=await import('../scripts/rssd-cursor-bridge-lifecycle.mjs');const f=await fixture(t),identity=await cursorGalleryRuntimeIdentity();identity.files.cursorEntry.sha256='0'.repeat(64);
 await assert.rejects(withCursorGalleryBridge({...f,mode:'production',expectedRuntime:identity},async()=>assert.fail()),{code:'image_pending'});assert.equal(await inspectCursorGalleryOrphan(f.root),null);
});

test('production runtime identity starts only the installed bridge in an empty private workspace', {skip:process.platform!=='darwin'},async t=>{
 const {cursorGalleryRuntimeIdentity}=await import('../scripts/rssd-cursor-bridge-lifecycle.mjs'),{mkdir}=await import('node:fs/promises');const jobDirectory=await realpath(await mkdtemp('/private/tmp/rssd-cursor-factory-')),root=join(jobDirectory,'cursor-gallery');await mkdir(root,{mode:0o700});t.after(()=>rm(jobDirectory,{recursive:true,force:true}));
 const expectedRuntime=await cursorGalleryRuntimeIdentity();
 await withCursorGalleryBridge({root,jobDirectory,mode:'production',enabled:true,expectedRuntime},async bridge=>assert.deepEqual(await bridge.call('task_list'),[]));
 assert.deepEqual(await inspectCursorGalleryOrphan(root),{phase:'closed',tasks:[]});
});

test('production factory refuses inherited or project MCP config before starting a bridge', {skip:process.platform!=='darwin'},async t=>{
 const {mkdir}=await import('node:fs/promises'),{cursorGalleryRuntimeIdentity}=await import('../scripts/rssd-cursor-bridge-lifecycle.mjs');const jobDirectory=await realpath(await mkdtemp('/private/tmp/rssd-cursor-inherited-')),root=join(jobDirectory,'cursor-gallery');t.after(()=>rm(jobDirectory,{recursive:true,force:true}));
 await mkdir(join(root,'workspace/.cursor'),{recursive:true,mode:0o700});await writeFile(join(root,'workspace/.cursor/mcp.json'),'{}');
 const expectedRuntime=await cursorGalleryRuntimeIdentity();
 await assert.rejects(withCursorGalleryBridge({root,jobDirectory,mode:'production',enabled:true,expectedRuntime},async()=>assert.fail()),{code:'image_pending'});
 assert.equal(await inspectCursorGalleryOrphan(root),null);
});

test('owned safe Cursor config rewritten as 0644 is validated and tightened before launch', {skip:process.platform!=='darwin'},async t=>{
 const {mkdir,stat}=await import('node:fs/promises'),{cursorGalleryRuntimeIdentity}=await import('../scripts/rssd-cursor-bridge-lifecycle.mjs');
 const jobDirectory=await realpath(await mkdtemp('/private/tmp/rssd-config-recovery-')),root=join(jobDirectory,'cursor-gallery'),config=join(root,'config');t.after(()=>rm(jobDirectory,{recursive:true,force:true}));await mkdir(config,{recursive:true,mode:0o700});
 const file=join(config,'cli-config.json'),raw=JSON.stringify({permissions:{allow:[],deny:[]},approvalMode:'allowlist',display:{theme:'dark'}});await writeFile(file,raw,{mode:0o600});await chmod(file,0o644);
 const expectedRuntime=await cursorGalleryRuntimeIdentity();await withCursorGalleryBridge({root,jobDirectory,mode:'production',enabled:true,expectedRuntime},async b=>assert.deepEqual(await b.call('task_list'),[]));
 assert.equal((await stat(file)).mode&0o777,0o600);assert.equal(await readFile(file,'utf8'),raw);assert.equal((await inspectCursorGalleryOrphan(root)).phase,'closed');
});

test('unsafe Cursor config stays unchanged and initialization does not create a false starting journal', {skip:process.platform!=='darwin'},async t=>{
 const {mkdir,stat}=await import('node:fs/promises'),{cursorGalleryRuntimeIdentity}=await import('../scripts/rssd-cursor-bridge-lifecycle.mjs');
 const jobDirectory=await realpath(await mkdtemp('/private/tmp/rssd-config-unsafe-')),root=join(jobDirectory,'cursor-gallery'),config=join(root,'config');t.after(()=>rm(jobDirectory,{recursive:true,force:true}));await mkdir(config,{recursive:true,mode:0o700});
 const file=join(config,'cli-config.json'),raw=JSON.stringify({permissions:{allow:['shell'],deny:[]},approvalMode:'allowlist'});await writeFile(file,raw,{mode:0o600});await chmod(file,0o644);
 const expectedRuntime=await cursorGalleryRuntimeIdentity();await assert.rejects(withCursorGalleryBridge({root,jobDirectory,mode:'production',enabled:true,expectedRuntime},async()=>assert.fail()),{code:'image_pending'});
 assert.equal((await stat(file)).mode&0o777,0o644);assert.equal(await readFile(file,'utf8'),raw);assert.equal(await inspectCursorGalleryOrphan(root),null);
 const journal=join(root,'bridge-lifecycle.json'),prior=JSON.stringify({version:1,phase:'closed',tasks:[]});await writeFile(journal,prior,{mode:0o600});
 await assert.rejects(withCursorGalleryBridge({root,jobDirectory,mode:'production',enabled:true,expectedRuntime},async()=>assert.fail()),{code:'image_pending'});assert.equal(await readFile(journal,'utf8'),prior);
});

test('legacy starting journal with settled original waits for all real processes and permits a new slot after exit', {skip:process.platform!=='darwin'},async t=>{
 const {mkdir}=await import('node:fs/promises'),{spawn}=await import('node:child_process'),{once}=await import('node:events');
 const f=await fixture(t),workspace=join(f.root,'workspace'),id='settled-old',runId='run-old',dir=join(workspace,'.local/workbench/tasks',id);await mkdir(join(dir,'cursor'),{recursive:true,mode:0o700});
 const ended=spawn('/usr/bin/true');await once(ended,'exit');const endedPid=ended.pid;assert.ok(endedPid);
 const task={id,mode:'image',agentId:'cursor',runtime:{runId,busy:false,queued:false,pendingPrompt:null,status:'已完成',coordinatorPid:endedPid}};
 const admission={version:1,taskId:id,runId,phase:'dispatched',prompt:{runId,text:'Synthetic original prompt'}};
 const session={history:[{role:'turn',turnId:runId,finishedAt:'2026-11-03T00:00:00Z',status:'已完成'}]};
 await writeFile(join(dir,'task.json'),JSON.stringify(task));await writeFile(join(dir,'queue-admission.json'),JSON.stringify(admission));await writeFile(join(dir,'cursor/session.json'),JSON.stringify(session));
 const original={version:1,phase:'starting',tasks:[{marker:'RSSD old',taskId:id,runId,phase:'settled'}]},journal=join(f.root,'bridge-lifecycle.json');await writeFile(journal,JSON.stringify(original));const before=await readFile(join(dir,'task.json'),'utf8');
 const active=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:workspace,stdio:'ignore'});await once(active,'spawn');t.after(()=>{if(active.exitCode===null)active.kill('SIGTERM');});
 await assert.rejects(withCursorGalleryBridge({...f,recover:true},async()=>assert.fail()),{code:'image_pending'});assert.deepEqual(JSON.parse(await readFile(journal,'utf8')),original);
 active.kill('SIGTERM');await once(active,'exit');
 await writeFile(join(dir,'task.json'),JSON.stringify({...task,runtime:{...task.runtime,busy:true}}));
 await assert.rejects(withCursorGalleryBridge({...f,recover:true},async()=>assert.fail()),{code:'image_pending'});assert.deepEqual(JSON.parse(await readFile(journal,'utf8')),original);
 await writeFile(join(dir,'task.json'),before);
 await withCursorGalleryBridge({...f,recover:true},async b=>{const fresh=await create(b,'fresh');assert.notEqual(fresh.id,id);const run=await prompt(b,fresh.id,'fresh');await b.call('cancel',{taskId:fresh.id,runId:run.runId});await b.call('status',{taskId:fresh.id});});
 assert.equal(await readFile(join(dir,'task.json'),'utf8'),before);const state=await inspectCursorGalleryOrphan(f.root);assert.equal(state.phase,'closed');assert.equal(state.tasks.length,2);assert.equal(state.tasks[0].taskId,id);assert.equal(state.tasks[0].runId,runId);assert.equal(state.tasks[0].phase,'settled');
});

test('image stage timeout retains the original IDs and does not create a replacement during recovery',async t=>{
 const {mkdir,readdir}=await import('node:fs/promises'),{pathToFileURL}=await import('node:url'),{createHash}=await import('node:crypto');
 const {createCursorGalleryImageStage}=await import('../scripts/rssd-cursor-gallery-image-stage.mjs'),f=await fixture(t),workspace=join(f.root,'workspace'),job=join(f.root,'job'),home=join(f.root,'host');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
 await mkdir(join(workspace,'_ops/inventory'),{recursive:true,mode:0o700});await mkdir(join(workspace,'articles'),{mode:0o700});await mkdir(job,{mode:0o700});await mkdir(home,{mode:0o700});await writeFile(join(workspace,'_ops/inventory/article-index.json'),JSON.stringify({version:1,articles:{},annexColumns:[]}));await writeFile(join(workspace,'synthetic.png'),png);
 const bridgeOptions={mode:'fixture',enabled:true,fixtureCommand:{command:process.execPath,args:[resolve('desktop/scripts/agent/bridge.mjs')],nodeOptions:'--import='+pathToFileURL(resolve('tests/fixtures/rssd-cursor-bridge/preload.mjs')).href,callTimeout:6000}};
 const originalSource={search:async()=>({complete:true,candidates:[]}),review:async({scopeHash,searchHash})=>({status:'none',scopeHash,searchHash,reviewedBy:'fixture',reviewedAt:new Date().toISOString(),reason:'No synthetic source image',reviewedCandidateIds:[]}),registrar:{start:async()=>assert.fail(),lookup:async()=>assert.fail()}};
 const client={origin:'https://center.example',request:async()=>{throw Error('no image upload expected');}},scope={client,home,siteId:'enter',workspaceId:'enter',resolveImagePolicy:fixtureImagePolicy,jobId:'demand-one',galleryRoot:f.root,bridgeOptions,reference:{bytes:png},originalSource,timeoutMs:1,pollMs:1};
 const slot={blockId:'hero',requirement:'SLOW TEST synthetic geometric image',alt:'一张用于测试的八乘八像素合成图片不代表任何真实研究',caption:'合成示意图',referenceSha256:createHash('sha256').update(png).digest('hex')};
 await assert.rejects(createCursorGalleryImageStage(scope).prepare({plan:{claimId:'demand-one',slots:[slot]},directory:job}),{code:'image_pending'});
 const before=await inspectCursorGalleryOrphan(f.root);assert.equal(before.phase,'orphaned');assert.equal(before.tasks.length,1);assert.ok(before.tasks[0].taskId);const original=before.tasks[0].taskId;
 const files=(await readdir(join(job,'image-staging'))).filter(f=>f.endsWith('.json'));assert.equal(files.length,1);const imageState=JSON.parse(await readFile(join(job,'image-staging',files[0]),'utf8'));
 try{await createCursorGalleryImageStage({...scope,bridgeOptions:{...bridgeOptions,recover:true}}).prepare({plan:{claimId:'demand-one',slots:[slot]},directory:job});}catch(error){assert.equal(error.code,'image_pending');}
 const after=await inspectCursorGalleryOrphan(f.root);assert.equal(after.tasks.length,1);assert.equal(after.tasks[0].taskId,original);assert.equal(JSON.parse(await readFile(join(job,'image-staging',files[0]),'utf8')).requestId,imageState.requestId);
});

test('persistent job gallery permits only its own files within the protected user workspace', {skip:process.platform!=='darwin'},async t=>{
 const {mkdir}=await import('node:fs/promises'),{spawnSync}=await import('node:child_process'),{userInfo}=await import('node:os');
 const {cursorGallerySandboxProfile,cursorGalleryRuntimeIdentity}=await import('../scripts/rssd-cursor-bridge-lifecycle.mjs');
 await mkdir(resolve('.local'),{recursive:true});
 const jobDirectory=await realpath(await mkdtemp(resolve('.local/rssd-gallery-job-'))),root=join(jobDirectory,'cursor-gallery'),sibling=join(jobDirectory,'synthetic-private.txt');t.after(()=>rm(jobDirectory,{recursive:true,force:true}));await mkdir(root,{mode:0o700});await writeFile(sibling,'private');
 const code=`const fs=require('node:fs');let siblingRead=true,siblingWrite=true,galleryWrite=true;try{fs.readFileSync(${JSON.stringify(sibling)})}catch{siblingRead=false}try{fs.writeFileSync(${JSON.stringify(sibling)},'bad')}catch{siblingWrite=false}try{fs.writeFileSync(${JSON.stringify(join(root,'test'))},'ok')}catch{galleryWrite=false}process.stdout.write(JSON.stringify({siblingRead,siblingWrite,galleryWrite}));`;
 const probe=spawnSync('/usr/bin/sandbox-exec',['-p',cursorGallerySandboxProfile({userHome:userInfo().homedir,root}),process.execPath,'-e',code],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);assert.deepEqual(JSON.parse(probe.stdout),{siblingRead:false,siblingWrite:false,galleryWrite:true});assert.equal(await readFile(sibling,'utf8'),'private');
 const expectedRuntime=await cursorGalleryRuntimeIdentity();await withCursorGalleryBridge({root,jobDirectory,mode:'production',enabled:true,expectedRuntime},async bridge=>assert.deepEqual(await bridge.call('task_list'),[]));assert.equal((await inspectCursorGalleryOrphan(root)).phase,'closed');
});

test('licensed original uses real verifier and restricted registrar without starting image generation',async t=>{
 const {mkdir}=await import('node:fs/promises'),{createCursorGalleryImageStage}=await import('../scripts/rssd-cursor-gallery-image-stage.mjs'),{createOriginalGalleryRegistrar}=await import('../scripts/rssd-original-gallery-registrar.mjs'),{createAutomaticRightsVerifier,createBoundOriginalSearch,rightsDeclaration}=await import('../scripts/rssd-original-rights-verifier.mjs');
 const protocol=(await import('../contracts/rssd-v1.cjs')).default,f=await fixture(t),workspace=join(f.root,'workspace'),job=join(f.root,'job'),home=join(f.root,'host');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');await mkdir(join(workspace,'_ops/inventory'),{recursive:true,mode:0o700});await mkdir(join(workspace,'articles'),{mode:0o700});await mkdir(job,{mode:0o700});await mkdir(home,{mode:0o700});await writeFile(join(workspace,'_ops/inventory/article-index.json'),JSON.stringify({version:1,articles:{},annexColumns:[]}));
 const sourceUrl='https://rights.example/page',imageUrl='https://rights.example/image.png',licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',holder='Fixture Org',creator='Fixture Creator';
 const declaration=rightsDeclaration(holder,creator,imageUrl,licenseUrl),page=Buffer.from('<script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'ImageObject',contentUrl:imageUrl,license:licenseUrl,creator:{'@type':'Person',name:creator},copyrightHolder:{'@type':'Organization',name:holder},description:declaration})+'</script>');
 const read=async url=>url===sourceUrl?page:png,originalSource={search:createBoundOriginalSearch(async()=>({complete:true,candidates:[{id:'candidate-one',url:imageUrl,sourceUrl}]})),review:createAutomaticRightsVerifier({trustedSources:[{origin:'https://rights.example',holders:[holder]}],read}),read,registrarFactory:async({workspace,bridge})=>createOriginalGalleryRegistrar({workspace,bridge})};
 const rows=new Map(),client={origin:'https://center.example',async request(path,opts){if(opts?.method==='POST'){const id='media-'+protocol.hash(['enter',opts.body.sha256]).slice(0,48),row={id,workspaceId:'enter',manifest:{sha256:opts.body.sha256,mime:opts.body.mime,bytes:opts.body.bytes,path:opts.body.path}};rows.set(id,row);return row;}const row=rows.get(path.split('/').pop());if(!row)throw Object.assign(Error('not found'),{status:404});return row;}};
 const stage=createCursorGalleryImageStage({client,home,siteId:'enter',workspaceId:'enter',resolveImagePolicy:fixtureImagePolicy,jobId:'job-original',galleryRoot:f.root,bridgeOptions:{mode:'fixture',enabled:true,fixtureCommand:{command:process.execPath,args:[resolve('desktop/scripts/agent/bridge.mjs')],callTimeout:6000}},reference:{bytes:png},originalSource,timeoutMs:5000,pollMs:20});
 const slot={blockId:'hero',requirement:'Synthetic source image',alt:'一张用于测试的八乘八像素合成图片不代表任何真实研究',caption:'合成许可素材示意图'};
 const args={plan:{claimId:'job-original',slots:[slot]},directory:job};await assert.rejects(stage.prepare(args),{code:'image_pending'});await approveSyntheticReviews(job);
 const [image]=await stage.prepare(args);assert.equal(image.provenance.kind,'licensed-source');assert.equal(image.provenance.license,'CC0 1.0');assert.equal(image.uploaded,true);
 const state=await inspectCursorGalleryOrphan(f.root);assert.equal(state.phase,'closed');assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].phase,'settled');assert.equal(state.tasks[0].runId,undefined);
});
