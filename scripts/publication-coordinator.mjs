#!/usr/bin/env node
// Root-only drain coordinator. This does not prove exclusive site ownership or
// implement freeze, cutover, reopening, deployment, or automatic job release.
import {constants, lstatSync, readFileSync} from 'node:fs';
import {lstat, open, realpath, rename} from 'node:fs/promises';
import {isAbsolute, join, normalize} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {withReleaseLock, readFence, sameFence} from '../admin/release-coordination.mjs';
import {beginDescriptorObservation, finishDescriptorObservation, verifyDescriptor} from '../admin/sqlite-fd-binding.mjs';

const CONFIG='/etc/rssd/publication-coordination.json';
const digest=x=>createHash('sha256').update(x).digest('hex');
function trustedConfig(){
 if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('Linux root required');
 for(const path of ['/etc','/etc/rssd']){const s=lstatSync(path);if(!s.isDirectory()||s.uid!==0||(s.mode&0o022))throw Error('Unsafe configuration directory');}
 const s=lstatSync(CONFIG);if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o022)||s.size>4096)throw Error('Unsafe configuration');
 const c=JSON.parse(readFileSync(CONFIG,'utf8'));
 const keys=['fenceRoot','legacyDb','legacyUid','orchestrationLock','publicationLock','receiverDb','receiverUid','releaseRoot','siteId'];
 if(Object.keys(c).sort().join(',')!==keys.sort().join(',')||c.siteId!=='scholay-today')throw Error('Invalid configuration fields or site');
 for(const k of ['fenceRoot','legacyDb','orchestrationLock','publicationLock','receiverDb','releaseRoot'])if(typeof c[k]!=='string'||!isAbsolute(c[k])||normalize(c[k])!==c[k])throw Error('Invalid configured path');
 for(const k of ['legacyUid','receiverUid'])if(!Number.isSafeInteger(c[k])||c[k]<0)throw Error('Invalid database owner');
 if(new Set([c.legacyDb,c.receiverDb,c.orchestrationLock,c.publicationLock]).size!==4)throw Error('Conflicting configured paths');
 return c;
}
function openDb(path,uid){
 const st=lstatSync(path);if(!st.isFile()||st.uid!==uid||st.nlink!==1||(st.mode&0o022))throw Error('Unsafe database');
 const before=beginDescriptorObservation(path);if(!before.current)throw Error('Missing database');
 let db;try{db=new DatabaseSync(path);const binding=finishDescriptorObservation(before);verifyDescriptor(binding);db.exec('PRAGMA busy_timeout=400; BEGIN IMMEDIATE');verifyDescriptor(binding);return {db,binding};}
 catch(e){try{db?.close();}catch{}throw e;}
}
function count(db,table,column){
 if(!db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table))throw Error('Missing queue table');
 return db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} IN ('queued',${column==='state'?"'building'":"'running'"})`).get().n;
}
async function main(){
 const c=trustedConfig(),[operation,runId,genRaw,...extra]=process.argv.slice(2);
 if(extra.length||!['drain','inspect-drain'].includes(operation)||!/^[A-Za-z0-9_-]{1,64}$/.test(runId||'')||!/^(0|[1-9]\d{0,8})$/.test(genRaw||''))throw Error('Only drain and inspect-drain are supported');
 const generation=Number(genRaw),fencePath=join(c.fenceRoot,c.siteId+'.json'),pending=join(c.fenceRoot,c.siteId+'.pending');
 return withReleaseLock(c.orchestrationLock,async verifyOrch=>withReleaseLock(c.publicationLock,async verifyPub=>{
  try{await lstat(pending);throw Error('Pending transition requires manual reconciliation');}catch(e){if(e.code!=='ENOENT')throw e;}
  const before=await readFence(c.fenceRoot,c.siteId);
  if(before.generation!==generation||(operation==='drain'?(before.mode!=='open'):(before.mode!=='drain'||before.runId!==runId)))throw Error('Stale mode, generation or run');
  let receiver,legacy;try{
   receiver=openDb(c.receiverDb,c.receiverUid);legacy=openDb(c.legacyDb,c.legacyUid);
   const counts={receiver:count(receiver.db,'requests','state'),bindings:count(receiver.db,'binding_refreshes','state'),legacy:count(legacy.db,'jobs','status'),legacyBuilds:count(legacy.db,'site_jobs','status')};
   const running=[];for(const table of ['jobs','site_jobs'])for(const row of legacy.db.prepare(`SELECT id,snapshot,snapshot_hash FROM ${table} WHERE status='running'`).all())running.push({table,...row});
   if(running.length>1&&operation==='drain')throw Error('Multiple running jobs require reconciliation');
   let resumeJob,runningSnapshotValid=null;if(running.length){const r=running[0];runningSnapshotValid=/^[a-f0-9-]{36}$/.test(r.id||'')&&typeof r.snapshot==='string'&&/^[a-f0-9]{64}$/.test(r.snapshot_hash||'')&&digest(r.snapshot)===r.snapshot_hash;if(!runningSnapshotValid&&operation==='drain')throw Error('Running snapshot identity invalid');if(runningSnapshotValid)resumeJob={table:r.table,id:r.id,snapshotHash:r.snapshot_hash};}
   await verifyOrch();await verifyPub();verifyDescriptor(receiver.binding);verifyDescriptor(legacy.binding);
   const scope='Shared-lock drain only; site freeze and exclusive writer ownership are not verified';
   if(operation==='inspect-drain'){
    const root=await lstat(c.releaseRoot);if(!root.isDirectory()||await realpath(c.releaseRoot)!==c.releaseRoot)throw Error('Unsafe release root');
    let artifacts=null;
    if(before.resumeJob){artifacts={};for(const [key,name] of [['stage','.building-'+before.resumeJob.id],['release','admin-'+before.resumeJob.id]]){
     try{const st=await lstat(join(c.releaseRoot,name));artifacts[key]={path:join(c.releaseRoot,name),type:st.isDirectory()?'directory':st.isSymbolicLink()?'symlink':'other'};}
     catch(e){if(e.code!=='ENOENT')throw e;artifacts[key]={path:join(c.releaseRoot,name),type:'absent'};}
    }}
    await verifyOrch();await verifyPub();verifyDescriptor(receiver.binding);verifyDescriptor(legacy.binding);
    return {siteId:c.siteId,mode:before.mode,generation,runId,counts,pinned:before.resumeJob||null,running:running.map(r=>({table:r.table,id:r.id})),runningSnapshotValid,matchesPin:(running.length===0&&!before.resumeJob)||(running.length===1&&runningSnapshotValid&&JSON.stringify(before.resumeJob||null)===JSON.stringify(resumeJob||null)),artifacts,scope,mutationPerformed:false};
   }
   const original=await lstat(fencePath);let h;try{
    h=await open(pending,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);await h.chown(original.uid,original.gid);await h.chmod(original.mode&0o777);
    const next={siteId:c.siteId,mode:'drain',generation:generation+1,runId,...(resumeJob?{resumeJob}:{})};await h.writeFile(JSON.stringify(next)+'\n');await h.sync();await h.close();h=null;
    await verifyOrch();await verifyPub();verifyDescriptor(receiver.binding);verifyDescriptor(legacy.binding);
    const latest=await lstat(fencePath);if(latest.dev!==original.dev||latest.ino!==original.ino||!sameFence(await readFence(c.fenceRoot,c.siteId),before))throw Error('Fence replaced');
    await rename(pending,fencePath);const d=await open(c.fenceRoot,'r');try{await d.sync();}finally{await d.close();}
    return {...next,counts,scope};
   }finally{await h?.close();}
  }finally{for(const item of [legacy,receiver])if(item){try{item.db.exec('ROLLBACK');}finally{item.db.close();}}}
 }));
}
try{console.log(JSON.stringify(await main()));}catch(e){console.error('coordination refused:',e.message);process.exitCode=1;}
