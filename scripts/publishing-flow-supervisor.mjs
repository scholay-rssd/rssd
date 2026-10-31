import {spawn} from 'node:child_process';
import {dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {flowStatus,flowDirectory,optional,atomic,validateFlowPlanIds,validateFlowReviewPlanIds} from './publishing-flow.mjs';
import {pendingSubmissions} from './publishing-flow-recovery.mjs';
import {validateSite} from './site-config.mjs';
import {withFileLock,lockOwnerAlive} from './editorial-lock.mjs';

// One service covers all explicitly configured workspaces. Idle rounds read
// local state only: no model, API polling or article-body scans.
export async function superviseFlows(file,{signal,intervalMs=60000,emit=()=>{},run=runWorker}={}){
 return withFileLock(file+'.lock',async()=>{
  while(!signal?.aborted){
   const config=JSON.parse(await readFile(file,'utf8'));
   if(config.version!==1||!Array.isArray(config.workspaces))throw Error('Invalid continuation service configuration');
   // Validate every scope before starting any workspace in this round.
   const workspaces=config.workspaces.map(entry=>({...entry,planIds:validateFlowPlanIds(entry.planIds),reviewBeforeEnglishPlanIds:validateFlowReviewPlanIds(entry.reviewBeforeEnglishPlanIds,entry.planIds)}));
   const results=[];
   for(const entry of workspaces){
    if(signal?.aborted)break;
    const site=validateSite(entry.site);if(!isAbsolute(entry.root)||!isAbsolute(entry.tokenFile))throw Error('Absolute workspace and token paths required');
    try{
     const policy=await optional(join(flowDirectory(entry.root),'policy.json'));if(!policy?.enabled||!policy.autoRun)continue;
     const pending=(await flowStatus(entry.root,{pendingOnly:true,limit:1,planIds:entry.planIds})).length||(entry.planIds===undefined&&process.env.SCHOLAY_CLOUD_EXECUTOR!=='1'&&(await pendingSubmissions(entry.root)).length);
     if(!pending)continue;
     const owner=await optional(join(flowDirectory(entry.root),'worker.lock'));if(owner&&await lockOwnerAlive(owner))continue;
     results.push({siteId:site.id,...await run({...entry,site},signal)});
    }catch(e){results.push({siteId:site.id,error:e.message});}
   }
   await atomic(file+'.status.json',{checkedAt:new Date().toISOString(),pid:process.pid,results});
   if(results.length)emit(results);
   try{await delay(intervalMs,null,{signal});}catch(e){if(e.name!=='AbortError')throw e;}
  }
 },{timeout:100});
}
async function runWorker(entry,signal){
 const planIds=validateFlowPlanIds(entry.planIds);
 const reviewBeforeEnglishPlanIds=validateFlowReviewPlanIds(entry.reviewBeforeEnglishPlanIds,planIds);
 // No repeated flags would mean the default unrestricted CLI. An explicit
 // empty scope must therefore finish here without launching a child at all.
 if(planIds?.length===0)return {code:0,result:JSON.stringify({modelCalls:0,jobs:[]})};
 const env={...process.env,SCHOLAY_EDITORIAL_ROOT:entry.root,SCHOLAY_SITE_JSON:JSON.stringify(entry.site),SCHOLAY_SITE_ID:entry.site.id,SCHOLAY_TODAY_TOKEN_FILE:entry.tokenFile};
 // Each workspace must use its own credential. No inherited inline site token.
 delete env.SCHOLAY_TODAY_TOKEN;delete env.SCHOLAY_SITE_CONFIG;delete env.SCHOLAY_FLOW_POLICY_FILE;
 const child=spawn(process.execPath,[fileURLToPath(new URL('./publishing-flow-cli.mjs',import.meta.url)),'root',entry.root,'resume',...(planIds||[]).flatMap(id=>['--plan',id]),...(reviewBeforeEnglishPlanIds||[]).flatMap(id=>['--review-before-english',id])],{env,cwd:dirname(fileURLToPath(import.meta.url)),stdio:['ignore','pipe','pipe'],signal});
 let output='',error='';child.stdout.on('data',b=>{output=(output+b).slice(-16000);});child.stderr.on('data',b=>{error=(error+b).slice(-2000);});
 const code=await new Promise((ok,fail)=>{child.once('error',fail);child.once('exit',ok);});
 return {code,...(code?{error}:{result:output.trim()})};
}
