#!/usr/bin/env node
// Private operator entrypoint. --check is read-only; --run also requires the
// private configuration's explicit enabled flag and a device token in env.
import {readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {normalizeFrozenSchedule,compileSchedule} from './rssd-multisite-scheduler.mjs';
import {loadCenterConnection,writeCenterJson} from './rssd-center-client.mjs';
import {createWriterProofAdapter} from './rssd-writer-proof.mjs';
import {runConfiguredMultisite} from './rssd-multisite-runtime.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {cursorGalleryRuntimeIdentity} from './rssd-cursor-bridge-lifecycle.mjs';
import {configuredCursorImageRuntime,validateCursorImageRuntimeConfiguration} from './rssd-cursor-runtime-config.mjs';
import {createOriginalGalleryRegistrar} from './rssd-original-gallery-registrar.mjs';
import {configuredSourceRuntime,validateSourceRuntimeConfiguration} from './rssd-source-runtime-config.mjs';

const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const absolute=(value,name)=>{if(typeof value!=='string'||!isAbsolute(value))throw Error(`${name} must be an absolute private path`);return value;};
export async function honorDesktopStop(home,controller){try{await readFile(join(home,'stop.json'));controller.abort();}catch(error){if(error.code!=='ENOENT')controller.abort();}}
export async function readMultisiteConfiguration(path){
 const config=await readJson(absolute(path,'config'));
 if(config?.version!==1||typeof config.enabled!=='boolean'||!Array.isArray(config.sections)||!config.cutovers||typeof config.cutovers!=='object')throw Error('Invalid runtime configuration');
 validateCursorImageRuntimeConfiguration(config.imageRuntime);
 validateSourceRuntimeConfiguration(config.sourceRuntime);
 const home=absolute(config.home,'home'),snapshot=await readJson(absolute(config.schedulePath,'schedule')),profiles=await readJson(absolute(config.profilesPath,'profiles'));
 const newRules=config.newRulesPath===undefined?undefined:await readJson(absolute(config.newRulesPath,'new rules'));
 const plan=normalizeFrozenSchedule(snapshot,{newRules}),compiled=compileSchedule(plan,config.sections,profiles);
 return {config,home,plan,profiles,compiled};
}
function executeProof({python,script,cutovers}){
 absolute(python,'python');absolute(script,'proof script');
 return ({siteId,runId,nonce,signal})=>new Promise((resolve,reject)=>{
  const item=cutovers[siteId];if(!item||item.expected?.runId!==runId)return reject(Error('Site proof is not configured'));
  const args=[script,'writer-proof',siteId,'--run',absolute(item.runPath,'run'),'--config',absolute(item.privateConfigPath,'guard config'),'--nonce',nonce,'--inspect-live'];
  const env=Object.fromEntries(['HOME','USER','LOGNAME','PATH','LANG','TMPDIR'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
  const child=spawn(python,args,{env,stdio:['ignore','pipe','ignore']});let out='',settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
  const cancel=()=>{child.kill('SIGTERM');finish(Error('Writer proof cancelled'));};
  const timer=setTimeout(()=>{child.kill('SIGTERM');finish(Error('Writer proof timed out'));},30000);
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk;if(out.length>65536){child.kill('SIGTERM');finish(Error('Writer proof response too large'));}});
  child.on('error',()=>finish(Error('Writer proof unavailable')));child.on('close',code=>{if(code!==0)return finish(Error('Writer proof rejected'));try{finish(null,JSON.parse(out));}catch{finish(Error('Writer proof response invalid'));}});
 });
}
export function desktopEventStatus(entry,activeArticle=false){
 if(entry.type==='work')activeArticle=entry.state==='running';
 const blocked=entry.state==='blocked';
 return {activeArticle,patch:{state:activeArticle?'working':blocked?'blocked':'idle',message:activeArticle?'正在处理当前文章':blocked?'原任务已保留，请检查状态':'多站排程运行中'}};
}
export async function main(argv=process.argv.slice(2),{forcedHome,desktop=false}={}){
 if(argv.length===2&&argv[0]==='--image-identity'&&!desktop){const file=absolute(argv[1],'image identity');await writeFile(file,JSON.stringify(await cursorGalleryRuntimeIdentity(),null,2)+'\n',{flag:'wx',mode:0o600});return {state:'image_identity_saved'};}
 if(argv.length!==2||!['--check','--run'].includes(argv[0]))throw Error('Usage: rssd-multisite-cli.mjs --check|--run PRIVATE-CONFIG, or --image-identity PRIVATE-FILE');
 const {config,home,plan,profiles,compiled}=await readMultisiteConfiguration(argv[1]);
 if(forcedHome&&resolve(absolute(forcedHome,'center home'))!==resolve(home))throw Error('Runtime configuration belongs to another center directory');
 if(argv[0]==='--check')return {state:'checked',enabled:config.enabled,configuredSections:compiled.length};
 if(config.enabled!==true){if(desktop)throw Error('多站排程配置尚未启用');return {state:'disabled'};}
 if(!compiled.length)throw Error('No verified sections enabled');
 const catalog=await readJson(absolute(config.catalogPath,'catalog')),organizations={};
 for(const siteId of new Set(compiled.map(x=>x.siteId))){const item=config.cutovers[siteId];if(!item?.expected)throw Error('Per-site cutover evidence missing');organizations[siteId]=await readJson(join(absolute(config.organizationDirectory,'organization directory'),siteId+'.json'));}
 const {client,identity}=await loadCenterConnection(home);if(!identity?.orgId||!identity.workerId)throw Error('Center device identity missing');
 const connection={origin:client.origin,orgId:identity.orgId,workerId:identity.workerId};
 const sourceRuntime=await configuredSourceRuntime(config.sourceRuntime,{home,connection,client});
 const imageRuntime=await configuredCursorImageRuntime(config.imageRuntime,{registrarFactory:async({workspace,bridge})=>createOriginalGalleryRegistrar({workspace,bridge})});
 const writerProof=createWriterProofAdapter({expected:async({siteId})=>config.cutovers[siteId]?.expected,execute:executeProof({python:config.proofPython,script:config.proofScript,cutovers:config.cutovers})});
 const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 const state={pid:process.pid,state:'starting',agentId:'codex',modelId:'gpt-6.1-terra',workspaceIds:[...new Set(compiled.map(x=>x.workspaceId))],mode:'multisite',startedAt:new Date().toISOString()};let timer,chain=Promise.resolve(),activeArticle=false;
 const status=patch=>{Object.assign(state,patch,{updatedAt:new Date().toISOString()});const snapshot={...state};chain=chain.then(()=>writeCenterJson(join(home,'worker.json'),snapshot));return chain;};
 const lockReady=async()=>{if(!desktop)return;const owner=JSON.parse(await readFile(join(home,'daemon.lock'),'utf8'));if(owner.pid!==process.pid)throw Error('运行锁身份无效');const checkStop=()=>honorDesktopStop(home,controller);await checkStop();await status({...(owner.identity?{identity:owner.identity}:{}),state:controller.signal.aborted?'stopping':'idle',message:controller.signal.aborted?'当前需求完成后停止领取':'多站排程已启动'});timer=setInterval(checkStop,1000);timer.unref?.();};
 const event=entry=>{if(desktop){const next=desktopEventStatus(entry,activeArticle);activeArticle=next.activeArticle;status(next.patch).catch(()=>controller.abort());}else process.stdout.write(JSON.stringify(entry)+'\n');};
 try{const result=await runConfiguredMultisite({enabled:true,client,connection,home,plan,configs:config.sections,profiles,catalog,organizations,writerProof,imageRuntime,sourceStage:sourceRuntime?.sourceStage,overrides:sourceRuntime?{topic:{fetchPage:sourceRuntime.fetchPage}}:{},signal:controller.signal,onEvent:event,onLockAcquired:lockReady});if(desktop)await status({state:'stopped',message:'多站排程已停止，原任务和结果已保留'});return result;}
 catch(error){if(desktop&&timer)await status({state:'blocked',message:String(error.message).slice(0,1000)}).catch(()=>{});throw error;}
 finally{clearInterval(timer);await chain.catch(()=>{});process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
export async function desktopWorker(input){
 if(!input||typeof input.configPath!=='string'||typeof input.home!=='string')throw Error('Invalid desktop multisite request');
 const home=absolute(input.home,'center home');
 try{return await main(['--run',input.configPath],{forcedHome:home,desktop:true});}
 catch(error){
  // Never overwrite a different live worker's status on lock contention.
  try{await withFileLock(join(home,'daemon.lock'),()=>writeCenterJson(join(home,'worker.json'),{pid:process.pid,state:'blocked',mode:'multisite',agentId:'codex',message:String(error.message).slice(0,1000),updatedAt:new Date().toISOString()}),{timeout:100});}catch{}
  throw error;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const operation=async()=>{if(process.argv[2]!=='--worker')return main();let raw='';for await(const part of process.stdin){raw+=part;if(raw.length>65536)throw Error('Desktop request too large');}return desktopWorker(JSON.parse(raw));};
 operation().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(String(error.message)+'\n');process.exitCode=1;});
}
