import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,unlink,symlink,readlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request,createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createApp,secret} from '../admin/server.mjs';
import {digest} from '../admin/model.mjs';
import {enqueueSiteBuild,createDocument} from '../admin/store.mjs';
import {coordinationConfig,withReleaseLock,sameFence} from '../admin/release-coordination.mjs';
import {SITE} from '../scripts/site-config.mjs';
const linuxRoot=process.platform==='linux'&&process.getuid?.()===0;
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'rssd-admin-coordination-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const fenceRoot=join(root,'fences');await mkdir(fenceRoot,{mode:0o700});
 const c={orchestrationLock:join(root,'orchestration.lock'),publicationLock:join(root,'publication.lock'),fenceRoot};
 await writeFile(c.orchestrationLock,'',{mode:0o644});await writeFile(c.publicationLock,'',{mode:0o644});
 const setFence=async(mode,generation=0,runId=null,jobId,resumeJob)=>writeFile(join(fenceRoot,SITE.id+'.json'),JSON.stringify({siteId:SITE.id,mode,generation,runId,...(jobId?{jobId}:{}),...(resumeJob?{resumeJob}:{})}),{mode:0o600});await setFence('open');
 const publicationRoot=join(root,'public');
 const serving=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path.includes('..')||path.includes('\\'))throw Error('bad path');const payload=await readFile(join(publicationRoot,'current',path));res.writeHead(200);res.end(payload);}catch{res.writeHead(404);res.end();}});serving.listen(0,'127.0.0.1');await once(serving,'listening');t.after(()=>new Promise(r=>serving.close(r)));
 const app=await createApp({dbPath:join(root,'admin.sqlite'),labelsDbPath:join(root,'labels.sqlite'),guestbookEnabled:false,coordination:c,publicationRoot,publicationOrigin:'http://127.0.0.1:'+serving.address().port});
 const draftToken=secret(),workerToken=secret();for(const [id,raw,scope] of [['draft',draftToken,'editorial_draft'],['worker',workerToken,'publisher']])app.db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run(id,id,digest(raw),scope,Date.now());
 await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 return {root,c,app,setFence,draftToken,workerToken,base:'http://127.0.0.1:'+app.server.address().port};
}
const data=key=>({requestKey:key,expectedVersion:0,expectedPublishedVersion:null,data:{id:'coordination-fixture',title:'测试',summary:'摘要',markdown:'# 测试\n\n正文',date:'2026-10-02',author:'编辑',category:'学者观察',assets:[]}});
const headers=token=>({authorization:'Bearer '+token,'content-type':'application/json'});
test('legacy configuration remains compatible and coordinated configuration is complete',()=>{
 assert.equal(coordinationConfig(undefined,{}),null);
 assert.equal(coordinationConfig(undefined,{SCHOLAY_PUBLICATION_LOCK:'/tmp/existing.lock'}),null);
 assert.throws(()=>coordinationConfig(undefined,{SCHOLAY_COORDINATION_REQUIRED:'1'}));
 assert.throws(()=>coordinationConfig(undefined,{SCHOLAY_ORCHESTRATION_LOCK:'/tmp/a'}));
 assert.throws(()=>coordinationConfig({orchestrationLock:'/tmp/a',publicationLock:'/tmp/a',fenceRoot:'/tmp/f'},{}));
});
test('worker fence identity includes generation, run and authorized maintenance job',()=>{
 const fence={siteId:'scholay-today',mode:'maintenance',generation:4,runId:'run-a',jobId:'00000000-0000-4000-8000-000000000001'};
 assert.equal(sameFence(fence,{...fence}),true);
 for(const changed of [{generation:5},{runId:'run-b'},{jobId:'00000000-0000-4000-8000-000000000002'},{mode:'open'},{siteId:'other'}])assert.equal(sameFence(fence,{...fence,...changed}),false);
 const drain={siteId:'scholay-today',mode:'drain',generation:5,runId:'run-a',resumeJob:{table:'jobs',id:'00000000-0000-4000-8000-000000000001',snapshotHash:'a'.repeat(64)}};
 assert.equal(sameFence(drain,{...drain,resumeJob:{...drain.resumeJob}}),true);
 for(const changed of [{table:'site_jobs'},{id:'00000000-0000-4000-8000-000000000002'},{snapshotHash:'b'.repeat(64)}])assert.equal(sameFence(drain,{...drain,resumeJob:{...drain.resumeJob,...changed}}),false);
});
test('legacy status explicitly reports that coordination is disabled',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-admin-legacy-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const app=await createApp({dbPath:join(root,'admin.sqlite'),labelsDbPath:join(root,'labels.sqlite'),guestbookEnabled:false,coordination:null});t.after(()=>app.close());
 const response=await app.inject({method:'GET',url:'/manage/api/content-write-status'});assert.equal(response.statusCode,200);
 assert.equal(response.json().coordination,'disabled');assert.equal(response.json().coordinationSafe,false);
 const version=await app.inject({method:'GET',url:'/manage/api/content-coordination-status'});assert.equal(version.json().protocol,1);
});
test('preparing is read-only, rejects writes and preserves the original request receipt',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),key='original-coordination-request-001';
 const first=await fetch(f.base+'/manage/api/news/drafts',{method:'POST',headers:headers(f.draftToken),body:JSON.stringify(data(key))});assert.equal(first.status,200);
 await f.setFence('preparing',1,'run-1','00000000-0000-4000-8000-000000000001');
 const status=await (await fetch(f.base+'/manage/api/content-write-status')).json();assert.equal(status.state,'preparing');assert.equal(status.readOnly,true);
 const retry=await fetch(f.base+'/manage/api/news/drafts',{method:'POST',headers:headers(f.draftToken),body:JSON.stringify(data(key))});assert.equal(retry.status,409);
 const receipt=await fetch(f.base+'/manage/api/news/drafts/requests/'+key,{headers:{authorization:'Bearer '+f.draftToken}});assert.equal(receipt.status,200);assert.equal((await receipt.json()).requestKey,key);
 assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM content_drafts WHERE key=?').get(key).n,1);
});
test('missing fence and busy lock fail closed before content mutation',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),key='original-coordination-request-002';await unlink(join(f.c.fenceRoot,SITE.id+'.json'));
 const missing=await fetch(f.base+'/manage/api/news/drafts',{method:'POST',headers:headers(f.draftToken),body:JSON.stringify(data(key))});assert.equal(missing.status,503);
 await f.setFence('open');await withReleaseLock(f.c.orchestrationLock,async()=>{const busy=await fetch(f.base+'/manage/api/news/drafts',{method:'POST',headers:headers(f.draftToken),body:JSON.stringify(data(key))});assert.equal(busy.status,503);});
 assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM content_drafts WHERE key=?').get(key).n,0);
});
test('maintenance claim is restricted to the recorded job and rejects foreign work',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),job=enqueueSiteBuild(f.app.db,'test'),now=Date.now();await f.setFence('maintenance',2,'run-2',job.id);
 f.app.db.prepare("INSERT INTO site_jobs(id,action,status,scheduled,created,actor) VALUES(?,'foreign','queued',?,?,?)").run('foreign-job',now,now,'test');
 const doClaim=()=>fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});
 assert.equal((await doClaim()).status,409);assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(job.id).status,'queued');
 f.app.db.prepare('DELETE FROM site_jobs WHERE id=?').run('foreign-job');const claimed=await doClaim();assert.equal(claimed.status,200);assert.equal((await claimed.json()).job.id,job.id);
 const other=await fetch(f.base+'/manage/api/worker/jobs/foreign-job/finish',{method:'POST',headers:headers(f.workerToken),body:'{}'});assert.equal(other.status,409);
});
test('in-flight upload owns the lock and client abort releases it without creating a draft',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),key='original-coordination-request-003';let ignore;const ended=new Promise(r=>ignore=r);
 const req=request(f.base+'/manage/api/news/drafts',{method:'POST',headers:{...headers(f.draftToken),'transfer-encoding':'chunked'}},res=>{res.resume();res.on('end',ignore);});req.on('error',ignore);req.write(JSON.stringify(data(key)).slice(0,20));
 for(let i=0;i<100;i++){const s=await (await fetch(f.base+'/manage/api/content-write-status')).json();if(s.inFlight===1)break;await new Promise(r=>setTimeout(r,10));}
 assert.equal((await (await fetch(f.base+'/manage/api/content-write-status')).json()).inFlight,1);
 await assert.rejects(()=>withReleaseLock(f.c.orchestrationLock,async()=>{}),e=>e.code==='coordination_busy');req.destroy();await ended;
 let released=false;for(let i=0;i<100;i++){const s=await (await fetch(f.base+'/manage/api/content-write-status')).json();if(s.inFlight===0){released=true;break;}await new Promise(r=>setTimeout(r,10));}assert.equal(released,true);
 assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM content_drafts WHERE key=?').get(key).n,0);
});
test('coordinated worker lock contention leaves the original running job recoverable',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),job=enqueueSiteBuild(f.app.db,'test'),doClaim=()=>fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});
 const first=await doClaim();assert.equal(first.status,200);const initial=(await first.json()).job;assert.equal(initial.id,job.id);assert.equal(initial.resume,false);
 await new Promise(r=>setTimeout(r,30));
 await withReleaseLock(f.c.orchestrationLock,async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../admin/worker.mjs',import.meta.url)),'--once'],{env:{...process.env,SCHOLAY_WORKER_TOKEN:f.workerToken,SCHOLAY_ADMIN_API:f.base+'/manage/api',SCHOLAY_COORDINATION_REQUIRED:'1',SCHOLAY_ORCHESTRATION_LOCK:f.c.orchestrationLock,SCHOLAY_PUBLICATION_LOCK:f.c.publicationLock,SCHOLAY_FENCE_ROOT:f.c.fenceRoot},stdio:['ignore','ignore','pipe']});
  let err='';child.stderr.on('data',x=>err+=x);const [status]=await once(child,'close');assert.equal(status,0);assert.match(err,/busy/i);
 });
 const retry=await doClaim();assert.equal(retry.status,200);const recovered=(await retry.json()).job;
 assert.equal(recovered.id,initial.id);assert.equal(recovered.resume,true);assert.equal(recovered.snapshot_hash,initial.snapshot_hash);
});
test('drain does not claim or build a preexisting running job automatically',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),job=enqueueSiteBuild(f.app.db,'test');
 const claimed=await fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});assert.equal(claimed.status,200);const original=(await claimed.json()).job;assert.equal(original.id,job.id);
 await f.setFence('drain',1,'run-drain');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../admin/worker.mjs',import.meta.url)),'--once'],{env:{...process.env,SCHOLAY_WORKER_TOKEN:f.workerToken,SCHOLAY_ADMIN_API:f.base+'/manage/api',SCHOLAY_COORDINATION_REQUIRED:'1',SCHOLAY_ORCHESTRATION_LOCK:f.c.orchestrationLock,SCHOLAY_PUBLICATION_LOCK:f.c.publicationLock,SCHOLAY_FENCE_ROOT:f.c.fenceRoot},stdio:['ignore','ignore','pipe']});
 let err='';child.stderr.on('data',x=>err+=x);const [code]=await once(child,'close');assert.equal(code,0,err);
 const row=f.app.db.prepare('SELECT id,status,snapshot_hash FROM site_jobs WHERE id=?').get(job.id);assert.equal(row.status,'running');assert.equal(row.snapshot_hash,original.snapshot_hash);
 assert.equal(f.app.db.prepare('SELECT count(*) AS n FROM site_jobs').get().n,1);
});

