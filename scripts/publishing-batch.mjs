#!/usr/bin/env node
// Grok's daily batch barrier. It reads local publication evidence only; it
// neither produces content nor grants any additional external destinations.
import {readdir,readFile} from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {atomic,optional,hash,postizTick,flowDirectory,externalPackage} from './publishing-flow.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {readCloudContinuationEvidence} from './publishing-flow-artifact.mjs';
import {readCloudHandoffEvidence,cloudHandoffPacket} from './publishing-flow-handoff.mjs';

const batchFile=directory=>join(directory,'today-batch.json');
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{3,128}$/.test(value);
const key=entry=>entry.siteId+'/'+entry.sectionId;
const resultNames=async directory=>(await readdir(directory)).filter(name=>name.endsWith('.result.json')).sort();
const academic=entry=>entry.requireFlow&&entry.siteId!=='pets';
function validateMinimumReady(value,manifest){
 if(!Number.isSafeInteger(value)||value<1||value>manifest.entries.filter(academic).length)throw Error('minimumReady must be a positive article count within the academic batch size');
 return value;
}

export function validateBatchManifest(manifest){
 if(manifest?.version!==1||!isAbsolute(manifest.resultsDirectory||'')||!Array.isArray(manifest.entries)||!manifest.entries.length)throw Error('A batch needs an absolute results directory and its complete planned sections');
 const keys=new Set();
 for(const entry of manifest.entries){
  if(!validId(entry.siteId)||!(/^[a-z][a-z0-9-]{0,99}$/).test(entry.sectionId||'')||!isAbsolute(entry.root||'')||!isAbsolute(entry.publicationDirectory||'')||typeof entry.requireFlow!=='boolean'||typeof entry.requireEnglish!=='boolean'||entry.requireEnglish&&!entry.requireFlow)throw Error('Invalid batch section');
  if(keys.has(key(entry)))throw Error('Duplicate batch section');keys.add(key(entry));
 }
 if(manifest.minimumReady!==undefined)validateMinimumReady(manifest.minimumReady,manifest);
 return manifest;
}

export async function initializeBatchGate(directory){
 return withFileLock(join(directory,'postiz.lock'),async()=>withFileLock(batchFile(directory)+'.lock',async()=>{
  const current=await optional(batchFile(directory));if(current)return current;
  const state={version:1,status:'idle'};await atomic(batchFile(directory),state);return state;
 }));
}

export async function beginBatch(directory,id,manifest){
 if(!validId(id))throw Error('Invalid batch ID');validateBatchManifest(manifest);
 // The consumer holds this same lock through preflight and submission. Once
 // begin returns, no new external submission can slip ahead of the barrier.
 return withFileLock(join(directory,'postiz.lock'),async()=>{
  await refreshBatch(directory);
  return withFileLock(batchFile(directory)+'.lock',async()=>{
   const current=await optional(batchFile(directory));
   if(current.id===id){if(hash(current.manifest)!==hash(manifest))throw Error('Keep the original batch manifest when resuming');return current;}
   if(!['idle','complete','settled'].includes(current.status))throw Error('The previous batch is unfinished; resume it or explicitly settle its bounded production attempts');
   const archived=await optional(join(directory,'today-batches',id+'.json'));
   if(archived){if(hash(archived.manifest)!==hash(manifest))throw Error('Keep the original batch manifest when resuming');return archived;}
   if(current.id)await atomic(join(directory,'today-batches',current.id+'.json'),current);
   const state={version:1,id,status:'producing',startedAt:new Date().toISOString(),manifest:structuredClone(manifest),baselineResults:await resultNames(manifest.resultsDirectory),checks:[]};
   await atomic(batchFile(directory),state);return state;
  });
 },{timeout:120000});
}

