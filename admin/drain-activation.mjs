import {constants} from 'node:fs';
import {lstat,readlink,readFile,symlink,rename,unlink,open,realpath} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const uuid=/^[a-f0-9-]{36}$/,hash=/^[a-f0-9]{64}$/;
const sha=v=>createHash('sha256').update(v).digest('hex');
export function markerPath(base,job){if(!uuid.test(job.id||'')||!hash.test(job.snapshot_hash||'')||!['jobs','site_jobs'].includes(job.table)||!Number.isSafeInteger(job.generation)||typeof job.runId!=='string'||job.siteId!=='scholay-today')throw Error('invalid transaction identity');return join(base,'.rssd-drain-'+job.id+'.json');}
async function syncDir(base){const d=await open(base,'r');try{await d.sync();}finally{await d.close();}}
async function fingerprint(path){const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const a=await h.stat();if(!a.isFile()||a.nlink!==1)throw Error('unsafe release file');const data=await h.readFile();const b=await h.stat();if(a.dev!==b.dev||a.ino!==b.ino||a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs)throw Error('release file changed');return {dev:a.dev,ino:a.ino,size:a.size,sha256:sha(data)};}finally{await h.close();}}
async function priorIdentity(base,prior){
 const target=await realpath(resolve(base,prior)),root=await realpath(join(base,'releases'));
 if(dirname(target)!==root||!/^(?:\d{8}-\d{6}|admin-[a-zA-Z0-9-]+)$/.test(basename(target)))throw Error('unsafe prior release');
 const s=await lstat(target);if(!s.isDirectory())throw Error('prior release missing');
 const index=await fingerprint(join(target,'index.html'));let manifest=null;try{manifest=await fingerprint(join(target,'release.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 return {target,dev:s.dev,ino:s.ino,index,manifest};
}
async function validate(base,job,r){
 if(r.version!==2||r.jobId!==job.id||r.table!==job.table||r.snapshotHash!==job.snapshot_hash||r.siteId!==job.siteId||r.runId!==job.runId||r.generation!==job.generation)throw Error('transaction identity mismatch');
 const expected=join(base,'releases','admin-'+job.id);if(r.release!==expected||typeof r.previous!=='string'||!Number.isSafeInteger(r.dev)||!Number.isSafeInteger(r.ino))throw Error('invalid transaction');
 const prior=await priorIdentity(base,r.previous);if(JSON.stringify(prior)!==JSON.stringify(r.prior))throw Error('prior release identity changed');
 const mf=await fingerprint(join(expected,'release.json'));if(JSON.stringify(mf)!==JSON.stringify(r.candidateManifest))throw Error('candidate manifest changed');
 const manifest=JSON.parse(await readFile(join(expected,'release.json'),'utf8'));
 if(JSON.stringify(await fingerprint(join(expected,'release.json')))!==JSON.stringify(r.candidateManifest))throw Error('candidate manifest changed');
 if(manifest.jobId!==job.id||manifest.snapshotHash!==job.snapshot_hash||manifest.release!=='admin-'+job.id||manifest.previousRelease!==basename(prior.target))throw Error('candidate manifest mismatch');
}
async function matches(base,r){try{const p=join(base,'current'),s=await lstat(p);return s.isSymbolicLink()&&s.dev===r.dev&&s.ino===r.ino&&await readlink(p)===r.release;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function load(base,job){const path=markerPath(base,job),h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await h.stat();if(!s.isFile()||s.uid!==process.getuid()||s.nlink!==1||(s.mode&0o077)||s.size>8192)throw Error('unsafe transaction marker');const r=JSON.parse(await h.readFile('utf8'));await validate(base,job,r);const now=await lstat(path);if(now.dev!==s.dev||now.ino!==s.ino)throw Error('transaction marker replaced');return {path,record:r,markerStat:s};}finally{await h.close();}}
// These functions require the caller to hold orchestration and publication
// locks and to authenticate the fence/job on every invocation.
export async function activateDrain({base,release,job,verify}){
 markerPath(base,job);const current=join(base,'current'),old=await lstat(current),previous=await readlink(current);if(!old.isSymbolicLink())throw Error('invalid previous pointer');
 const prior=await priorIdentity(base,previous),candidateManifest=await fingerprint(join(release,'release.json'));
 const next=join(base,'.rssd-drain-link-'+randomUUID());await symlink(release,next);const candidate=await lstat(next);
 const r={version:2,jobId:job.id,table:job.table,snapshotHash:job.snapshot_hash,siteId:job.siteId,runId:job.runId,generation:job.generation,release,previous,prior,candidateManifest,dev:candidate.dev,ino:candidate.ino};await validate(base,job,r);
 const marker=markerPath(base,job),f=await open(marker,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await f.writeFile(JSON.stringify(r)+'\n');await f.sync();}finally{await f.close();}await syncDir(base);
 const before=await lstat(current);if(before.dev!==old.dev||before.ino!==old.ino||await readlink(current)!==previous)throw Error('current changed before activation');
 await rename(next,current);await syncDir(base);return resumeDrain({base,job,verify});
}
export async function resumeDrain({base,job,verify}){
 const {record:r}=await load(base,job);if(!await matches(base,r))throw Error('current differs; manual reconciliation required');
 try{await verify();}catch(error){
  await validate(base,job,r);if(!await matches(base,r))throw Error('current differs; manual reconciliation required');
  const rollback=join(base,'.rssd-drain-rollback-'+randomUUID());await symlink(r.previous,rollback);
  await validate(base,job,r);if(!await matches(base,r))throw Error('current differs; manual reconciliation required');
  await rename(rollback,join(base,'current'));await syncDir(base);
  throw Object.assign(Error('readback failed; previous pointer restored, transaction retained'),{cause:error});
 }
 if(!await matches(base,r))throw Error('current changed after verification');return {ok:true};
}
export async function finalizeDrain({base,job,receipt,verify}){
 const {path,record:r,markerStat}=await load(base,job);
 if(!receipt||receipt.id!==job.id||receipt.status!=='success'||receipt.snapshot_hash!==job.snapshot_hash||receipt.release!==r.release.split('/').at(-1))throw Error('success receipt mismatch');
 if(!await matches(base,r))throw Error('current differs; manual reconciliation required');await verify();await validate(base,job,r);
 const now=await lstat(path);if(now.dev!==markerStat.dev||now.ino!==markerStat.ino||!await matches(base,r))throw Error('transaction changed during receipt verification');
 await unlink(path);await syncDir(base);return {ok:true};
}