test('drain only resumes its pinned running job and rejects changed snapshots and foreign finish',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),job=enqueueSiteBuild(f.app.db,'test');
 const doClaim=()=>fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});
 const original=(await (await doClaim()).json()).job;
 const queued={id:'00000000-0000-4000-8000-000000000099'},now=Date.now();f.app.db.prepare("INSERT INTO site_jobs(id,action,status,scheduled,created,actor) VALUES(?,'independent-queued','queued',?,?,?)").run(queued.id,now,now,'test');
 const pin={table:'site_jobs',id:job.id,snapshotHash:original.snapshot_hash};await f.setFence('drain',1,'run-drain',undefined,pin);
 const resumed=await doClaim();assert.equal(resumed.status,200);const recovered=(await resumed.json()).job;assert.equal(recovered.id,job.id);assert.equal(recovered.snapshot_hash,original.snapshot_hash);assert.equal(recovered.resume,true);
 const foreign=await fetch(f.base+'/manage/api/worker/jobs/'+queued.id+'/finish',{method:'POST',headers:headers(f.workerToken),body:'{}'});assert.equal(foreign.status,409);
 const failure=await fetch(f.base+'/manage/api/worker/jobs/'+job.id+'/finish',{method:'POST',headers:headers(f.workerToken),body:JSON.stringify({ok:false,error:'old worker result'})});assert.equal(failure.status,409);const stillRunning=f.app.db.prepare('SELECT status,snapshot_hash,snapshot FROM site_jobs WHERE id=?').get(job.id);assert.equal(stillRunning.status,'running');assert.equal(stillRunning.snapshot_hash,pin.snapshotHash);assert.ok(stillRunning.snapshot);
 f.app.db.prepare('UPDATE site_jobs SET snapshot=? WHERE id=?').run('{}',job.id);
 assert.equal((await doClaim()).status,409);
 const finish=await fetch(f.base+'/manage/api/worker/jobs/'+job.id+'/finish',{method:'POST',headers:headers(f.workerToken),body:JSON.stringify({ok:true,hash:pin.snapshotHash,release:'admin-'+job.id})});assert.equal(finish.status,409);
 assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(queued.id).status,'queued');
});
test('worker resumes a previously claimed maintenance job using its original snapshot',{skip:!linuxRoot},async t=>{
 const f=await fixture(t);
 for(const [kind,item] of [
  ['year',{id:'qa-year',title:'测试日程',start:'2026-10-14',category:'学术会议',tags:[],summary:'摘要',sourceUrl:'https://example.org/event',sourceName:'来源',provenance:'已核验官网',dateBasis:'日期'}],
  ['history',{id:'qa-history',title:'测试历史',domain:'领域',eventType:'历史事件',importance:'B',preciseToDay:true,year:2000,dateKey:'10-14',factSummary:'事实',historicalSignificance:'意义',sources:[{label:'来源',url:'https://example.org/history'}]}],
  ['openSource',{title:'测试资源',date:'2026-10-14',url:'https://example.org/resource',summary:'简介',value:'用途',category:'文献与写作'}]
 ])createDocument(f.app.db,kind,item,'test',{seed:true});
 const publicRoot=join(f.root,'public');await mkdir(join(publicRoot,'releases'),{recursive:true});
 const staticServer=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path.includes('..')||path.includes('\\'))throw Error('bad path');const body=await readFile(join(publicRoot,'current',path));res.writeHead(200);res.end(body);}catch{res.writeHead(404);res.end();}});
 staticServer.listen(0,'127.0.0.1');await once(staticServer,'listening');t.after(()=>new Promise(r=>staticServer.close(r)));
 const job=enqueueSiteBuild(f.app.db,'test');await f.setFence('maintenance',2,'run-3',job.id);
 const claimed=await fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});assert.equal(claimed.status,200);const initial=(await claimed.json()).job;assert.equal(initial.id,job.id);assert.equal(initial.resume,false);
 await new Promise(r=>setTimeout(r,30));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../admin/worker.mjs',import.meta.url)),'--once'],{env:{...process.env,SCHOLAY_WORKER_TOKEN:f.workerToken,SCHOLAY_ADMIN_API:f.base+'/manage/api',SCHOLAY_COORDINATION_REQUIRED:'1',SCHOLAY_ORCHESTRATION_LOCK:f.c.orchestrationLock,SCHOLAY_PUBLICATION_LOCK:f.c.publicationLock,SCHOLAY_FENCE_ROOT:f.c.fenceRoot,SCHOLAY_PUBLIC_ROOT:publicRoot,SCHOLAY_PUBLIC_ORIGIN:'http://127.0.0.1:'+staticServer.address().port},stdio:['ignore','pipe','pipe']});
 let err='',out='';child.stderr.on('data',x=>err+=x);child.stdout.on('data',x=>out+=x);const [exit]=await once(child,'close');assert.equal(exit,0,err);
 const row=f.app.db.prepare('SELECT id,status,release,snapshot_hash FROM site_jobs WHERE id=?').get(job.id);assert.equal(row.status,'success',JSON.stringify({err,out,row}));assert.equal(row.id,initial.id);assert.equal(row.snapshot_hash,initial.snapshot_hash);assert.equal(row.release,'admin-'+initial.id);
});