async function sectionEvidence(entry,results,startedAt){
 const candidates=results.filter(result=>result.site===entry.siteId&&result.sectionId===entry.sectionId&&!result.noPublish);
 const articles=[...new Set(candidates.map(result=>result.articleId).filter(Boolean))];
 if(!articles.length)return {section:key(entry),status:'waiting_for_production'};
 if(articles.length!==1||!validId(articles[0]))return {section:key(entry),status:'needs_review',reason:'Multiple article identities in one planned section'};
 const articleId=articles[0],base={section:key(entry),articleId};
 const receipt=await optional(join(entry.publicationDirectory,articleId,'receipt.json'));
 let route;try{const url=new URL(receipt?.url,'https://publication.invalid');if(url.origin==='https://publication.invalid'&&url.pathname===receipt.url&&!url.search&&!url.hash&&!/[\\]|%(?:2f|5c)/i.test(receipt.url))route=url.pathname;}catch{}
 if(!receipt?.publicReadback||receipt.job?.status!=='success'||!route||!entry.requireFlow&&route!=='/news/'+articleId+'/'||!Number.isSafeInteger(receipt.revision)||!receipt.requestKey)return {...base,status:'waiting_for_chinese'};
 const matching=candidates.filter(result=>result.articleId===articleId&&(result.requestKey===receipt.requestKey||!result.requestKey&&result.taskId&&Date.parse(receipt.submittedAt)>=Date.parse(startedAt)));
 // A later recovery may complete the same saved request without rewriting the
 // producer's result. Its original request key is sufficient to bind evidence.
 if(!matching.length)return {...base,status:'waiting_for_request_identity'};
 let flow;
 if(entry.requireFlow){
  const cloud=receipt.asyncQueue?.continuationOwner==='cloud';
  const evidence=cloud?await readCloudContinuationEvidence({root:entry.root,siteId:entry.siteId,articleId,receipt}):null;
  if(cloud&&!evidence)return {...base,status:'waiting_for_continuation'};
  const id=evidence?.plan.id||receipt.publishingFlow?.id;
  if(!/^[a-f0-9]{40}$/.test(id||''))return {...base,status:'waiting_for_continuation'};
  const dir=join(flowDirectory(entry.root),'jobs',id),plan=evidence?.plan||await optional(join(dir,'plan.json')),state=evidence?.state||await optional(join(dir,'state.json'));
  if(plan?.id!==id||plan.siteId!==entry.siteId||plan.articleId!==articleId||plan.revision!==receipt.revision||typeof plan.origin!=='string'||plan.sourceUrl!==plan.origin+route)return {...base,status:'needs_review',reason:'Continuation identity or permalink does not match the Chinese receipt'};
  if(state?.status==='stale'||state?.status==='needs_review'||state?.translation?.status==='failed')return {...base,status:'needs_review',reason:'Internal continuation needs attention'};
  if(state?.chinese?.status!=='verified'||state.chinese.revision!==receipt.revision||state?.community?.status!=='verified'||entry.requireEnglish&&state?.english?.status!=='verified'||!state?.complete)return {...base,status:'waiting_for_internal_completion'};
  flow={planId:id,sha256:plan.sha256,...(evidence?{continuationOwner:'cloud',cloudJobId:evidence.jobId,artifactSha256:evidence.artifactSha256}:{})};
 }
 return {...base,status:'verified',requestKey:receipt.requestKey,revision:receipt.revision,...flow};
}

async function refreshState(file){
 return withFileLock(file+'.lock',async()=>{
  const state=await optional(file);
  if(state?.version!==1||!['idle','producing','complete','settled'].includes(state.status))throw Error('Daily batch gate is missing or invalid; retain external work');
  if(state.status==='idle')return state;
  validateBatchManifest(state.manifest);
  const minimumReady=state.releasePolicy?.minimumReady??state.manifest.minimumReady;
  if(minimumReady!==undefined)validateMinimumReady(minimumReady,state.manifest);
  if(!Array.isArray(state.baselineResults))throw Error('Batch baseline is missing');
  const results=state.productionResults?structuredClone(state.productionResults):[],evidenceErrors=[];
  if(state.productionResults&&!Array.isArray(state.productionResults))throw Error('Invalid frozen production results');
  if(!state.productionResults){
   const baseline=new Set(state.baselineResults);
   for(const name of await resultNames(state.manifest.resultsDirectory)){
    if(baseline.has(name))continue;
    try{const result=await optional(join(state.manifest.resultsDirectory,name));if(result)results.push(result);}catch(e){evidenceErrors.push({file:name,error:e.message});}
   }
  }
  const checks=[];
  for(const entry of state.manifest.entries){
   try{checks.push(await sectionEvidence(entry,results,state.startedAt));}catch(e){checks.push({section:key(entry),status:'needs_review',reason:'Publication evidence is unreadable: '+e.message});}
  }
  // One article cannot satisfy two planned sections or count twice toward a
  // quantity threshold, even if a producer reports it under both categories.
  for(const check of checks.filter(c=>c.articleId))if(checks.filter(c=>c.articleId===check.articleId&&c.section.split('/')[0]===check.section.split('/')[0]).length>1){check.status='needs_review';check.reason='One article occupies multiple planned sections';}
  const readyArticles=checks.filter((check,index)=>academic(state.manifest.entries[index])&&check.status==='verified').length;
  const allVerified=checks.every(check=>check.status==='verified'),next={...state,checks,evidenceErrors,readyArticles,releaseReady:minimumReady===undefined?allVerified:readyArticles>=minimumReady};
  if(allVerified){next.status='complete';next.completedAt||=new Date().toISOString();next.productionEndedAt||=next.completedAt;next.productionResults||=freezeResults(results);}
  else if(state.productionEndedAt)next.status='settled';
  if(hash(next)!==hash(state))await atomic(file,next);
  return next;
 });
}

