// Shared legacy publication coordination. Activating this protocol also
// requires a separately reviewed coordinator and service configuration.
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {isAbsolute,join,dirname} from 'node:path';
export class CoordinationError extends Error { constructor(message, code='coordination_unavailable'){super(message);this.code=code;this.status=503;} }
export function sameFence(a,b){const x=a?.resumeJob,y=b?.resumeJob;return Boolean(a&&b&&a.siteId===b.siteId&&a.mode===b.mode&&a.generation===b.generation&&a.runId===b.runId&&(a.jobId??null)===(b.jobId??null)&&(!x&&!y||x&&y&&x.table===y.table&&x.id===y.id&&x.snapshotHash===y.snapshotHash));}
export function coordinationConfig(explicit,env=process.env){
 const values=explicit===undefined?{orchestrationLock:env.SCHOLAY_ORCHESTRATION_LOCK,publicationLock:env.SCHOLAY_PUBLICATION_LOCK,fenceRoot:env.SCHOLAY_FENCE_ROOT}:explicit;
 const optedIn=env.SCHOLAY_COORDINATION_REQUIRED==='1'||Boolean(values?.orchestrationLock||values?.fenceRoot)||explicit!=null;
 // A lone publication lock is the existing legacy configuration.
 if(!optedIn)return null;
 if(!values||!['orchestrationLock','publicationLock','fenceRoot'].every(k=>typeof values[k]==='string'&&isAbsolute(values[k]))||values.orchestrationLock===values.publicationLock)throw new CoordinationError('Incomplete publication coordination configuration');
 return {orchestrationLock:values.orchestrationLock,publicationLock:values.publicationLock,fenceRoot:values.fenceRoot};
}
function checkPath(path){if(typeof path!=='string'||!isAbsolute(path))throw new CoordinationError('Absolute lock path required');}
async function validate(path,h,expected){
 let actual,pathStat,parent;try{[actual,pathStat,parent]=await Promise.all([h.stat(),lstat(path),lstat(dirname(path))]);}catch{throw new CoordinationError('Lock vanished');}
 if(!parent.isDirectory()||parent.uid!==0||((parent.mode&0o022)!==0&&(parent.mode&0o1000)===0))throw new CoordinationError('Unsafe lock directory');
 if(!actual.isFile()||!pathStat.isFile()||actual.uid!==0||actual.nlink!==1||(actual.mode&0o022)!==0||actual.dev!==pathStat.dev||actual.ino!==pathStat.ino||expected&&(actual.dev!==expected.dev||actual.ino!==expected.ino))throw new CoordinationError('Lock replaced or unsafe');
 return {dev:actual.dev,ino:actual.ino};
}
// Validate paths without claiming a lock; a busy lock is not a broken lock.
// Expected identities bind a process to the same files across lock acquisitions.
export async function closeCoordinationLocks(pins){
 await Promise.all(Object.values(pins||{}).map(value=>value?.handle?.close()));
}
export async function inspectCoordinationLocks(config,expected){
 const result={};
 try{
  for(const key of ['orchestrationLock','publicationLock']){
   const path=config[key];checkPath(path);let h;
   try{
    h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const identity=await validate(path,h,expected?.[key]);
    if(expected){await h.close();h=null;result[key]=identity;}
    else{result[key]={...identity,handle:h};h=null;}
   }finally{await h?.close();}
  }
  if(result.orchestrationLock.dev===result.publicationLock.dev&&result.orchestrationLock.ino===result.publicationLock.ino)throw new CoordinationError('Publication locks share an inode');
  return result;
 }catch(error){
  await closeCoordinationLocks(result);
  if(error instanceof CoordinationError)throw error;
  throw new CoordinationError('Required publication lock unavailable');
 }
}
export async function withReleaseLock(path,work,expected){
 checkPath(path);let h,insideWork=false;
 try{h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);await validate(path,h,expected);
  const code=await new Promise((resolve,reject)=>{const child=spawn('flock',['--exclusive','--nonblock','--conflict-exit-code','75','3'],{stdio:['ignore','ignore','pipe',h.fd]});let error='';child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',n=>[0,75].includes(n)?resolve(n):reject(new CoordinationError('flock failed '+error.slice(0,100))));});
  if(code===75)throw new CoordinationError('Publication coordination busy','coordination_busy');
  await validate(path,h,expected);
  insideWork=true;const result=await work(async()=>validate(path,h,expected));insideWork=false;
  await validate(path,h,expected);return result;
 }catch(e){if(insideWork||e instanceof CoordinationError)throw e;throw new CoordinationError('Required publication lock unavailable');}
 finally{await h?.close();}
}
function fencePath(root,site){if(!isAbsolute(root)||!/^[a-z][a-z0-9-]{1,30}$/.test(site))throw new CoordinationError('Invalid fence identity');return join(root,site+'.json');}
export async function readFence(root,site){
 let h;try{
  const directory=await lstat(root);if(!directory.isDirectory()||directory.uid!==0||(directory.mode&0o022)!==0)throw Error('Unsafe fence directory');
  h=await open(fencePath(root,site),constants.O_RDONLY|constants.O_NOFOLLOW);const st=await h.stat();
  if(!st.isFile()||st.uid!==0||st.nlink!==1||st.size>4096||(st.mode&0o022)!==0)throw Error('Invalid fence file');
  const value=JSON.parse(await h.readFile('utf8'));
  if(value.siteId!==site||!Number.isSafeInteger(value.generation)||value.generation<0||!['open','drain','frozen','preparing','maintenance'].includes(value.mode)||!(value.runId===null||typeof value.runId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value.runId))||(value.mode==='open')!==(value.runId===null))throw Error('Invalid fence state');
  if(['preparing','maintenance'].includes(value.mode)?!/^[a-f0-9-]{36}$/.test(value.jobId||''):value.jobId!=null)throw Error('Invalid maintenance job');
  if(value.resumeJob!=null){const j=value.resumeJob;if(value.mode!=='drain'||!j||typeof j!=='object'||Array.isArray(j)||Object.keys(j).sort().join(',')!=='id,snapshotHash,table'||!['jobs','site_jobs'].includes(j.table)||!/^[a-f0-9-]{36}$/.test(j.id||'')||!/^[a-f0-9]{64}$/.test(j.snapshotHash||''))throw Error('Invalid drain recovery identity');}
  return value;
 }catch{throw new CoordinationError('Site fence missing or invalid');}finally{await h?.close();}
}