test('worker finishes only the authorized original running job during drain',{skip:!linuxRoot},async t=>{
 const f=await fixture(t);
 for(const [kind,item] of [
  ['year',{id:'qa-year',title:'测试日程',start:'2026-10-14',category:'学术会议',tags:[],summary:'摘要',sourceUrl:'https://example.org/event',sourceName:'来源',provenance:'已核验官网',dateBasis:'日期'}],
  ['history',{id:'qa-history',title:'测试历史',domain:'领域',eventType:'历史事件',importance:'B',preciseToDay:true,year:2000,dateKey:'10-14',factSummary:'事实',historicalSignificance:'意义',sources:[{label:'来源',url:'https://example.org/history'}]}],
  ['openSource',{title:'测试资源',date:'2026-10-14',url:'https://example.org/resource',summary:'简介',value:'用途',category:'文献与写作'}]
 ])createDocument(f.app.db,kind,item,'test',{seed:true});
 const publicRoot=join(f.root,'public');await mkdir(join(publicRoot,'releases'),{recursive:true});
 const staticServer=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path.includes('..')||path.includes('\\'))throw Error('bad path');const body=await readFile(join(publicRoot,'current',path));res.writeHead(200);res.end(body);}catch{res.writeHead(404);res.end();}});
 staticServer.listen(0,'127.0.0.1');await once(staticServer,'listening');t.after(()=>new Promise(r=>staticServer.close(r)));
 const job=enqueueSiteBuild(f.app.db,'test');await f.setFence('maintenance',2,'run-3',job.id);
 const claimed=await fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});assert.equal(claimed.status,200);const initial=(await claimed.json()).job;assert.equal(initial.id,job.id);assert.equal(initial.resume,false);
 const previous=join(publicRoot,'releases','20261101-010101');await mkdir(previous);await writeFile(join(previous,'index.html'),'previous');await symlink(previous,join(publicRoot,'current'),'dir');
 const queued={id:'00000000-0000-4000-8000-000000000099'},now=Date.now();f.app.db.prepare("INSERT INTO site_jobs(id,action,status,scheduled,created,actor) VALUES(?,'independent-queued','queued',?,?,?)").run(queued.id,now,now,'test');await f.setFence('drain',3,'run-4',undefined,{table:'site_jobs',id:job.id,snapshotHash:initial.snapshot_hash});
 await new Promise(r=>setTimeout(r,30));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../admin/worker.mjs',import.meta.url)),'--once'],{env:{...process.env,SCHOLAY_WORKER_TOKEN:f.workerToken,SCHOLAY_ADMIN_API:f.base+'/manage/api',SCHOLAY_COORDINATION_REQUIRED:'1',SCHOLAY_ORCHESTRATION_LOCK:f.c.orchestrationLock,SCHOLAY_PUBLICATION_LOCK:f.c.publicationLock,SCHOLAY_FENCE_ROOT:f.c.fenceRoot,SCHOLAY_PUBLIC_ROOT:publicRoot,SCHOLAY_PUBLIC_ORIGIN:'http://127.0.0.1:'+staticServer.address().port},stdio:['ignore','pipe','pipe']});
 let err='',out='';child.stderr.on('data',x=>err+=x);child.stdout.on('data',x=>out+=x);const [exit]=await once(child,'close');assert.equal(exit,0,err);
 const row=f.app.db.prepare('SELECT id,status,release,snapshot_hash FROM site_jobs WHERE id=?').get(job.id);assert.equal(row.status,'success',JSON.stringify({err,out,row}));assert.equal(row.id,initial.id);assert.equal(row.snapshot_hash,initial.snapshot_hash);assert.equal(row.release,'admin-'+initial.id);assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(queued.id).status,'queued');
});