// Freeze production identity at the explicit end of bounded attempts. Receipt
// and continuation evidence may still improve without mixing in tomorrow's
// newly generated articles, or changing this batch's original manifest.
const freezeResults=results=>results.map(({site,sectionId,taskId,articleId,requestKey,noPublish})=>({site,sectionId,taskId,articleId,requestKey,noPublish}));
export const refreshBatch=directory=>refreshState(batchFile(directory));

export async function setBatchThreshold(directory,id,minimumReady){
 return withFileLock(join(directory,'postiz.lock'),async()=>withFileLock(batchFile(directory)+'.lock',async()=>{
  const state=await optional(batchFile(directory));
  if(state?.version!==1||state.id!==id||!['producing','settled','complete'].includes(state.status))throw Error('Threshold update must name the current batch');
  validateBatchManifest(state.manifest);validateMinimumReady(minimumReady,state.manifest);
  const next={...state,releasePolicy:{minimumReady,updatedAt:new Date().toISOString()}};await atomic(batchFile(directory),next);return next;
 }),{timeout:120000});
}

export async function settleBatch(directory,id){
 return withFileLock(join(directory,'postiz.lock'),async()=>{
  const state=await refreshBatch(directory);
  if(state.id!==id||!['producing','settled','complete'].includes(state.status))throw Error('Settle must name the current batch');
  if(state.productionEndedAt)return state;
  return withFileLock(batchFile(directory)+'.lock',async()=>{
   const current=await optional(batchFile(directory)),baseline=new Set(current.baselineResults),results=[];
   for(const name of await resultNames(current.manifest.resultsDirectory))if(!baseline.has(name)){try{const result=await optional(join(current.manifest.resultsDirectory,name));if(result)results.push(result);}catch{}}
   const next={...current,status:'settled',productionEndedAt:new Date().toISOString(),productionResults:freezeResults(results)};await atomic(batchFile(directory),next);return next;
  });
 },{timeout:120000});
}

const matchesArticle=(state,packet)=>state.checks?.some(c=>c.articleId===packet.source.articleId&&c.section.startsWith(packet.source.siteId+'/'))||state.productionResults?.some(r=>r.site===packet.source.siteId&&r.articleId===packet.source.articleId);
async function archivedBatches(directory){
 const names=await readdir(join(directory,'today-batches')).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
 return Promise.all(names.filter(n=>n.endsWith('.json')&&validId(n.slice(0,-5))).map(async name=>({file:join(directory,'today-batches',name),state:await optional(join(directory,'today-batches',name))})));
}

async function cloudAuthorizedSources(directory){
 const path=join(directory,'cloud-authorizations'),names=await readdir(path).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 return Promise.all(names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>optional(join(path,name))));
}

