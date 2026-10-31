#!/usr/bin/env node
import {readFile,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSite} from './site-config.mjs';
import {CLOUD_CONTINUATION_SITES} from './publishing-flow-artifact.mjs';
import {isPrivateFile} from './private-file.mjs';
import {atomic,optional} from './publishing-flow.mjs';
import {withFileLock} from './editorial-lock.mjs';

export const GROK_QUEUE_ENDPOINT='https://post.linkc.cloud/today-queue';
export async function configureGrokCloud(file,{apply=false,fetcher=fetch}={}){
 const config=JSON.parse(await readFile(file,'utf8'));
 if(config.version!==1||!Array.isArray(config.workspaces)||config.workspaces.length!==5)throw Error('Exactly five cloud workspaces are required');
 if(process.env.SCHOLAY_PUBLICATION_QUEUE_CONFIG)throw Error('Remove the global queue override before configuring per-workspace ownership');
 const rows=[],seen=new Set();
 for(const entry of config.workspaces){
  const site=validateSite(entry.site);
  if(!CLOUD_CONTINUATION_SITES.includes(site.id)||seen.has(site.id)||!isAbsolute(entry.root)||!isAbsolute(entry.tokenFile))throw Error('Unexpected cloud workspace');
  seen.add(site.id);
  const bound=await optional(join(entry.root,'.site.json'));
  if(!bound||bound.id!==site.id||bound.origin!==site.origin)throw Error('Workspace binding missing or different: '+site.id);
  if(!await isPrivateFile(entry.tokenFile))throw Error('Private token file required: '+site.id);
  const target=join(entry.root,'.local/publication-queue.json'),before=await optional(target);
  const desired={version:1,enabled:true,endpoint:GROK_QUEUE_ENDPOINT,continuationOwner:'cloud'};
  rows.push({site,entry,target,before,desired});
 }
 // Check the complete set before changing even one workspace. This GET uses
 // existing site credentials but returns no job content to console or files.
 for(const row of rows){
  const token=(await readFile(row.entry.tokenFile,'utf8')).trim();if(!token)throw Error('Empty token: '+row.site.id);
  const response=await fetcher(GROK_QUEUE_ENDPOINT+'/v1/jobs',{headers:{Authorization:'Bearer '+token,'X-Scholay-Site':row.site.id},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Queue authorization check failed: '+row.site.id+' HTTP '+response.status);
  let body;try{body=await response.json();}catch{throw Error('Queue returned a non-JSON response: '+row.site.id);}
  if(!body||!Array.isArray(body.jobs)||Object.keys(body).some(key=>key!=='jobs')||body.jobs.some(job=>job.siteId!==row.site.id||!/^[a-f0-9]{64}$/.test(job.jobId||'')))throw Error('Queue response identity is invalid: '+row.site.id);
 }
 if(apply)await withFileLock(file+'.configure.lock',async()=>{
  for(const row of rows){
   if(JSON.stringify(await optional(row.target))!==JSON.stringify(row.before))throw Error('Queue configuration changed during preflight: '+row.site.id);
  }
  for(const row of rows){
   if(JSON.stringify(row.before)===JSON.stringify(row.desired))continue;
   const backup=row.target+'.before-cloud.json';
   if(!await optional(backup))await atomic(backup,{version:1,existed:row.before!==null,config:row.before});
   await atomic(row.target,row.desired);
  }
 },{timeout:100});
 return {status:apply?'configured':'validated',sites:rows.map(row=>row.site.id),continuationOwner:'cloud',oldReceiptsChanged:false,routinesChanged:false};
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>resolve(process.argv[1]))===await realpath(fileURLToPath(import.meta.url))){
 try{const [file,...args]=process.argv.slice(2);if(!file||args.some(arg=>arg!=='--apply'))throw Error('Usage: grok-cloud-configure.mjs <private-workspaces.json> [--apply]');console.log(JSON.stringify(await configureGrokCloud(resolve(file),{apply:args.includes('--apply')})));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