test('drain verification failure preserves original running job and release for reconciliation',{skip:!linuxRoot},async t=>{
 const f=await fixture(t);
 for(const [kind,item] of [
  ['year',{id:'qa-year',title:'测试日程',start:'2026-10-14',category:'学术会议',tags:[],summary:'摘要',sourceUrl:'https://example.org/event',sourceName:'来源',provenance:'已核验官网',dateBasis:'日期'}],
  ['history',{id:'qa-history',title:'测试历史',domain:'领域',eventType:'历史事件',importance:'B',preciseToDay:true,year:2000,dateKey:'10-14',factSummary:'事实',historicalSignificance:'意义',sources:[{label:'来源',url:'https://example.org/history'}]}],
  ['openSource',{title:'测试资源',date:'2026-10-14',url:'https://example.org/resource',summary:'简介',value:'用途',category:'文献与写作'}]
 ])createDocument(f.app.db,kind,item,'test',{seed:true});
 const publicRoot=join(f.root,'public');await mkdir(join(publicRoot,'releases'),{recursive:true});
 const staticServer=createServer(async(req,res)=>{try{throw Error('synthetic public readback failure');const path=new URL(req.url,'http://localhost').pathname;if(path.includes('..')||path.includes('\\'))throw Error('bad path');const body=await readFile(join(publicRoot,'current',path));res.writeHead(200);res.end(body);}catch{res.writeHead(404);res.end();}});
 staticServer.listen(0,'127.0.0.1');await once(staticServer,'listening');t.after(()=>new Promise(r=>staticServer.close(r)));
 const job=enqueueSiteBuild(f.app.db,'test');await f.setFence('maintenance',2,'run-3',job.id);
 const claimed=await fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});assert.equal(claimed.status,200);const initial=(await claimed.json()).job;assert.equal(initial.id,job.id);assert.equal(initial.resume,false);
 const previous=join(publicRoot,'releases','20261101-010101');await mkdir(previous);await writeFile(join(previous,'index.html'),'previous');await symlink(previous,join(publicRoot,'current'),'dir');
 const queued={id:'00000000-0000-4000-8000-000000000099'},now=Date.now();f.app.db.prepare("INSERT INTO site_jobs(id,action,status,scheduled,created,actor) VALUES(?,'independent-queued','queued',?,?,?)").run(queued.id,now,now,'test');await f.setFence('drain',3,'run-4',undefined,{table:'site_jobs',id:job.id,snapshotHash:initial.snapshot_hash});
 await new Promise(r=>setTimeout(r,30));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../admin/worker.mjs',import.meta.url)),'--once'],{env:{...process.env,SCHOLAY_WORKER_TOKEN:f.workerToken,SCHOLAY_ADMIN_API:f.base+'/manage/api',SCHOLAY_COORDINATION_REQUIRED:'1',SCHOLAY_ORCHESTRATION_LOCK:f.c.orchestrationLock,SCHOLAY_PUBLICATION_LOCK:f.c.publicationLock,SCHOLAY_FENCE_ROOT:f.c.fenceRoot,SCHOLAY_PUBLIC_ROOT:publicRoot,SCHOLAY_PUBLIC_ORIGIN:'http://127.0.0.1:'+staticServer.address().port},stdio:['ignore','pipe','pipe']});
 let err='',out='';child.stderr.on('data',x=>err+=x);child.stdout.on('data',x=>out+=x);const [exit]=await once(child,'close');assert.equal(exit,0,err);
 const row=f.app.db.prepare('SELECT id,status,release,snapshot_hash FROM site_jobs WHERE id=?').get(job.id);assert.equal(row.status,'running',JSON.stringify({err,out,row}));assert.equal(row.id,initial.id);assert.equal(row.snapshot_hash,initial.snapshot_hash);assert.equal(row.release,null);assert.match(out,/reconciliation-required/);const manifest=JSON.parse(await readFile(join(publicRoot,'releases','admin-'+job.id,'release.json'),'utf8'));assert.equal(manifest.jobId,job.id);assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(queued.id).status,'queued');
});

