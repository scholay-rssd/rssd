import {readFile} from 'node:fs/promises';
import {join,posix,win32} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {isPrivateFile} from './private-file.mjs';
import {validateCloudContinuationArtifact} from './publishing-flow-artifact.mjs';
import {validateRecoveryPacket} from './publication-recovery-packet.mjs';

export function validateQueueEndpoint(value){
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('发布队列地址须为 HTTPS，本地测试允许 HTTP');
 return url.href.replace(/\/$/,'');
}
// The desktop passes its data folder as SCHOLAY_GLOBAL_APP_DATA. Command-line
// and headless publishers read the same folder's queue config last, so every
// push path hands English to the same queue as the desktop does.
export function sharedAppDataDirectory({platform=process.platform,env=process.env,home=homedir()}={}){
 const paths=platform==='win32'?win32:posix;
 if(platform==='darwin')return paths.join(home,'Library/Application Support/com.thomas.papr');
 if(platform==='win32')return paths.join(env.APPDATA||paths.join(home,'AppData/Roaming'),'com.thomas.papr');
 return paths.join(env.XDG_DATA_HOME||paths.join(home,'.local/share'),'com.thomas.papr');
}
export function useSharedPublicationQueue(env=process.env){
 env.SCHOLAY_SHARED_QUEUE_CONFIG||=join(sharedAppDataDirectory({env}),'publication-queue.json');
 return env.SCHOLAY_SHARED_QUEUE_CONFIG;
}
export async function publicationQueueConfig(root){
 const files=[process.env.SCHOLAY_PUBLICATION_QUEUE_CONFIG,join(root,'.local/publication-queue.json'),process.env.SCHOLAY_GLOBAL_APP_DATA&&join(process.env.SCHOLAY_GLOBAL_APP_DATA,'publication-queue.json'),process.env.SCHOLAY_SHARED_QUEUE_CONFIG].filter(Boolean);
 for(const file of files){
  let config;try{config=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(config.version!==1||typeof config.enabled!=='boolean')throw Error('发布队列配置无效');
  if(!config.enabled)return null;
  if(config.continuationOwner!==undefined&&!['local','cloud'].includes(config.continuationOwner))throw Error('续作执行端配置无效');
  return {...config,endpoint:validateQueueEndpoint(config.endpoint)};
 }
 return null;
}
export const cloudPublicationJobId=(siteId,requestKey)=>createHash('sha256').update(JSON.stringify([siteId,requestKey])).digest('hex');
export function publicationQueueClient({endpoint,site,tokenFile,fetcher=fetch,token=process.env.SCHOLAY_TODAY_TOKEN}){
 endpoint=validateQueueEndpoint(endpoint);
 async function credential(){
  if(token)return token;
  if(!await isPrivateFile(tokenFile))throw Error('发布凭证需使用私有文件权限');
  const value=(await readFile(tokenFile,'utf8')).trim();if(!value)throw Error('发布凭证为空');return value;
 }
 async function request(path,body){
  const response=await fetcher(endpoint+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await credential(),'X-Scholay-Site':site.id,'User-Agent':'Mozilla/5.0 (compatible; Today-Publishing-Queue/1.0)',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  let result;try{result=await response.json();}catch{throw Object.assign(Error('发布队列响应无效'),{statusCode:response.ok?502:response.status});}
  if(!response.ok)throw Object.assign(Error(result.error||'发布队列 HTTP '+response.status),{statusCode:response.status});
  if(result.siteId&&result.siteId!==site.id)throw Error('发布队列站点身份不匹配');
  return result;
 }
 function check(result,packet,continuationOwner){
  if(typeof result.jobId!=='string'||!/^[a-f0-9]{64}$/.test(result.jobId)||result.requestKey!==packet.requestKey||result.articleId&&result.articleId!==packet.data.id)throw Error('发布队列回执身份不匹配');
  if(continuationOwner!==undefined&&(!['local','cloud'].includes(continuationOwner)||(result.continuationOwner===undefined?'local':result.continuationOwner)!==continuationOwner))throw Object.assign(Error('发布队列续作归属与原冻结任务不匹配，请核对原任务'),{statusCode:409});
  return result;
 }
 return {
  async submit(packet,{continuationOwner='local'}={}){
   if(!['local','cloud'].includes(continuationOwner))throw Object.assign(Error('续作执行端配置无效'),{statusCode:400});
   // A lost acknowledgement is resolved using the same deterministic identity.
   // The server also enforces immutable payload equality on a repeated POST.
   const bound={...packet,siteId:site.id,spaceId:site.spaceId,origin:site.origin};
   return check(await request('/v1/jobs',{siteId:site.id,packet:bound,continuationOwner}),bound,continuationOwner);
  },
  async status(jobId,packet,{continuationOwner}={}){
   if(!/^[a-f0-9]{64}$/.test(jobId))throw Error('发布队列任务编号无效');
   return check(await request('/v1/jobs/'+jobId),packet,continuationOwner);
  },
  async continuationArtifact(jobId,packet){
   if(!/^[a-f0-9]{64}$/.test(jobId))throw Error('发布队列任务编号无效');
   const result=check(await request('/v1/jobs/'+jobId+'/continuation-artifact'),packet,'cloud');
   if(result.jobId!==jobId||result.siteId!==site.id||result.articleId!==packet.data.id||result.version!==1||!['pending','ready'].includes(result.status))throw Object.assign(Error('云端续作证据响应无效'),{statusCode:409});
   if(result.status==='ready')validateCloudContinuationArtifact(result,{jobId,siteId:site.id,origin:site.origin,articleId:packet.data.id,requestKey:packet.requestKey});
   else if(Object.keys(result).some(key=>!['version','status','jobId','siteId','articleId','requestKey','continuationOwner'].includes(key)))throw Object.assign(Error('云端续作等待状态含意外内容'),{statusCode:409});
   return result;
  },
  async recoveryPacket(jobId,{articleId,requestKey}){
   if(!/^[a-f0-9]{64}$/.test(jobId))throw Error('Invalid original cloud recovery job');
   return validateRecoveryPacket(await request('/v1/jobs/'+jobId+'/recovery-packet'),{jobId,siteId:site.id,articleId,requestKey,origin:site.origin});
  },
 };
}
