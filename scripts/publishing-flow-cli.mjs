#!/usr/bin/env node
import {readFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {configureFlow,enqueuePublished,flowDirectory,flowStatus,optional,todayTick,postizTick,validateFlowPlanIds,validateFlowReviewPlanIds} from './publishing-flow.mjs';
import {siteForWorkspace,setSiteContext,validateSite,publicationDirectory} from './site-config.mjs';
import {withFileLock} from './editorial-lock.mjs';

async function main(args){
 if(['cloud-sync','cloud-watch'].includes(args[0])){
  const file=resolve(args[1]);const {syncCloudContinuations,watchCloudContinuations}=await import('./publishing-flow-cloud-sync.mjs');
  if(args[0]==='cloud-sync')return syncCloudContinuations(JSON.parse(await readFile(file,'utf8')));
  const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
  return watchCloudContinuations(file,{signal:controller.signal,emit:rows=>console.log(JSON.stringify(rows))});
 }
 if(args[0]==='supervise'){
  const {superviseFlows}=await import('./publishing-flow-supervisor.mjs');const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
  return superviseFlows(resolve(args[1]),{signal:controller.signal,emit:rows=>console.log(JSON.stringify(rows))});
 }
 if(['postiz','postiz-watch'].includes(args[0])){
  const handoffDirectory=resolve(args[1]||''),policy=await optional(join(handoffDirectory,'postiz-policy.json'));if(!policy?.enabled||!policy.authorization)throw Error('Configure a separately approved Postiz policy');
  const {postizAdapter}=await import('./publishing-flow-postiz.mjs');const tick=()=>postizTick({handoffDirectory,adapter:postizAdapter({handoffDirectory,allowedTargets:policy.targets,allowedSources:policy.sources,delivery:policy.delivery||'draft',publishAuthorization:policy.publishAuthorization})});
  if(args[0]==='postiz')return tick();
  const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());const {watchPostiz}=await import('./publishing-flow-watch.mjs');return watchPostiz({directory:handoffDirectory,tick,signal:controller.signal});
 }
 let root,site,tokenFile,command,rest;
 if(args[0]==='root'){
  root=resolve(args[1]);const declared=process.env.SCHOLAY_SITE_JSON?validateSite(JSON.parse(process.env.SCHOLAY_SITE_JSON)):null;if(declared)setSiteContext(declared);
  site=siteForWorkspace(root);if(declared&&(declared.id!==site.id||declared.origin!==site.origin))throw Error('Background workspace identity mismatch');
  tokenFile=process.env.SCHOLAY_TODAY_TOKEN_FILE||join(publicationDirectory(root),'publish-token');[command,...rest]=args.slice(2);
 }
 else{const {applySiteEnv}=await import('../desktop/scripts/agent/headless/env.mjs');const context=applySiteEnv(args[0]);({root,site,tokenFile}=context);[command,...rest]=args.slice(1);}
 // An English capability is still verified at the server before any call.
 site={...site,languages:['zh-CN','en']};setSiteContext(site);
 if(command==='handoff-cloud'){
  const [articleId,handoffPath,grantFile]=rest;if(!articleId||!handoffPath)throw Error('Usage: flow <site> handoff-cloud <articleId> <handoff> [exact-authorization.json]');
  const receipt=await optional(join(publicationDirectory(root),articleId,'receipt.json'));
  const {handoffCloudContinuation}=await import('./publishing-flow-handoff.mjs');
  return handoffCloudContinuation({root,siteId:site.id,articleId,receipt,handoffDirectory:resolve(handoffPath),...(grantFile?{authorization:JSON.parse(await readFile(grantFile,'utf8'))}:{})});
 }
 if(command==='configure')return configureFlow(root,site,JSON.parse(await readFile(rest[0],'utf8')));
 if(command==='status')return (await flowStatus(root)).map(({plan,state})=>({id:plan.id,articleId:plan.articleId,revision:plan.revision,...state,edition:undefined}));
 const {flowWebsite}=await import('./publishing-flow-website.mjs');const website=flowWebsite({root,site,tokenFile});
 if(command==='enqueue'){
  const source=await website.readSource(rest[0]);if(source.version!==source.publishedVersion)throw Error('Publish or resolve the current Chinese revision first');
  await website.verify(source.data,source.version);
  return enqueuePublished({root,site,data:source.data,receipt:{url:source.url,revision:source.version,publicReadback:true,explicitContinuation:true,job:{status:'success'}}});
 }
 if(command==='accept-translation'){
  if(!rest.includes('--reviewed'))throw Error('A reviewed translation is required');
  const {retryTranslation}=await import('./publishing-flow-recovery.mjs');
  return retryTranslation({root,site,id:rest[0],readSource:website.readSource,edition:JSON.parse(await readFile(rest[1],'utf8'))});
 }
 if(command==='retry-translation'){
  const {retryTranslation}=await import('./publishing-flow-recovery.mjs');return retryTranslation({root,site,id:rest[0],readSource:website.readSource});
 }
 if(!['tick','drain','resume'].includes(command))throw Error('Usage: flow <site> configure <policy.json>|enqueue <sourceId>|tick|drain|resume|status|retry-translation <job>|accept-translation <job> <json> --reviewed; flow supervise <workspaces.json>; flow postiz <handoff>');
 let planIds,reviewBeforeEnglishPlanIds;
 if(rest.length){
  planIds=[];for(let index=0;index<rest.length;index+=2){
   if(!['--plan','--review-before-english'].includes(rest[index])||!rest[index+1])throw Error('Usage: tick|drain|resume [--plan <40-character flow id>]... [--review-before-english <selected flow id>]...');
   if(rest[index]==='--plan')planIds.push(rest[index+1]);else (reviewBeforeEnglishPlanIds||=[]).push(rest[index+1]);
  }
  planIds=validateFlowPlanIds(planIds);
  reviewBeforeEnglishPlanIds=validateFlowReviewPlanIds(reviewBeforeEnglishPlanIds,planIds);
 }
 const policy=await optional(join(flowDirectory(root),'policy.json'));if(!policy?.enabled)return {status:'disabled'};
 const {translateEdition}=await import('./publishing-flow-language.mjs');
 const {recoverSubmissions,pendingSubmissions}=await import('./publishing-flow-recovery.mjs');
 const cloudExecutor=process.env.SCHOLAY_CLOUD_EXECUTOR==='1';
 const run=async()=>{
  // The independent cloud service is managed by systemd and has a read-only
  // code release. It neither uses nor locks the desktop updater runtime.
  const release=process.env.SCHOLAY_DESKTOP_RUNTIME==='1'||cloudExecutor?async()=>{}:await (await import('../desktop/scripts/agent/headless/update.mjs')).runtimeLease();
  // The cloud queue owns Chinese submission recovery. Its continuation worker
  // consumes frozen plans only, without the desktop's editorial inventory.
  try{if(!cloudExecutor&&planIds===undefined)await recoverSubmissions({root,site,tokenFile});return await todayTick({root,site,...website,translate:translateEdition,planIds,reviewBeforeEnglishPlanIds});}finally{await release();}
 };
 if(command==='tick')return run();
 // Keep one small worker while links are pending. This process closes each
 // provider session before waiting, backs off after three translations, and
 // exits when the durable queue is done or needs human review.
 return withFileLock(join(flowDirectory(root),'worker.lock'),async()=>{
  if(command==='resume')return run();
  let translations=0,last;const started=Date.now();
  while(Date.now()-started<24*3600000){
   const jobs=await flowStatus(root,{pendingOnly:true,limit:3,now:Infinity,planIds});if(!jobs.length&&(cloudExecutor||planIds!==undefined||!(await pendingSubmissions(root,Infinity)).length))break;
   last=await run();translations+=last.modelCalls;
   const waiting=translations>=3?60000:30000;if(translations>=3)translations=0;
   await new Promise(resolve=>setTimeout(resolve,waiting));
  }
  return last||{status:'idle'};
 },{timeout:100});
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>resolve(process.argv[1]))===await realpath(fileURLToPath(import.meta.url))){
 try{try{const {setPriority}=await import('node:os');setPriority(10);}catch{}console.log(JSON.stringify(await main(process.argv.slice(2))));}catch(error){console.error('Publishing flow: '+error.message);process.exitCode=1;}
}