export async function findCloudBatchOwner(directory,{root,siteId,articleId,receipt,evidence,batchId}){
 const recovery=await (await import('./publishing-recovery-cohort.mjs')).findRecoveryCloudOwner({handoffDirectory:directory,root,siteId,articleId,receipt,evidence,batchId});
 if(recovery)return recovery;
 const packet={source:{siteId,articleId}},current=await refreshBatch(directory),owners=[];
 if(current.status!=='idle'&&matchesArticle(current,packet))owners.push(current);
 for(const candidate of await archivedBatches(directory))if(candidate.state&&matchesArticle(candidate.state,packet))owners.push(await refreshState(candidate.file));
 if(owners.length!==1)throw Error('Cloud continuation has no unique retained Today batch');
 const owner=owners[0],checks=owner.checks.filter(check=>check.articleId===articleId&&check.section.startsWith(siteId+'/'));
 if(batchId!==undefined&&batchId!==owner.id||checks.length!==1)throw Error('Cloud continuation does not match its requested batch');
 const check=checks[0],entry=owner.manifest.entries.find(item=>key(item)===check.section);
 if(!academic(entry)||resolve(entry.root)!==resolve(root)||check.status!=='verified'||check.continuationOwner!=='cloud'||check.requestKey!==receipt.requestKey||check.revision!==evidence.plan.revision||check.planId!==evidence.plan.id||check.sha256!==evidence.plan.sha256||check.cloudJobId!==evidence.jobId||check.artifactSha256!==evidence.artifactSha256)throw Error('Cloud continuation differs from the batch publication evidence');
 return {batchId:owner.id,manifestSha256:hash(owner.manifest),section:check.section};
}

async function verifyPacket(directory,state,packet){
 if(!state.releaseReady)throw Error('Waiting for '+(state.releasePolicy?.minimumReady??state.manifest.minimumReady??'all')+' ready Today articles: '+state.id);
 const checks=state.checks.filter(c=>c.articleId===packet.source.articleId&&c.section.startsWith(packet.source.siteId+'/'));
 if(checks.length!==1||checks[0].status!=='verified')throw Error('This article has not completed its internal publication');
 const check=checks[0],entry=state.manifest.entries.find(e=>key(e)===check.section);
 if(!academic(entry)||check.planId!==packet.planId||check.revision!==packet.source.revision||check.sha256!==packet.source.sha256)throw Error('Packet does not match the verified academic publication identity');
 // Rebuild the exact immutable language packet from its completed flow. This
 // binds plan, source revision, English edition, Ente link and target together;
 // the ordinary adapter still verifies public pages and target authorization.
 let plan,flow,evidence;
 if(check.continuationOwner==='cloud'){
  if(packet.cloudContinuation?.jobId!==check.cloudJobId||packet.cloudContinuation.artifactSha256!==check.artifactSha256||packet.cloudContinuation.batchId!==state.id)throw Error('Packet has no frozen cloud continuation authorization');
  const receipt=await optional(join(entry.publicationDirectory,packet.source.articleId,'receipt.json'));
  evidence=await readCloudHandoffEvidence({root:entry.root,siteId:entry.siteId,articleId:packet.source.articleId,receipt,handoffDirectory:directory,batchId:state.id,manifestSha256:hash(state.manifest),section:check.section});
  if(!evidence)throw Error('Cloud continuation has no local draft authorization');
  ({plan,state:flow}=evidence);
 }else{
  if(packet.cloudContinuation)throw Error('Cloud packet cannot use a local continuation');
  const dir=join(flowDirectory(entry.root),'jobs',check.planId);plan=await optional(join(dir,'plan.json'));flow=await optional(join(dir,'state.json'));
 }
 if(flow?.chinese?.status!=='verified'||flow.chinese.revision!==check.revision||flow.community?.status!=='verified'||entry.requireEnglish&&flow.english?.status!=='verified'||!flow.complete)throw Error('This article continuation is no longer complete');
 if(!plan?.policy?.targets?.some(target=>isDeepStrictEqual(target,packet.target)))throw Error('Packet target is outside its frozen flow');
 const expected=evidence?cloudHandoffPacket(evidence,packet.target):externalPackage(plan,packet.target,flow.edition,flow.community.url);
 if(!isDeepStrictEqual(packet,expected))throw Error('Packet source, language edition or content differs from its completed flow');
}

