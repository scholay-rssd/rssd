import {mkdir,readFile,writeFile,rename,readdir,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {withFileLock} from './editorial-lock.mjs';
import {uploadPacketMedia} from './rssd-device-media.mjs';

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
    publications:options=>request('/publications?'+query(options))};
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
export class CenterOutbox {
  constructor({directory,client}){this.directory=directory;this.client=client;}
  path(requestId){return join(this.directory,protocol.hash(protocol.id(requestId))+'.json');}
  async enqueue(input){
    const packet=protocol.submission(input),path=this.path(packet.requestId),payloadHash=protocol.hash(packet);
    return withFileLock(path+'.lock',async()=>{
      try{const old=await json(path);this.verify(old);if(old.payloadHash!==payloadHash)throw new CenterError('Request identity already contains different content',{status:409,code:'request_conflict'});return old;}
      catch(error){if(error.code!=='ENOENT')throw error;}
      const entry={version:1,origin:this.client.origin,requestId:packet.requestId,payloadHash,packet,
        state:'pending',attempts:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      await atomic(path,entry);return entry;
    });
  }
  verify(entry){
    if(entry.version!==1||entry.origin!==this.client.origin||entry.requestId!==entry.packet?.requestId||protocol.hash(entry.packet)!==entry.payloadHash)
      throw new CenterError('Outbox identity or content changed; preserve the files for recovery',{code:'outbox_conflict'});
  }
  async list(){
    let files;try{files=await readdir(this.directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const result=[];for(const file of files.filter(file=>/^[a-f0-9]{64}\.json$/.test(file))){const entry=await json(join(this.directory,file));this.verify(entry);result.push(entry);}
    return result.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  }
  async flushOne(requestId,{retry=false}={}){
    const path=this.path(requestId);
    return withFileLock(path+'.lock',async()=>{
      const entry=await json(path);this.verify(entry);
      if(entry.state==='accepted'||entry.state==='needs_attention'&&!retry)return entry;
      entry.attempts++;entry.updatedAt=new Date().toISOString();await atomic(path,entry);
      try{
        let receipt;
        try{receipt=await this.client.submission(entry.requestId);}
        catch(error){if(error.status!==404)throw error;await uploadPacketMedia({packet:entry.packet,directory:join(this.directory,'../media'),client:this.client});receipt=await this.client.submit(entry.packet);}
        if(receipt?.requestId!==entry.requestId||receipt.workId!==entry.packet.workId||receipt.workspaceId!==entry.packet.workspaceId||receipt.status!=='accepted')
          throw new CenterError('Center receipt does not match the submitted work',{code:'receipt_mismatch'});
        if(!Array.isArray(receipt.editions)||receipt.editions.length!==entry.packet.editions.length||entry.packet.editions.some(edition=>{
          const received=receipt.editions.find(item=>item.locale===edition.locale);
          return received?.hash!==protocol.hash(edition)||received?.revision!==entry.packet.baseRevisions[edition.locale]+1;
        }))throw new CenterError('Center receipt does not match the edition content',{code:'receipt_mismatch'});
        entry.state='accepted';entry.receipt=receipt;delete entry.error;
      }catch(error){
        entry.error={message:error.message,code:error.code||'network_error',status:error.status||0};
        entry.state=error.status>=400&&error.status<500&&![408,429].includes(error.status)||['receipt_mismatch','outbox_conflict'].includes(error.code)?'needs_attention':'pending';
      }
      entry.updatedAt=new Date().toISOString();await atomic(path,entry);return entry;
    },{timeout:1000});
  }
  async flush(){const results=[];for(const entry of await this.list())if(entry.state==='pending')results.push(await this.flushOne(entry.requestId));return results;}
}

export async function saveCenterConnection(directory,{origin,token,persistToken=true}){
  const client=createCenterClient({origin,token}),identity=await client.identity();
  if(identity.protocolVersion!==1||!identity.workerId||!identity.orgId)throw Error('Center did not return a compatible device identity');
  const path=join(directory,'connection.json');
  return withFileLock(path+'.lock',async()=>{
    let old;try{old=await json(path);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(old&&(old.identity.orgId!==identity.orgId||old.origin!==client.origin)){
      const oldClient=createCenterClient({...old,token:old.token||token}),entries=await new CenterOutbox({directory:join(directory,'outbox'),client:oldClient}).list();
      if(entries.length)throw Error('Archive this center’s retained submissions before connecting another center');
      let drafts=[];try{drafts=await readdir(join(directory,'drafts'));}catch(error){if(error.code!=='ENOENT')throw error;}
      const active=await json(join(directory,'active-claim.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(drafts.length||active?.claim)throw Error('Archive this center’s local drafts and resolve the active claim before switching centers');
    }
    const value={version:1,origin:client.origin,...(persistToken?{token}:{}),identity};await atomic(path,value);
    return {origin:value.origin,identity};
  });
}
export async function loadCenterConnection(directory,{token=process.env.RSSD_CENTER_TOKEN}={}){const value=await json(join(directory,'connection.json'));return {client:createCenterClient({...value,token:token||value.token}),identity:value.identity};}
export {atomic as writeCenterJson};
