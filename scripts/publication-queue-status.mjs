import {readFile,mkdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {registry} from './space-registry.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {durableWriteJson} from './durable-json.mjs';
import {createHash} from 'node:crypto';

const optional=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const directory=(root,site)=>site.legacy?join(root,'.local/today'):join(root,'.local/sites',site.id);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identityError=()=>Error('后台任务预览或归档身份已变化，保留原请求待核对');
export function queuePublicationBinding(site,packet,receipt){
 const queue=receipt?.asyncQueue;
 if(!packet||receipt.requestKey!==packet.requestKey||queue?.packetSha256!==hash(packet)||receipt.sourceSha256!==packet.sourceSha256||!/^[a-f0-9]{64}$/.test(packet.sourceSha256||'')||!packet.data?.id||packet.siteId&&packet.siteId!==site.id||packet.origin&&packet.origin!==site.origin)throw identityError();
 const binding={version:1,siteId:site.id,origin:site.origin,articleId:packet.data.id,requestKey:packet.requestKey,sourceSha256:packet.sourceSha256,packetSha256:queue.packetSha256};
 if(queue.binding&&Object.keys(binding).some(key=>queue.binding[key]!==binding[key]))throw identityError();return binding;
}
// An archived manuscript may no longer have prepared.json. Its compact frozen
// binding is usable for status reads only, after checking the verified archive
// journal and inventory pointer. It is never a replacement publication packet.
export async function readPublicationQueueIdentity({root,site,id,packet,receipt}){
 if(packet)return queuePublicationBinding(site,packet,receipt);
 const binding=receipt?.asyncQueue?.binding,queue=receipt?.asyncQueue;
 if(!binding||binding.version!==1||binding.siteId!==site.id||binding.origin!==site.origin||binding.requestKey!==receipt.requestKey||binding.packetSha256!==queue.packetSha256||binding.sourceSha256!==receipt.sourceSha256||!/^[a-f0-9]{64}$/.test(binding.packetSha256||'')||!/^[a-f0-9]{64}$/.test(binding.sourceSha256||''))throw identityError();
 const index=await optional(join(root,'_ops/inventory/article-index.json')),cloud=index?.cloudArticles?.[id]?.cloud,journal=await optional(join(directory(root,site),id,'release.json'));
 const verified=receipt.intent==='draft'?receipt.status==='draft_saved':receipt.publicReadback===true&&receipt.job?.status==='success';
 if(!verified||!cloud||journal?.phase!=='complete'||cloud.articleId!==binding.articleId||cloud.sourceSha256!==binding.sourceSha256||cloud.version!==receipt.revision||receipt.intent!=='draft'&&cloud.publishedVersion!==receipt.revision||!/^[a-f0-9]{64}$/.test(cloud.archiveId||'')||cloud.archiveSha256!==cloud.archiveId||journal.cloud?.archiveId!==cloud.archiveId||journal.cloud?.archiveSha256!==cloud.archiveSha256||journal.cloud?.sourceSha256!==binding.sourceSha256||journal.cloud?.articleId!==binding.articleId||journal.cloud?.version!==receipt.revision||journal.cloud?.publishedVersion!==cloud.publishedVersion)throw identityError();
 return binding;
}
export const continuationNeedsAttention=value=>!!value&&(['needs_review','stale','failed','rejected'].includes(value.status)||value.translation?.status==='failed'||['needs_review','rejected'].includes(value.english?.status));
export const continuationPending=value=>!!value&&!['complete','disabled','out_of_scope'].includes(value.status);
export async function publicationContinuation(root,receipt){
 let value=receipt?.asyncQueue?.continuation||receipt?.publishingFlow;if(!value)return null;
 value={...value,owner:value.owner||(receipt.asyncQueue?.continuationOwner==='cloud'?'cloud':'local')};
 if(value.owner==='local'&&/^[a-f0-9]{40}$/.test(value.id||'')){
  const state=await optional(join(root,'.local/publishing-flow/jobs',value.id,'state.json'));
  if(state)value={...value,...state,status:state.complete?'complete':state.status||'queued'};
 }
 if(continuationNeedsAttention(value)&&value.status!=='complete')value={...value,status:'needs_review'};
 return value;
}
export async function indexPublicationQueue(root,site,id,title){
 const dir=directory(root,site);await mkdir(dir,{recursive:true,mode:0o700});
 await withFileLock(join(dir,'queue-index.lock'),async()=>{
  const index=await optional(join(dir,'queue-index.json'))||{version:1,items:{}};
  index.items[id]={title,queuedAt:new Date().toISOString()};if(index.history)delete index.history[id];await durableWriteJson(join(dir,'queue-index.json'),index);
 });
}
export async function settlePublicationQueue(root,site,id,expected){
 const dir=directory(root,site);
 await withFileLock(join(dir,'queue-index.lock'),async()=>{
  const index=await optional(join(dir,'queue-index.json'));if(!index?.items?.[id])return;
  const receipt=await optional(join(dir,id,'receipt.json'));
  if(expected&&(receipt?.requestKey!==expected.requestKey||receipt.asyncQueue?.jobId!==expected.jobId))return;
  if(receipt?.asyncQueue?.phase!=='complete'||continuationPending(await publicationContinuation(root,receipt)))return;
  const info={...index.items[id],completedAt:new Date().toISOString()};delete index.items[id];
  index.history=Object.fromEntries([[id,info],...Object.entries(index.history||{}).filter(([key])=>key!==id)].slice(0,20));
  await durableWriteJson(join(dir,'queue-index.json'),index);
 });
}
export async function publicationQueueSpaces({root,site,globalData=process.env.SCHOLAY_GLOBAL_APP_DATA}={}){
 const spaces=[];
 if(globalData){
  for(const entry of registry(globalData,false).sites){
   const state=entry.legacy?globalData:join(globalData,'spaces',entry.spaceId),preference=await optional(join(state,'editorial-workspace.json'));
   const workspace=preference?.path||join(state,'workspace');if(!isAbsolute(workspace))continue;
   const bound=await optional(join(workspace,'.site.json'));
   if(!entry.legacy&&(!bound||bound.id!==entry.id||bound.spaceId!==entry.spaceId))continue;
   spaces.push({root:workspace,site:entry});
  }
 }else spaces.push({root,site});
 return spaces;
}
export async function publicationQueueSnapshot(options={}){
 const spaces=await publicationQueueSpaces(options);
 const jobs=[];
 for(const space of spaces){
  const dir=directory(space.root,space.site),index=await optional(join(dir,'queue-index.json'));
  for(const [id,info] of Object.entries({...index?.history,...index?.items})){
   if(!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))continue;
   const receipt=await optional(join(dir,id,'receipt.json')),q=receipt?.asyncQueue;if(!q)continue;
   const continuation=await publicationContinuation(space.root,receipt);
   const continuing=q.phase==='complete'&&continuationPending(continuation);
   const attention=q.phase==='needs_review'||continuing&&continuationNeedsAttention(continuation);
   const status=attention?'needs_review':continuing?'waiting':q.phase==='complete'?'complete':q.owner==='cloud'?'waiting':q.phase==='queued'?'queued':'running';
   const labels={queued:'等待后台执行',transferring:'提交发布包',checking:'核对原请求',submitting:'提交官网',submitted:'等待官网构建',verifying:'核验公开页面',accepted:'云端已接收',complete:'自家发布已完成',needs_review:'需要处理'};
   jobs.push({id:'publication:'+space.site.id+':'+id,articleId:id,title:info.title||id,siteId:space.site.id,spaceId:space.site.spaceId,spaceName:space.site.name,status,phase:continuing?(attention?'中文已发布，后续需处理':'中文已发布，英文／恩特处理中'):labels[q.phase]||'云端处理中',requestKey:receipt.requestKey,updatedAt:q.updatedAt||info.queuedAt,error:q.error||receipt.readbackError||continuation?.error,receipt:{publicReadback:receipt.publicReadback===true,continuation:q.continuation}});
  }
 }
 jobs.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
 return {jobs:[...jobs.filter(job=>job.status!=='complete'),...jobs.filter(job=>job.status==='complete').slice(0,20)]};
}