test('drain active-release recovery failure does not move the current pointer',{skip:!linuxRoot},async t=>{
 const f=await fixture(t);
 for(const [kind,item] of [
  ['year',{id:'qa-year',title:'测试日程',start:'2026-10-14',category:'学术会议',tags:[],summary:'摘要',sourceUrl:'https://example.org/event',sourceName:'来源',provenance:'已核验官网',dateBasis:'日期'}],
  ['history',{id:'qa-history',title:'测试历史',domain:'领域',eventType:'历史事件',importance:'B',preciseToDay:true,year:2000,dateKey:'10-14',factSummary:'事实',historicalSignificance:'意义',sources:[{label:'来源',url:'https://example.org/history'}]}],
  ['openSource',{title:'测试资源',date:'2026-10-14',url:'https://example.org/resource',summary:'简介',value:'用途',category:'文献与写作'}]
 ])createDocument(f.app.db,kind,item,'test',{seed:true});
 const publicRoot=join(f.root,'public');await mkdir(join(publicRoot,'releases'),{recursive:true});
 const staticServer=createServer(async(req,res)=>{try{throw Error('synthetic public readback failure');const path=new URL(req.url,'http://localhost').pathname;if(path.includes('..')||path.includes('\\'))throw Error('bad path');const body=await readFile(join(publicRoot,'current',path));res.writeHead(200);res.end(body);}catch{res.writeHead(404);res.end();}});
 staticServer.listen(0,'127.0.0.1');await once(staticServer,'listening');t.after(()=>new Promise(r=>staticServer.close(r)));
 const job=enqueueSiteBuild(f.app.db,'test');await f.setFence('maintenance',2,'run-3',job.id);
 const claimed=await fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});assert.equal(claimed.status,200);const initial=(await claimed.json()).job;assert.equal(initial.id,job.id);assert.equal(initial.resume,false);
 const queued={id:'00000000-0000-4000-8000-000000000099'},now=Date.now();f.app.db.prepare("INSERT INTO site_jobs(id,action,status,scheduled,created,actor) VALUES(?,'independent-queued','queued',?,?,?)").run(queued.id,now,now,'test');await f.setFence('drain',3,'run-4',undefined,{table:'site_jobs',id:job.id,snapshotHash:initial.snapshot_hash});
 await new Promise(r=>setTimeout(r,30));
 const active=join(publicRoot,'releases','admin-'+job.id),previous=join(publicRoot,'releases','20261101-010101');await mkdir(active);await mkdir(previous);await writeFile(join(previous,'index.html'),'previous');await writeFile(join(active,'release.json'),JSON.stringify({jobId:job.id,snapshotHash:initial.snapshot_hash,release:'admin-'+job.id,previousRelease:'20261101-010101'}));await symlink(active,join(publicRoot,'current'),'dir');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../admin/worker.mjs',import.meta.url)),'--once'],{env:{...process.env,SCHOLAY_WORKER_TOKEN:f.workerToken,SCHOLAY_ADMIN_API:f.base+'/manage/api',SCHOLAY_COORDINATION_REQUIRED:'1',SCHOLAY_ORCHESTRATION_LOCK:f.c.orchestrationLock,SCHOLAY_PUBLICATION_LOCK:f.c.publicationLock,SCHOLAY_FENCE_ROOT:f.c.fenceRoot,SCHOLAY_PUBLIC_ROOT:publicRoot,SCHOLAY_PUBLIC_ORIGIN:'http://127.0.0.1:'+staticServer.address().port},stdio:['ignore','pipe','pipe']});
 let err='',out='';child.stderr.on('data',x=>err+=x);child.stdout.on('data',x=>out+=x);const [exit]=await once(child,'close');assert.equal(exit,0,err);
 const row=f.app.db.prepare('SELECT id,status,release,snapshot_hash FROM site_jobs WHERE id=?').get(job.id);assert.equal(row.status,'running',JSON.stringify({err,out,row}));assert.equal(row.id,initial.id);assert.equal(row.snapshot_hash,initial.snapshot_hash);assert.equal(row.release,null);assert.match(err,/lacks transaction marker/i);assert.equal(await readlink(join(publicRoot,'current')),active);assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(queued.id).status,'queued');
});


