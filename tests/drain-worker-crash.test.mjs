import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,unlink,symlink,readlink,readdir} from 'node:fs/promises';
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

async function prepared(t){
 const f=await fixture(t);for(const [kind,item] of [
  ['year',{id:'qa-year',title:'测试日程',start:'2026-10-14',category:'学术会议',tags:[],summary:'摘要',sourceUrl:'https://example.org/event',sourceName:'来源',provenance:'已核验官网',dateBasis:'日期'}],
  ['history',{id:'qa-history',title:'测试历史',domain:'领域',eventType:'历史事件',importance:'B',preciseToDay:true,year:2000,dateKey:'10-14',factSummary:'事实',historicalSignificance:'意义',sources:[{label:'来源',url:'https://example.org/history'}]}],
  ['openSource',{title:'测试资源',date:'2026-10-14',url:'https://example.org/resource',summary:'简介',value:'用途',category:'文献与写作'}]
 ])createDocument(f.app.db,kind,item,'test',{seed:true});
 const publicRoot=join(f.root,'public'),previous=join(publicRoot,'releases','20261101-010101');await mkdir(previous,{recursive:true});await writeFile(join(previous,'index.html'),'old');await symlink(previous,join(publicRoot,'current'),'dir');
 const job=enqueueSiteBuild(f.app.db,'test');const claim=await fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:headers(f.workerToken),body:'{}'});assert.equal(claim.status,200);const original=(await claim.json()).job;await f.setFence('drain',1,'run-crash',undefined,{table:'site_jobs',id:job.id,snapshotHash:original.snapshot_hash});
 return {...f,publicRoot,previous,job,original};
}
function childWorker(f,api,origin){return spawn(process.execPath,[fileURLToPath(new URL('../admin/worker.mjs',import.meta.url)),'--once'],{env:{...process.env,SCHOLAY_WORKER_TOKEN:f.workerToken,SCHOLAY_ADMIN_API:api+'/manage/api',SCHOLAY_COORDINATION_REQUIRED:'1',SCHOLAY_ORCHESTRATION_LOCK:f.c.orchestrationLock,SCHOLAY_PUBLICATION_LOCK:f.c.publicationLock,SCHOLAY_FENCE_ROOT:f.c.fenceRoot,SCHOLAY_PUBLIC_ROOT:f.publicRoot,SCHOLAY_PUBLIC_ORIGIN:origin},stdio:['ignore','pipe','pipe']});}
async function localServer(t,handler){const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));return {server,origin:'http://127.0.0.1:'+server.address().port};}
async function verifyFile(req,res,root){try{const p=new URL(req.url,'http://localhost').pathname;if(p.includes('..')||p.includes('\\'))throw Error('bad path');const data=await readFile(join(root,'current',p));res.writeHead(200);res.end(data);}catch{res.writeHead(404);res.end();}}
async function run(child){let error='',out='';child.stderr.on('data',x=>error+=x);child.stdout.on('data',x=>out+=x);const [code,signal]=await once(child,'close');return {code,signal,error,out};}
test('real worker SIGKILL after pointer switch resumes the same job and retains receipt identity',{skip:!linuxRoot},async t=>{
 const f=await prepared(t);let child,armed=true;const web=await localServer(t,(req,res)=>{if(armed){armed=false;child.kill('SIGKILL');res.destroy();}else void verifyFile(req,res,f.publicRoot);});
 child=childWorker(f,f.base,web.origin);const first=await run(child);assert.equal(first.signal,'SIGKILL',JSON.stringify(first));assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(f.job.id).status,'running');assert.ok((await readdir(f.publicRoot)).some(x=>x==='.rssd-drain-'+f.job.id+'.json'));
 await new Promise(r=>setTimeout(r,100));child=childWorker(f,f.base,web.origin);const second=await run(child);const row=f.app.db.prepare('SELECT status,release,snapshot_hash FROM site_jobs WHERE id=?').get(f.job.id);assert.equal(row.status,'success',JSON.stringify({row,second}));assert.equal(row.snapshot_hash,f.original.snapshot_hash);assert.equal(row.release,'admin-'+f.job.id);assert.ok(!(await readdir(f.publicRoot)).some(x=>x==='.rssd-drain-'+f.job.id+'.json'));
});
test('real worker SIGKILL after committed finish reconciles success marker without another build',{skip:!linuxRoot},async t=>{
 const f=await prepared(t);let child,armed=true;const web=await localServer(t,(req,res)=>void verifyFile(req,res,f.publicRoot));
 const proxy=await localServer(t,(req,res)=>{const upstream=request(f.base+req.url,{method:req.method,headers:req.headers},r=>{if(armed&&req.url.endsWith('/finish')&&r.statusCode===200){armed=false;child.kill('SIGKILL');r.resume();res.destroy();return;}res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);});
 child=childWorker(f,proxy.origin,web.origin);const first=await run(child);assert.equal(first.signal,'SIGKILL',JSON.stringify(first));const row=f.app.db.prepare('SELECT status,release,snapshot_hash FROM site_jobs WHERE id=?').get(f.job.id);assert.equal(row.status,'success');assert.equal(row.snapshot_hash,f.original.snapshot_hash);assert.ok((await readdir(f.publicRoot)).includes('.rssd-drain-'+f.job.id+'.json'));
 await new Promise(r=>setTimeout(r,100));child=childWorker(f,proxy.origin,web.origin);const second=await run(child);assert.equal(second.code,0,JSON.stringify(second));assert.ok(!(await readdir(f.publicRoot)).includes('.rssd-drain-'+f.job.id+'.json'));assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(f.job.id).status,'success');assert.equal((await readdir(join(f.publicRoot,'releases'))).filter(x=>x==='admin-'+f.job.id).length,1);
});
test('worker killed after public verification before finish rolls back safely if readback later fails',{skip:!linuxRoot},async t=>{
 const f=await prepared(t);let child,armed=true,readbackBroken=false;const web=await localServer(t,(req,res)=>{if(readbackBroken){res.writeHead(503);res.end();}else void verifyFile(req,res,f.publicRoot);});
 const proxy=await localServer(t,(req,res)=>{if(armed&&req.url.endsWith('/finish')){armed=false;child.kill('SIGKILL');req.resume();res.destroy();return;}const upstream=request(f.base+req.url,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);});
 child=childWorker(f,proxy.origin,web.origin);const first=await run(child);assert.equal(first.signal,'SIGKILL',JSON.stringify(first));assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(f.job.id).status,'running');assert.ok((await readdir(f.publicRoot)).includes('.rssd-drain-'+f.job.id+'.json'));
 readbackBroken=true;await new Promise(r=>setTimeout(r,100));child=childWorker(f,proxy.origin,web.origin);const second=await run(child);assert.equal(second.code,0,JSON.stringify(second));assert.equal(await readlink(join(f.publicRoot,'current')),f.previous);assert.equal(f.app.db.prepare('SELECT status FROM site_jobs WHERE id=?').get(f.job.id).status,'running');assert.ok((await readdir(f.publicRoot)).includes('.rssd-drain-'+f.job.id+'.json'));assert.equal((await readdir(join(f.publicRoot,'releases'))).filter(x=>x==='admin-'+f.job.id).length,1);
});
