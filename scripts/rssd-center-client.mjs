import {mkdir,readFile,writeFile,rename,readdir,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {withFileLock,lockOwnerAlive} from './editorial-lock.mjs';
import {uploadPacketMedia} from './rssd-device-media.mjs';
import {switchConnectionContext,recoverConnectionSwitch} from './rssd-connection-context.mjs';

export class CenterError extends Error {
  constructor(message,{status=0,code='network_error'}={}){super(message);this.status=status;this.code=code;}
}
export function centerOrigin(value){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('Center URL must be an origin without credentials or a path');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Center connections require HTTPS');
  return url.origin;
}
export function createCenterClient({origin,token,fetcher=fetch,timeoutMs=30000}){
  origin=centerOrigin(origin);
  if(typeof token!=='string'||!/^rssd_device_[A-Za-z0-9_-]{48}$/.test(token))throw Error('Invalid center device credential');
  const request=async(path,{method='GET',body,signal}={})=>{
    const timeout=AbortSignal.timeout(timeoutMs);let response;
    try{response=await fetcher(origin+'/api/rssd/v1'+path,{method,redirect:'error',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,timeout]):timeout});}
    catch(error){throw new CenterError(error.name==='AbortError'||error.name==='TimeoutError'?'Center request interrupted; the original request is retained':'Center is unreachable; the original request is retained');}
    let parsed=false;
    const value=await response.json().then(value=>{parsed=true;return value;}).catch(()=>null);
    if(!response.ok)throw new CenterError(value?.message||'Center request failed',{status:response.status,code:value?.code||'http_error'});
    if(!parsed&&response.status!==204)throw new CenterError('Center response could not be read',{code:'invalid_response'});
    return value;
  };
  const query=options=>new URLSearchParams(Object.entries(options||{}).filter(([,v])=>v!==undefined)).toString();
  return {origin,request,identity:()=>request('/identity'),registry:()=>request('/registry'),
    demands:options=>request('/demands?'+query(options)),works:options=>request('/works?'+query(options)),
    work:id=>request('/works/'+encodeURIComponent(protocol.id(id))),
    createDemand:body=>request('/demands',{method:'POST',body}),
    claim:body=>request('/claims',{method:'POST',body}),activeClaim:()=>request('/claims/current'),
    heartbeat:body=>request('/heartbeat',{method:'POST',body}),
    changeDemand:(id,body)=>request('/demands/'+encodeURIComponent(protocol.id(id)),{method:'PATCH',body}),
    submit:body=>request('/submissions',{method:'POST',body:protocol.submission(body)}),
    submission:id=>request('/submissions/'+encodeURIComponent(protocol.id(id))),
    publications:options=>request('/publications?'+query(options)),
    // Workspace-scoped website retry. Owner-only POST /publications/:id/retry
    // and GET /destinations stay owner-only configuration endpoints.
    editorialRetry:(workspaceId,requestKey,body)=>request('/editorial/'+encodeURIComponent(protocol.id(workspaceId))+'/requests/'+encodeURIComponent(protocol.id(requestKey))+'/retry',{method:'POST',body})};
}
async function atomic(path,value){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.'+randomUUID()+'.tmp';
  const file=await open(temporary,'wx',0o600);
  try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}
  // NTFS and POSIX rename atomically replace the file; no unlink gap.
  await rename(temporary,path);
}
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function inferStoreOnlyIntent(directory,packet,client){
  if(!packet?.demandId)return false;
  try{
    const active=await json(join(directory,'../active-claim.json'));
    if(active?.claim?.id===packet.demandId&&active.claim.payload?.storeOnly===true)return true;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  if(typeof client?.demands!=='function')return false;
  try{
    const rows=await client.demands({workspaceId:packet.workspaceId,limit:100});
    const row=Array.isArray(rows)?rows.find(item=>item.id===packet.demandId):null;
    return row?.payload?.storeOnly===true;
  }catch{return false;}
}
export class CenterOutbox {
  constructor({directory,client}){this.directory=directory;this.client=client;}
  path(requestId){return join(this.directory,protocol.hash(protocol.id(requestId))+'.json');}
  async enqueue(input,{storeOnly=false}={}){
    const packet=protocol.submission(input),path=this.path(packet.requestId);
    const inferred=storeOnly===true||await inferStoreOnlyIntent(this.directory,packet,this.client);
    if(inferred){
      const {requireStoreOnlyContract}=await import('./rssd-store-only-contract.mjs');
      await requireStoreOnlyContract(this.client);
    }
    const payloadHash=inferred?protocol.hash({storeOnly:true,packet}):protocol.hash(packet);
    return withFileLock(path+'.lock',async()=>{
      try{const old=await json(path);this.verify(old);if(old.payloadHash!==payloadHash||Boolean(old.storeOnly)!==Boolean(inferred))throw new CenterError('Request identity already contains different content',{status:409,code:'request_conflict'});return old;}
      catch(error){if(error.code!=='ENOENT')throw error;}
      const entry={version:1,origin:this.client.origin,requestId:packet.requestId,payloadHash,packet,
        state:'pending',attempts:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),...(inferred?{storeOnly:true}:{})};
      await atomic(path,entry);return entry;
    });
  }
  verify(entry){
    const storeOnly=entry.storeOnly===true;
    const expected=storeOnly?protocol.hash({storeOnly:true,packet:entry.packet}):protocol.hash(entry.packet);
    if(entry.version!==1||entry.origin!==this.client.origin||entry.requestId!==entry.packet?.requestId||expected!==entry.payloadHash||(entry.storeOnly!==undefined&&entry.storeOnly!==true))
      throw new CenterError('Outbox identity or content changed; preserve the files for recovery',{code:'outbox_conflict'});
  }
  async list(){
    let files;try{files=await readdir(this.directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const result=[];for(const file of files.filter(file=>/^[a-f0-9]{64}\.json$/.test(file))){const entry=await json(join(this.directory,file));this.verify(entry);result.push(entry);}
    return result.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  }
  async flushOne(requestId,{retry=false,lookupOnly=false}={}){
    const path=this.path(requestId);
    return withFileLock(path+'.lock',async()=>{
      const entry=await json(path);this.verify(entry);
      if(entry.state==='accepted'||entry.state==='needs_attention'&&!retry)return entry;
      entry.attempts++;entry.updatedAt=new Date().toISOString();await atomic(path,entry);
      try{
        const inferred=entry.storeOnly===true||await inferStoreOnlyIntent(this.directory,entry.packet,this.client);
        if(inferred){
          const {requireStoreOnlyContract}=await import('./rssd-store-only-contract.mjs');
          await requireStoreOnlyContract(this.client);
          if(entry.storeOnly!==true)throw new CenterError('Store-only demand cannot be flushed as ordinary publish; outbox intent is missing',{status:409,code:'not_store_only'});
        }
        let receipt;
        try{receipt=await this.client.submission(entry.requestId);}
        catch(error){if(error.status!==404||lookupOnly)throw error;await uploadPacketMedia({packet:entry.packet,directory:join(this.directory,'../media'),client:this.client});receipt=await this.client.submit(entry.packet);}
        if(receipt?.requestId!==entry.requestId||receipt.workId!==entry.packet.workId||receipt.workspaceId!==entry.packet.workspaceId||receipt.status!=='accepted')
          throw new CenterError('Center receipt does not match the submitted work',{code:'receipt_mismatch'});
        if(!Array.isArray(receipt.editions)||receipt.editions.length!==entry.packet.editions.length||entry.packet.editions.some(edition=>{
          const received=receipt.editions.find(item=>item.locale===edition.locale);
          return received?.hash!==protocol.hash(edition)||received?.revision!==entry.packet.baseRevisions[edition.locale]+1;
        }))throw new CenterError('Center receipt does not match the edition content',{code:'receipt_mismatch'});
        if(inferred||receipt.storeOnly===true){
          const {assertStoreOnlyReceipt}=await import('./rssd-store-only-contract.mjs');
          if(entry.storeOnly!==true)throw new CenterError('Store-only demand cannot be flushed as ordinary publish; outbox intent is missing',{status:409,code:'not_store_only'});
          assertStoreOnlyReceipt(receipt,entry.packet,{workerId:this.client.workerId});
        }
        entry.state='accepted';entry.receipt=receipt;delete entry.error;
      }catch(error){
        entry.error={message:error.message,code:error.code||'network_error',status:error.status||0};
        entry.state=error.status>=400&&error.status<500&&![408,429].includes(error.status)||['receipt_mismatch','outbox_conflict','not_store_only','contract_unavailable'].includes(error.code)?'needs_attention':'pending';
      }
      entry.updatedAt=new Date().toISOString();await atomic(path,entry);return entry;
    },{timeout:1000});
  }
  async repairUnsubmitted(requestId,packet){
    const path=this.path(requestId);
    return withFileLock(path+'.lock',async()=>{
      const entry=await json(path);this.verify(entry);
      if(entry.state==='accepted')throw new CenterError('Accepted request cannot change',{status:409,code:'request_conflict'});
      const next=protocol.submission(packet);
      if(next.requestId!==entry.requestId||next.workId!==entry.packet.workId||next.workspaceId!==entry.packet.workspaceId)throw new CenterError('Repair must keep the original request identity',{status:409,code:'request_conflict'});
      const strip=value=>{const {media,...rest}=value;return rest;};
      if(entry.packet.editions.length!==next.editions.length||entry.packet.editions.some((edition,index)=>protocol.hash(strip(edition))!==protocol.hash(strip(next.editions[index]))))
        throw new CenterError('Repair is limited to completing the media manifest',{status:409,code:'request_conflict'});
      try{const receipt=await this.client.submission(entry.requestId);if(receipt)throw new CenterError('Center already accepted the original request; submit a new revision',{status:409,code:'request_conflict'});}
      catch(error){if(error.status!==404)throw error;}
      entry.packet=next;entry.payloadHash=entry.storeOnly===true?protocol.hash({storeOnly:true,packet:next}):protocol.hash(next);entry.state='pending';delete entry.error;
      entry.updatedAt=new Date().toISOString();await atomic(path,entry);return entry;
    },{timeout:1000});
  }
  async flush(){const results=[];for(const entry of await this.list())if(entry.state==='pending')results.push(await this.flushOne(entry.requestId));return results;}
}

// A completed receipt belongs to this precise claim, including its token: a
// later claim of the same demand must not be cleared by an earlier receipt.
export function hasCompletedClaimReceipt(active,origin,entries,workerId){
  const claim=active?.claim;
  if(active?.origin!==origin||!claim?.id||!claim.claimToken||!claim.workspaceId||!claim.sectionId||
    (workerId&&claim.workerId&&workerId!==claim.workerId))return false;
  const matching=entries.filter(entry=>entry.origin===origin&&entry.packet?.demandId===claim.id&&
    entry.packet.claimToken===claim.claimToken&&entry.packet.workspaceId===claim.workspaceId&&entry.packet.sectionId===claim.sectionId);
  if(!matching.length||matching.some(entry=>entry.state!=='accepted'))return false;
  return matching.some(({packet,requestId,receipt})=>{
    if(receipt?.status!=='accepted'||receipt.demandState!=='completed'||receipt.requestId!==requestId||receipt.workId!==packet.workId||receipt.workspaceId!==packet.workspaceId||
      !Array.isArray(receipt.editions)||receipt.editions.length!==packet.editions.length||!packet.editions.length||
      packet.editions.some(edition=>{const received=receipt.editions.find(item=>item.locale===edition.locale);
        return received?.hash!==protocol.hash(edition)||received.revision!==packet.baseRevisions[edition.locale]+1;}))return false;
    if(claim.payload?.storeOnly===true&&(receipt.storeOnly!==true||typeof receipt.storeOnlyWorkerId!=='string'||!receipt.storeOnlyWorkerId||!Array.isArray(receipt.publicationIds)||receipt.publicationIds.length))return false;
    return true;
  });
}
// The caller holds worker.lock so a newly claimed task cannot be overwritten.
export async function clearCompletedClaim(home,origin,entries,workerId){
  const path=join(home,'active-claim.json');
  let active;try{active=await json(path);}catch(error){if(error.code==='ENOENT')return false;throw error;}
  if(!hasCompletedClaimReceipt(active,origin,entries,workerId))return false;
  await atomic(path,{origin,claim:null});return true;
}

export async function saveCenterConnection(directory,{origin,token,persistToken=true,credentialService}){
  const client=createCenterClient({origin,token}),identity=await client.identity();
  if(identity.protocolVersion!==1||!identity.workerId||!identity.orgId)throw Error('Center did not return a compatible device identity');
  const path=join(directory,'connection.json');
  return withFileLock(path+'.lock',async()=>{
    await recoverConnectionSwitch(directory,atomic);
    for(const name of ['worker.lock','daemon.lock']){const owner=await json(join(directory,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(owner&&await lockOwnerAlive(owner))throw Error('请先停止领取并等待当前任务完成，再更换中心连接');}
    let old;try{old=await json(path);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(old&&old.identity.workerId!==identity.workerId){const active=await json(join(directory,'active-claim.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(active?.claim)throw Error('请先恢复或释放当前设备的认领，再更换设备身份');}
    if(credentialService&&!/^com\.thomas\.papr\.rssd-center\.v1\.[a-f0-9]{64}$/.test(credentialService))throw Error('Invalid native credential reference');
    const value={version:1,origin:client.origin,...(persistToken?{token}:{}),...(credentialService?{credentialService}:{}),identity};await switchConnectionContext(directory,old,value,atomic);
    return {origin:value.origin,identity};
  });
}
export async function loadCenterConnection(directory,{token=process.env.RSSD_CENTER_TOKEN}={}){return withFileLock(join(directory,'connection.json.lock'),async()=>{await recoverConnectionSwitch(directory,atomic);const value=await json(join(directory,'connection.json'));if(value.disconnected)throw new CenterError('中心连接已退出，请重新登录',{status:401,code:'disconnected'});return {client:createCenterClient({...value,token:token||value.token}),identity:value.identity};});}
export {atomic as writeCenterJson};