test('drain rejects interrupted rollback marker without changing live pointer',{skip:!linuxRoot},async t=>{
 const f=await fixture(t);
 for(const [kind,item] of [
  ['year',{id:'qa-year',title:'测试日程',start:'2026-10-14',category:'学术会议',tags:[],summary:'摘要',sourceUrl:'https://example.org/event',sourceName:'来源',provenance:'已核验官网',dateBasis:'日期'}],
  ['history',{id:'qa-history',title:'测试历史',domain:'领域',eventType:'历史事件',importance:'B',preciseToDay:true,year:2000,dateKey:'10-14',factSummary:'事实',historicalSignificance:'意义',sources:[{label:'来源',url:'https://example.org/history'}]}],
  ['openSource',{title:'测试资源',date:'2026-10-14',url:'https://example.org/resource',summary:'简介',value:'用途',category:'文献与写作'}]
 ])createDocument(f.app.db,kind,item,'test',{seed:true});
 const publicRoot=join(f.root,'public');await mkdir(join(publicRoot,'releases'),{recursive:true});
 const staticServer=createServer(async(req,res)=>{try{throw Error('synthetic public readback failure');const path=new URL(req.url,'http://localhost').pathname;if(path.includes('..')||path.includes('\\'))throw Error('bad path');const body=await readFile(join(publicRoot,'current',path));res.writeHead(200);res.end(body);}catch{res.writeHead(404);res.end();}});
 staticServer.listen(0,'127.0.0.1');await once(staticServer,'listening');t.after(()=>new Promise(r=>staticServer.close(r)));
 const job=enqueueSiteBuild(f.app.db,'test');await f.setFence('maintenance',2,'run-3',job.id);
 const claimed=await fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});assert.equal(claimed.status,200);const initial=(await claimed.json()).job;assert.equal(initial.id,job.id);assert.equal(initial.resume,false);
 const queued={id:'00000000-0000-4000-8000-000000000099'},now=Date.now();f.app.db.prepare("INSERT INTO site_jobs(id,action,status,scheduled,created,actor) VALUES(?,'independent-queued','queued',?,?,?)").run(queued.id,now,now,'test');await f.setFence('drain',3,'run-4',undefined,{table:'site_jobs',id:job.id,snapshotHash:initial.snapshot_hash});
 await new Promise(r=>setTimeout(r,30));
 const active=join(publicRoot,'releases','admin-'+job.id),previous=join(publicRoot,'releases','20261101-010101');await mkdir(active);await mkdir(previous);await writeFile(join(previous,'index.html'),'previous');await writeFile(join(active,'release.json'),JSON.stringify({jobId:job.id,snapshotHash:initial.snapshot_hash,release:'admin-'+job.id,previousRelease:'20261101-010101'}));await symlink(active,join(publicRoot,'current'),'dir');await symlink(previous,join(publicRoot,'.rssd-drain-incomplete'),'dir');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../admin/worker.mjs',import.meta.url)),'--once'],{env:{...process.env,SCHOLAY_WORKER_TOKEN:f.workerToken,SCHOLAY_ADMIN_API:f.base+'/manage/api',SCHOLAY_COORDINATION_REQUIRED:'1',SCHOLAY_ORCHESTRATION_LOCK:f.c.orchestrationLock,SCHOLAY_PUBLICATION_LOCK:f.c.publicationLock,SCHOLAY_FENCE_ROOT:f.c.fenceRoot,SCHOLAY_PUBLIC_ROOT:publicRoot,SCHOLAY_PUBLIC_ORIGIN:'http://127.0.0.1:'+staticServer.address().port},stdio:['ignore','pipe','pipe']});
 let err='',out='';child.stderr.on('data',x=>err+=x);child.stdout.on('data',x=>out+=x);const [exit]=await once(child,'close');assert.equal(exit,0,err);
 const row=f.app.db.prepare('SELECT id,status,release,snapshot_hash FROM site_jobs WHERE id=?').get(job.id);assert.equal(row.status,'running',JSON.stringify({err,out,row}));assert.equal(row.id,initial.id);assert.equal(row.snapshot_hash,initial.snapshot_hash);assert.equal(row.release,null);assert.match(err,/link marker requires reconciliation/i);assert.equal(await readlink(join(publicRoot,'current')),active);assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(queued.id).status,'queued');
});
