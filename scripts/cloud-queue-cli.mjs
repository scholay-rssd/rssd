#!/usr/bin/env node
import {readFile,realpath} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCloudQueue,runCloudQueueWorker} from './cloud-queue.mjs';
import {createCloudQueueServer} from './cloud-queue-server.mjs';
import {validateSite} from './site-config.mjs';
import {isPrivateFile} from './private-file.mjs';
import {articleLocale} from '../contracts/language-editions.mjs';

export async function loadCloudQueueConfig(file){
 if(!await isPrivateFile(file))throw Error('Cloud queue config must be private (0600 or a private Windows ACL)');
 const config=JSON.parse(await readFile(file,'utf8'));
 if(config.version!==1||!isAbsolute(config.directory||'')||!Array.isArray(config.sites)||!config.sites.length)throw Error('Invalid cloud queue config');
 const sites=[];
 for(const entry of config.sites){
  if(!isAbsolute(entry.siteFile||'')||!isAbsolute(entry.tokenFile||'')||entry.workspaceRoot&&!isAbsolute(entry.workspaceRoot))throw Error('Cloud queue paths must be absolute');
  const site=validateSite(JSON.parse(await readFile(entry.siteFile,'utf8')));
  if(entry.workspaceRoot){const workspace=validateSite(JSON.parse(await readFile(join(entry.workspaceRoot,'.site.json'),'utf8')));if(workspace.id!==site.id||workspace.origin!==site.origin)throw Error('Cloud continuation workspace belongs to another site');}
  sites.push({...entry,site});
 }
 return {...config,sites};
}
export async function continueCloudPublication({entry,site,packet,receipt,credentialId}){
  if(articleLocale(packet.data)!=='zh-CN')return {status:'disabled',reason:'Only Chinese source publications require continuation'};
  if(!entry.workspaceRoot)throw Object.assign(Error('Cloud continuation workspace is unavailable'),{statusCode:409});
  // This only freezes a plan in the already existing flow queue. Its ordinary
  // supervised consumer handles translation, Ente and approved Postiz targets.
  const {enqueuePublished}=await import('./publishing-flow.mjs');
  const result=await enqueuePublished({root:entry.workspaceRoot,site,data:packet.data,receipt,policyFile:join(entry.workspaceRoot,'.local/publishing-flow/policy.json'),credential:{credentialId,tokenFile:entry.tokenFile}});
  if(!['queued','complete'].includes(result.status))throw Object.assign(Error('Cloud continuation policy did not accept this source'),{statusCode:409});
  return result;
}
export async function main(args){
 const command=args[0],index=args.indexOf('--config'),configFile=index>=0?args[index+1]:process.env.SCHOLAY_CLOUD_QUEUE_CONFIG;
 if(!['check','serve','tick','status','reverify','close'].includes(command)||!configFile)throw Error('Usage: cloud-queue-cli.mjs check|serve|tick|status --config /private/config.json; reverify --site <site-id> --job <original-job-id> --config /private/config.json; close --site <site-id> --job <original-job-id> --reason duplicate_source --config /private/config.json');
 const config=await loadCloudQueueConfig(resolve(configFile));
 const queue=createCloudQueue({...config,continuation:continueCloudPublication});
 if(command==='check'){
  for(const entry of config.sites){if(!await isPrivateFile(entry.tokenFile)||!(await readFile(entry.tokenFile,'utf8')).trim())throw Error('Every site requires a nonempty private token file');}
  return {status:'configured',sites:config.sites.map(entry=>entry.site.id),directory:config.directory};
 }
 if(command==='tick')return queue.tick();
 if(command==='status')return Promise.all(config.sites.map(async entry=>({siteId:entry.site.id,jobs:await queue.list(entry.site.id)})));
 if(command==='reverify'){
  const siteIndex=args.indexOf('--site'),jobIndex=args.indexOf('--job'),siteId=siteIndex>=0?args[siteIndex+1]:undefined,jobId=jobIndex>=0?args[jobIndex+1]:undefined;
  if(!config.sites.some(entry=>entry.site.id===siteId)||!/^[a-f0-9]{64}$/.test(jobId||''))throw Error('Reverify requires an exact configured site and original cloud job ID');
  return queue.reverify(siteId,jobId);
 }
 if(command==='close'){
  const value=name=>{const at=args.indexOf(name);return at>=0?args[at+1]:undefined;},siteId=value('--site'),jobId=value('--job');
  if(!config.sites.some(entry=>entry.site.id===siteId)||!/^[a-f0-9]{64}$/.test(jobId||''))throw Error('Close requires an exact configured site and original cloud job ID');
  return queue.close(siteId,jobId,{reason:value('--reason')});
 }
 const host=config.listen?.host||'127.0.0.1',port=config.listen?.port||8789;
 if(!['127.0.0.1','::1'].includes(host)||!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Bind the cloud queue to an unprivileged loopback port behind HTTPS');
 const controller=new AbortController(),server=createCloudQueueServer({queue,basePath:config.basePath||''});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 const stop=()=>{controller.abort();server.close();server.closeIdleConnections();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 console.log(JSON.stringify({status:'listening',host,port,sites:config.sites.map(entry=>entry.site.id)}));
 try{await runCloudQueueWorker({queue,signal:controller.signal,onTick:rows=>console.log(JSON.stringify({event:'queue_tick',jobs:rows.map(({jobId,siteId,status,stage})=>({jobId,siteId,status,stage}))}))});}
 finally{stop();process.off('SIGINT',stop);process.off('SIGTERM',stop);await new Promise(resolve=>server.close(resolve));}
 return {status:'stopped'};
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>resolve(process.argv[1]))===await realpath(fileURLToPath(import.meta.url))){try{const result=await main(process.argv.slice(2));if(result!==undefined)console.log(JSON.stringify(result));}catch(error){console.error('Cloud queue: '+error.message);process.exitCode=1;}}
