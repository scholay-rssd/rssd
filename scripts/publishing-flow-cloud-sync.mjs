import {join,isAbsolute} from 'node:path';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {optional,atomic} from './publishing-flow.mjs';
import {validateSite,setSiteContext} from './site-config.mjs';
import {continuationPending,continuationNeedsAttention,publicationContinuation,settlePublicationQueue} from './publication-queue-status.mjs';
import {withFileLock,lockOwnerAlive} from './editorial-lock.mjs';
import {createWebsitePublisher} from './website-publication.mjs';
import {CLOUD_CONTINUATION_SITES,readCloudContinuationEvidence} from './publishing-flow-artifact.mjs';

// This consumer reads only previously accepted cloud jobs. It never enqueues
// an article, runs a local translator or creates social distribution authority.
export async function syncCloudContinuations(config,{now=Date.now(),publisher=createWebsitePublisher,settle=settlePublicationQueue,evidence=readCloudContinuationEvidence}={}){
 if(process.env.SCHOLAY_TODAY_TOKEN||process.env.SCHOLAY_TODAY_ORIGIN||process.env.SCHOLAY_SITE_ID||process.env.SCHOLAY_SITE_CONFIG||process.env.SCHOLAY_SITE_JSON)throw Error('Cloud sync requires a neutral environment and per-site token files');
 if(config?.version!==1||!Array.isArray(config.workspaces))throw Error('Invalid cloud sync configuration');
 const seen=new Set(),results=[];
 for(const entry of config.workspaces){
  const site=validateSite(entry.site);
  if(!CLOUD_CONTINUATION_SITES.includes(site.id)||seen.has(site.id)||!isAbsolute(entry.root)||!isAbsolute(entry.tokenFile))throw Error('Invalid cloud sync workspace');
  seen.add(site.id);
  const bound=await optional(join(entry.root,'.site.json'));
  if(!bound||bound.id!==site.id||bound.origin!==site.origin)throw Error('Cloud sync workspace identity mismatch');
  const directory=site.legacy?join(entry.root,'.local/today'):join(entry.root,'.local/sites',site.id);
  const index=await optional(join(directory,'queue-index.json'));
  for(const id of Object.keys(index?.items||{})){
   if(!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))continue;
   const dir=join(directory,id),receipt=await optional(join(dir,'receipt.json')),q=receipt?.asyncQueue;
   if(q?.owner!=='cloud'||q.continuationOwner!=='cloud'||!/^[a-f0-9]{64}$/.test(q.jobId||'')||q.phase==='needs_review')continue;
   const continuation=await publicationContinuation(entry.root,receipt);
   if(continuationNeedsAttention(continuation))continue;
   const expected={requestKey:receipt.requestKey,jobId:q.jobId};
   const progressFile=join(dir,'cloud-sync.json'),progress=await optional(progressFile);
   if(progress?.requestKey===receipt.requestKey&&progress.retryAt>now)continue;
   try{
    await withFileLock(join(dir,'queue-worker.lock'),async()=>{
     setSiteContext(site);
     const result=await publisher({root:entry.root,site,tokenFile:entry.tokenFile}).refreshCloudContinuation(id,expected);
     const next=result?.receipt,following=await publicationContinuation(entry.root,next);
     const complete=next?.asyncQueue?.phase==='complete'&&!continuationPending(following)&&!!await evidence({root:entry.root,siteId:site.id,articleId:id,receipt:next});
     if(complete)await settle(entry.root,site,id,expected);
     const attempts=complete?0:(progress?.requestKey===receipt.requestKey?progress.attempts||0:0)+1;
     await atomic(progressFile,{version:1,requestKey:receipt.requestKey,attempts,checkedAt:new Date(now).toISOString(),retryAt:complete?0:now+Math.min(300000,30000*2**Math.min(attempts-1,4)),status:complete?'complete':'waiting'});
     results.push({siteId:site.id,articleId:id,status:complete?'complete':'waiting'});
    },{timeout:100});
   }catch(error){
    const owner=await optional(join(dir,'queue-worker.lock'));
    if(owner&&await lockOwnerAlive(owner))continue;
    const attempts=(progress?.requestKey===receipt.requestKey?progress.attempts||0:0)+1;
    await atomic(progressFile,{version:1,requestKey:receipt.requestKey,attempts,checkedAt:new Date(now).toISOString(),retryAt:now+Math.min(300000,30000*2**Math.min(attempts,4)),status:'retry',error:'Cloud status refresh failed; original request retained'});
    results.push({siteId:site.id,articleId:id,status:'retry'});
   }
  }
 }
 return results;
}

export async function watchCloudContinuations(file,{signal,intervalMs=30000,emit=()=>{},sync=syncCloudContinuations}={}){
 if(intervalMs<1000)throw Error('Invalid cloud sync interval');
 return withFileLock(file+'.lock',async()=>{
  while(!signal?.aborted){
   const config=JSON.parse(await readFile(file,'utf8')),results=await sync(config);
   await atomic(file+'.status.json',{checkedAt:new Date().toISOString(),pid:process.pid,results});
   if(results.length)emit(results);
   try{await delay(intervalMs,null,{signal});}catch(error){if(error.name!=='AbortError')throw error;}
  }
 },{timeout:100});
}
