import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,unlink,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createApp,secret} from '../admin/server.mjs';
import {digest} from '../admin/model.mjs';
import {SITE} from '../scripts/site-config.mjs';
const linuxRoot=process.platform==='linux'&&process.getuid?.()===0;
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'rssd-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const fenceRoot=join(root,'fences');await mkdir(fenceRoot,{mode:0o700});const c={orchestrationLock:join(root,'orchestration.lock'),publicationLock:join(root,'publication.lock'),fenceRoot};
 await writeFile(c.orchestrationLock,'',{mode:0o644});await writeFile(c.publicationLock,'',{mode:0o644});
 const setFence=async(mode,generation=0,resumeJob)=>writeFile(join(fenceRoot,SITE.id+'.json'),JSON.stringify({siteId:SITE.id,mode,generation,runId:mode==='open'?null:'run-1',...(resumeJob?{resumeJob}:{})}),{mode:0o600});await setFence('open');
 const publicRoot=join(root,'public');await mkdir(join(publicRoot,'releases'),{recursive:true});
 const staticServer=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.includes('..')||p.includes('\\'))throw Error('bad');res.writeHead(200);res.end(await readFile(join(publicRoot,'current',p)));}catch{if(!res.headersSent)res.writeHead(404);res.end();}});staticServer.listen(0,'127.0.0.1');await once(staticServer,'listening');t.after(()=>new Promise(r=>staticServer.close(r)));
 const app=await createApp({dbPath:join(root,'admin.sqlite'),labelsDbPath:join(root,'labels.sqlite'),guestbookEnabled:false,coordination:c,publicationRoot:publicRoot,publicationOrigin:'http://127.0.0.1:'+staticServer.address().port});t.after(()=>app.close());
 const token=secret();app.db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run('worker','worker',digest(token),'publisher',Date.now());await app.listen({host:'127.0.0.1',port:0});
 const base='http://127.0.0.1:'+app.server.address().port,headers={authorization:'Bearer '+token,'content-type':'application/json'};
 return {root,c,setFence,publicRoot,app,base,headers};
}
test('coordination status and writes fail closed when a pinned lock disappears or is replaced',{skip:!linuxRoot},async t=>{
 const f=await fixture(t);assert.equal((await fetch(f.base+'/manage/api/content-write-status')).status,200);
 await unlink(f.c.publicationLock);assert.equal((await fetch(f.base+'/manage/api/content-write-status')).status,503);
 await writeFile(f.c.publicationLock,'',{mode:0o644});assert.equal((await fetch(f.base+'/manage/api/content-coordination-status')).status,503);
 const write=await fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:f.headers,body:'{}'});assert.equal(write.status,503);
});
test('a busy valid lock does not masquerade as a missing coordination lock',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),child=spawn('flock',['--exclusive',f.c.orchestrationLock,'sh','-c','printf ready; sleep 1'],{stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill('SIGTERM'));const [chunk]=await once(child.stdout,'data');assert.equal(chunk.toString(),'ready');
 const status=await fetch(f.base+'/manage/api/content-write-status');assert.equal(status.status,200);assert.equal((await status.json()).coordination,'active');
 const busy=await fetch(f.base+'/manage/api/worker/claim',{method:'POST',headers:f.headers,body:'{}'});assert.equal(busy.status,503);
 await once(child,'close');
});
test('drain receipt is publisher-only, read-only and bound to the pinned job and snapshot',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),id='00000000-0000-4000-8000-000000000001',snapshot='{}',hash=digest(snapshot),now=Date.now();
 f.app.db.prepare("INSERT INTO site_jobs(id,action,status,scheduled,created,actor,snapshot,snapshot_hash) VALUES(?,'rebuild','running',?,?,'test',?,?)").run(id,now,now,snapshot,hash);
 await f.setFence('drain',1,{table:'site_jobs',id,snapshotHash:hash});const url=f.base+'/manage/api/worker/jobs/'+id+'/drain-receipt';
 assert.equal((await fetch(url)).status,401);const ok=await fetch(url,{headers:f.headers});assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{id,status:'running',release:null,snapshot_hash:hash});
 assert.equal(f.app.db.prepare('SELECT last_used FROM tokens WHERE id=?').get('worker').last_used,null);
 assert.equal((await fetch(f.base+'/manage/api/worker/jobs/00000000-0000-4000-8000-000000000002/drain-receipt',{headers:f.headers})).status,409);
 f.app.db.prepare('UPDATE site_jobs SET snapshot=? WHERE id=?').run('{"changed":true}',id);assert.equal((await fetch(url,{headers:f.headers})).status,409);
});
test('drain failure finish preserves original snapshot; success requires current identity and live readback',{skip:!linuxRoot},async t=>{
 const f=await fixture(t),id='00000000-0000-4000-8000-000000000003',snapshot='{}',hash=digest(snapshot),now=Date.now(),release='admin-'+id;
 f.app.db.prepare("INSERT INTO site_jobs(id,action,status,scheduled,created,actor,snapshot,snapshot_hash) VALUES(?,'rebuild','running',?,?,'test',?,?)").run(id,now,now,snapshot,hash);await f.setFence('drain',1,{table:'site_jobs',id,snapshotHash:hash});
 const url=f.base+'/manage/api/worker/jobs/'+id+'/finish',send=body=>fetch(url,{method:'POST',headers:f.headers,body:JSON.stringify(body)}),row=()=>f.app.db.prepare('SELECT status,snapshot,snapshot_hash FROM site_jobs WHERE id=?').get(id);
 assert.equal((await send({ok:false,error:'failed before drain'})).status,409);assert.deepEqual({...row()},{status:'running',snapshot,snapshot_hash:hash});
 assert.equal((await send({ok:true,hash,release})).status,409);assert.equal(row().status,'running');
 const dir=join(f.publicRoot,'releases',release),html='release body';await mkdir(dir);await writeFile(join(dir,'index.html'),html);const manifest={jobId:id,snapshotHash:hash,release,hashes:{'index.html':digest(html)}};await writeFile(join(dir,'release.json'),JSON.stringify(manifest));await symlink(dir,join(f.publicRoot,'current'));
 await writeFile(join(dir,'index.html'),'changed');assert.equal((await send({ok:true,hash,release})).status,409);assert.equal(row().status,'running');
 await writeFile(join(dir,'index.html'),html);assert.equal((await send({ok:true,hash,release})).status,200);assert.equal(row().status,'success');
 const receipt=await fetch(f.base+'/manage/api/worker/jobs/'+id+'/drain-receipt',{headers:f.headers});assert.equal(receipt.status,200);assert.deepEqual(await receipt.json(),{id,status:'success',release,snapshot_hash:hash});
});