export function batchGatedAdapter(directory,adapter){
 // One snapshot per locked Postiz tick, shared by its packets. No network or
 // model calls occur while the batch is held. Existing uncertain receipts can
 // still be queried by postizTick; the barrier only prevents new submissions.
 let gate,archives,cloudSources;const refreshedArchives=new Map();
 return {...adapter,preflight:async packet=>{
  // An explicit recovery cohort preserves its original batch and validates an
  // individual cloud draft without changing the daily publication barrier.
  if(await (await import('./publishing-recovery-cohort.mjs')).verifyRecoveryCloudPacket({handoffDirectory:directory,packet}))return adapter.preflight?.(packet);
  const state=await (gate??=refreshBatch(directory));
  try{
   if(state.status==='idle'){
    const frozen=await (cloudSources??=cloudAuthorizedSources(directory));
    if(packet.cloudContinuation||frozen.some(item=>item?.planId===packet.planId||item?.grant?.siteId===packet.source?.siteId&&item.grant.articleId===packet.source?.articleId))throw Error('Cloud packet requires its retained Today batch');
   }
   if(state.status!=='idle'){
    if(!validId(packet.source?.siteId)||!validId(packet.source?.articleId))throw Error('Packet has no bound publication identity');
    let owner=matchesArticle(state,packet)?state:null;
    if(!owner){
     // Previous partial batches keep their pending continuations. Only their
     // frozen production identities are read; new-day results are excluded.
     const candidates=await (archives??=archivedBatches(directory));
     const matching=candidates.filter(candidate=>candidate.state&&matchesArticle(candidate.state,packet));
     if(matching.length!==1)throw Error('Packet has no unique retained Today batch');
     const candidate=matching[0];if(!refreshedArchives.has(candidate.file))refreshedArchives.set(candidate.file,refreshState(candidate.file));owner=await refreshedArchives.get(candidate.file);
    }
    await verifyPacket(directory,owner,packet);
   }
  }catch(e){throw Object.assign(e,{retryAt:Date.now()+60000});}
  return adapter.preflight?.(packet);
 }};
}

// The raw Postiz adapter uses this too, so choosing a different CLI consumer
// cannot bypass the cloud packet's batch or strip its local draft grant.
export async function validateCloudPostizPacket({handoffDirectory,packet}){
 const frozen=await cloudAuthorizedSources(handoffDirectory);
 const bound=frozen.some(item=>item?.planId===packet.planId||item?.grant?.siteId===packet.source?.siteId&&item.grant.articleId===packet.source?.articleId);
 if(!packet.cloudContinuation&&!bound)return;
 if(!packet.cloudContinuation)throw Error('Cloud packet requires its retained Today batch and frozen cloud marker');
 await batchGatedAdapter(handoffDirectory,{}).preflight(packet);
}

const summary=state=>({id:state.id,status:state.status,startedAt:state.startedAt,completedAt:state.completedAt,productionEndedAt:state.productionEndedAt,planned:state.manifest?.entries.length,verified:state.checks?.filter(check=>check.status==='verified').length,minimumReady:state.releasePolicy?.minimumReady??state.manifest?.minimumReady,readyArticles:state.readyArticles,releaseReady:state.releaseReady,checks:state.checks,evidenceErrors:state.evidenceErrors});
async function main(args){
 const [command,path,id,manifestFile]=args;if(!path||!isAbsolute(path))throw Error('Use an absolute handoff directory');const directory=resolve(path);
 if(command==='init')return summary(await initializeBatchGate(directory));
 if(command==='begin')return summary(await beginBatch(directory,id,JSON.parse(await readFile(manifestFile,'utf8'))));
 if(command==='status')return summary(await refreshBatch(directory));
 if(command==='threshold'){await setBatchThreshold(directory,id,Number(manifestFile));return summary(await refreshBatch(directory));}
 if(command==='settle')return summary(await settleBatch(directory,id));
 if(command!=='watch')throw Error('Usage: publishing-batch.mjs init|status|watch <handoff>; begin <handoff> <batch-id> <manifest.json>; threshold <handoff> <batch-id> <minimum-ready-count>; settle <handoff> <batch-id>');
 await refreshBatch(directory);
 const policy=await optional(join(directory,'postiz-policy.json'));if(!policy?.enabled||!policy.authorization)throw Error('Configure a separately approved Postiz policy');
 const {postizAdapter}=await import('./publishing-flow-postiz.mjs'),{watchPostiz}=await import('./publishing-flow-watch.mjs');
 const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
 return watchPostiz({directory,signal:controller.signal,tick:()=>postizTick({handoffDirectory:directory,adapter:batchGatedAdapter(directory,postizAdapter({handoffDirectory:directory,allowedTargets:policy.targets,allowedSources:policy.sources,delivery:policy.delivery||'draft',publishAuthorization:policy.publishAuthorization}))})});
}
// No top-level await: watch holds an open Promise, and recovery-cohort
// statically imports this module during the first Postiz scan.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void (async()=>{
 try{console.log(JSON.stringify(await main(process.argv.slice(2))));}catch(error){console.error('Publishing batch: '+error.message);process.exitCode=1;}
})();
