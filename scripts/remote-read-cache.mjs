import {readFile} from 'node:fs/promises';
import {withFileLock} from './editorial-lock.mjs';
import {atomicJson} from './editorial-sync.mjs';

// Durable across the desktop's short-lived Node processes. Only read results
// are cached: mutation, version checks and explicit pull/merge stay uncached.
export const REMOTE_READ_TTL=5*60*1000;
const staleValue=value=>({...value,notice:value.partial?`已读取 ${value.items.length} 条作品，列表尚未完整；稍后继续读取。`:'暂时无法更新，显示上次缓存；稍后再试。'});
export async function cachedRemoteRead({file,identity,load,seed,ttl=REMOTE_READ_TTL,force=false,minInterval=5000,now=Date.now,allowStale=true}){
 const started=now();
 return withFileLock(file+'.lock',async()=>{
  let old;try{old=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  if(old?.identity!==identity)old=null;
  if(!old&&seed){const value=await seed();if(value)old={identity,value,checkedAt:0};}
  const time=now(),age=old?time-old.checkedAt:Infinity;
  if(old?.retryAt>time){
   if(old.value&&allowStale&&!old.denied)return staleValue(old.value);
   throw Error('远程读取暂缓，请稍后重试；'+(old.error||'已有内容已保留。'));
  }
  const fresh=old?.value&&!old.failures&&age>=0&&(force?(old.startedAt>=started||age<minInterval):age<ttl);
  if(fresh)return old.value;
  const requestStarted=now();
  try{
   const response=await load({etag:old?.etag,lastModified:old?.lastModified});
   if(response.notModified&&!old?.value)throw Error('远程返回未修改，但本地没有可用缓存');
   const value=response.notModified?old.value:response.value;
   if(!value||typeof value!=='object')throw Error('远程读取返回格式无效，原缓存保留');
   await atomicJson(file,{identity,value,startedAt:requestStarted,checkedAt:now(),etag:response.etag||(response.notModified?old?.etag:undefined),lastModified:response.lastModified||(response.notModified?old?.lastModified:undefined)});
   return value;
  }catch(error){
   const failures=Math.min((old?.failures||0)+1,8),denied=old?.denied||[401,403,404,410].includes(error.statusCode);
   const delay=Math.max(Math.min(30000*2**(failures-1),300000),Math.min(error.retryAfterMs||0,3600000));
   // A complete snapshot always wins over a failed refresh's partial pages.
   const value=old?.value&&!old.value.partial?old.value:error.partialValue||old?.value;
   await atomicJson(file,{...old,identity,...(value?{value}:{}),failures,denied,error:String(error.message||error).slice(0,220),retryAt:now()+delay});
   if(value&&allowStale&&!denied)return staleValue(value);
   throw error;
  }
 },{timeout:115000});
}
export function retryAfterMs(response,now=Date.now()){
 const value=response.headers.get('retry-after');if(!value)return 0;
 return /^\d+$/.test(value)?Number(value)*1000:Math.max(0,Date.parse(value)-now)||0;
}
