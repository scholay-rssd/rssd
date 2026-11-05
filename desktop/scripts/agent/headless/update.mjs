#!/usr/bin/env node
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename,rm,readdir,readlink,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const exec=promisify(execFile),official='https://github.com/scholay-rssd/rssd.git',alternateOrigins=new Set(['https://github.com/scholay-rssd/rssd','git@github.com:scholay-rssd/rssd.git']);
export const installationRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
const exists=async path=>access(path).then(()=>true,()=>false);
async function command(file,args,cwd,timeout=30000){return (await exec(file,args,{cwd,timeout,maxBuffer:4*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();}
const git=(root,...args)=>command('git',args,root);
function stateRoot(root){return join(root,'.local/headless/update');}
async function settings(root){try{return JSON.parse(await readFile(join(stateRoot(root),'settings.json'),'utf8'));}catch{return {automatic:true};}}
async function save(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const next=path+'.'+randomUUID();await writeFile(next,JSON.stringify(value)+'\n',{mode:0o600});await rename(next,path);}
async function gate(root){
 const folder=join(stateRoot(root),'lock');await mkdir(dirname(folder),{recursive:true,mode:0o700});
 for(let attempt=0;attempt<2;attempt++){
  try{await mkdir(folder,{mode:0o700});await writeFile(join(folder,'owner.json'),JSON.stringify({pid:process.pid}),{mode:0o600});return ()=>rm(folder,{recursive:true,force:true});}
  catch(e){if(e.code!=='EEXIST')throw e;let owner;try{owner=JSON.parse(await readFile(join(folder,'owner.json'),'utf8'));}catch{throw Error('更新或任务正在启动，请稍后再试');}if(alive(owner.pid))throw Error('更新或任务正在启动，请稍后再试');await rm(folder,{recursive:true,force:true});}
 }
 throw Error('更新锁不可用');
}
export async function runtimeLease(root=installationRoot){
 const unlock=await gate(root);
 try{
  const path=join(stateRoot(root),'running',process.pid+'-'+randomUUID()+'.json');
  await save(path,{pid:process.pid,started:Date.now()});
  return ()=>rm(path,{force:true});
 }finally{await unlock();}
}
async function active(root){
 const folder=join(stateRoot(root),'running');let files=[];try{files=await readdir(folder);}catch{}
 for(const name of files){const path=join(folder,name);let lease;try{lease=JSON.parse(await readFile(path,'utf8'));}catch{return true;}if(alive(lease.pid))return true;await rm(path,{force:true});}
 // Also recognize producers started before this updater/lease mechanism existed.
 if(process.platform==='linux'){
  for(const pid of await readdir('/proc')){
   if(!/^\d+$/.test(pid)||Number(pid)===process.pid)continue;
   try{
    const cwd=await readlink('/proc/'+pid+'/cwd');if(cwd!==root&&!cwd.startsWith(root+'/'))continue;
    const line=(await readFile('/proc/'+pid+'/cmdline','utf8')).replaceAll('\0',' ');
    if(/(?:headless\/(?:produce\.mjs|queue\.sh|recover\.mjs)|agent\/bridge\.mjs)/.test(line))return true;
   }catch{}
  }
 }
 return false;
}
function trusted(value,origin){return value===origin||(origin===official&&alternateOrigins.has(value));}
async function unpack(root,ref,target){
 await mkdir(target,{recursive:true,mode:0o700});
 await new Promise((ok,fail)=>{
  const source=spawn('git',['archive',ref],{cwd:root,stdio:['ignore','pipe','ignore']}),tar=spawn('tar',['-xf','-','-C',target],{stdio:['pipe','ignore','ignore']});
  let a,b,done=false;const finish=()=>{if(done||a===undefined||b===undefined)return;done=true;a===0&&b===0?ok():fail(Error('无法准备更新候选版本'));};
  source.stdout.pipe(tar.stdin);source.on('error',fail);tar.on('error',fail);tar.stdin.on('error',()=>{});source.on('exit',c=>{a=c;finish();});tar.on('exit',c=>{b=c;finish();});
 });
}
async function prepareCandidate(root,ref,target){
 await unpack(root,ref,target);
 await command('npm',['ci','--omit=dev','--no-audit','--no-fund'],target,180000);
 await command('npm',['ci','--omit=dev','--no-audit','--no-fund','--prefix','desktop/runtime'],target,180000);
 await command('npm',['run','check'],target,60000);
 await command(process.execPath,['desktop/scripts/agent/headless/cli.mjs','--help'],target,15000);
}
export async function updateRuntime({root=installationRoot,apply=false,automatic=false,origin=official,prepare=prepareCandidate}={}){
 root=resolve(root);const config=await settings(root);
 if(automatic&&(!config.automatic||(config.checkedAt&&Date.now()-config.checkedAt<6*3600_000)))return {status:'skipped'};
 const unlock=await gate(root);let candidate,activated=false;const swapped=[];
 try{
  if(await active(root))return {status:'deferred',reason:'有运行中的队列或任务，保留当前版本'};
  if(!trusted(await git(root,'remote','get-url','origin'),origin))throw Error('更新源必须是 scholay-rssd/rssd 仓库；旧私有仓库的检出请从该仓库重新克隆');
  if(await git(root,'branch','--show-current')!=='main')return {status:'deferred',reason:'当前不在 main 分支'};
  if(await git(root,'status','--porcelain'))return {status:'deferred',reason:'工作目录有本地修改，未覆盖'};
  const before=await git(root,'rev-parse','HEAD');
  await git(root,'fetch','--no-tags','origin','main');const next=await git(root,'rev-parse','FETCH_HEAD');
  if(before===next){await save(join(stateRoot(root),'settings.json'),{...config,checkedAt:Date.now()});return {status:'current',commit:before};}
  try{await git(root,'merge-base','--is-ancestor',before,next);}catch{return {status:'deferred',reason:'本地历史与远端分叉，未自动合并'};}
  if(!apply)return {status:'available',current:before,commit:next};
  await save(join(stateRoot(root),'settings.json'),{...config,checkedAt:Date.now()});
  candidate=join(stateRoot(root),'staging',next+'-'+randomUUID());await prepare(root,next,candidate);
  if(await active(root)||await git(root,'rev-parse','HEAD')!==before||await git(root,'status','--porcelain'))throw Error('验证期间出现任务或本地修改，未切换版本');
  // Install already-verified dependencies under the same idle lock. A failure
  // before the fast-forward restores them; no reset/clean touches user files.
  for(const relative of ['node_modules','desktop/runtime/node_modules']){
   const staged=join(candidate,relative);if(!await exists(staged))continue;
   const target=join(root,relative),backup=join(stateRoot(root),'previous',randomUUID());await mkdir(dirname(backup),{recursive:true,mode:0o700});
   const previous=await exists(target);if(previous)await rename(target,backup);
   swapped.push({target,backup,previous});await rename(staged,target);
  }
  await git(root,'merge','--ff-only',next);
  activated=true;
  const result={status:'updated',previous:before,commit:next,at:new Date().toISOString()};
  await save(join(stateRoot(root),'last-update.json'),result);
  for(const s of swapped)if(s.previous)await rm(s.backup,{recursive:true,force:true});
  swapped.length=0;return result;
 }catch(error){
  if(!activated)for(const s of swapped.reverse()){await rm(s.target,{recursive:true,force:true});if(s.previous)await rename(s.backup,s.target);}
  if(activated)error.updated=true;
  throw error;
 }finally{if(candidate)await rm(candidate,{recursive:true,force:true});await unlock();}
}
export async function updateCommand(args){
 const action=args[0]||'check';
 if(['on','off','status'].includes(action)){
  const config=await settings(installationRoot);
  if(action!=='status'){config.automatic=action==='on';await save(join(stateRoot(installationRoot),'settings.json'),config);}
  return {automatic:config.automatic!==false,...(config.checkedAt?{lastCheckedAt:new Date(config.checkedAt).toISOString()}:{}),root:installationRoot};
 }
 if(!['check','apply'].includes(action))throw Error('Usage: headless update [check|apply|on|off|status]');
 return updateRuntime({apply:action==='apply'});
}
// Direct producer/recovery commands share the unified CLI's update boundary.
// No article task has started at this point; an old running queue is recognized
// by active() and therefore stays on its current version until the queue ends.
export async function headlessEntry(commandName,args,run){
 let updated=false;
 if(process.env.SCHOLAY_HEADLESS_SKIP_UPDATE!=='1'){
  try{updated=(await updateRuntime({apply:true,automatic:true})).status==='updated';}
  catch(error){console.error('自动更新暂不可用，保留现有版本：'+error.message);if(error.updated)throw error;}
 }
 const release=await runtimeLease();
 try{
  if(!updated)return await run();
  const child=spawn(process.execPath,[join(installationRoot,'desktop/scripts/agent/headless/cli.mjs'),commandName,...args],{stdio:'inherit',env:{...process.env,SCHOLAY_HEADLESS_SKIP_UPDATE:'1'}});
  const interrupt=()=>child.kill('SIGINT'),terminate=()=>child.kill('SIGTERM');process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  try{return await new Promise((ok,fail)=>{child.on('error',fail);child.on('exit',code=>ok(code??1));});}
  finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);}
 }finally{await release();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await updateCommand(process.argv.slice(2))));}catch(error){console.error('更新失败：'+error.message);process.exitCode=1;}
}
