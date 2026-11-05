// Private Cursor gallery coordinator. Production requires pinned installed
// executable identities and the exact isolated macOS profile used by the probe.
import {spawn,execFile} from 'node:child_process';
import {mkdir,lstat,realpath,readFile,readdir,writeFile,open} from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {userInfo} from 'node:os';
import protocol from '../contracts/rssd-v1.cjs';
import {dirname,join,resolve} from 'node:path';
import {withFileLock,lockOwnerAlive} from './editorial-lock.mjs';
import {recoverQueuedTask} from '../desktop/scripts/agent/task-queue.mjs';
import {durableWriteJson} from './durable-json.mjs';
import {createBridgeClient} from '../desktop/scripts/agent/headless/bridge-client.mjs';

const stopped=()=>Object.assign(Error('Cursor gallery identity, isolation, or original task is not verified; image remains pending'),{code:'image_pending'});
const allowed=new Set(['task_create','task_list','task_get','status','gallery_prompt','cancel']);
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{3,100}$/.test(value);
async function privateRoot(input){
 const path=resolve(input);const info=await lstat(path),real=await realpath(path);
 if(!info.isDirectory()||info.isSymbolicLink()||real!==path||typeof process.getuid==='function'&&info.uid!==process.getuid()||(info.mode&0o077)!==0)throw Error('Gallery root must be an owned, private, real directory');
 return path;
}
async function read(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const save=durableWriteJson;

async function rejectExisting(paths){for(const path of paths){try{await lstat(path);throw stopped();}catch(error){if(error.code!=='ENOENT')throw error;}}}
async function requireRegularFileInside(path,root){const info=await lstat(path),actual=await realpath(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||!actual.startsWith(root+'/'))throw stopped();}

async function readPrivate(file,root){try{await requireRegularFileInside(file,root);return await read(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}


const cursorConfigKeys=new Set(['permissions','version','editor','display','notifications','hints','rewind','suggestNextPrompt','model','hasChangedDefaultModel','modelParameters','selectedModel','privacyCache','authInfo','network','approvalMode','sandbox','runEverythingSettingsPromptStreak','runEverythingSettingsPromptCooldownUntilMs','attribution']);
async function privateCursorConfig(config){
 const file=join(config,'cli-config.json');let info;
 try{info=await lstat(file);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(file,JSON.stringify({permissions:{allow:[],deny:[]},approvalMode:'allowlist'}),{flag:'wx',mode:0o600});return;}
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>1024*1024||(info.mode&0o022)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid()||await realpath(file)!==file)throw stopped();
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{
  const actual=await handle.stat();if(!actual.isFile()||actual.dev!==info.dev||actual.ino!==info.ino||actual.nlink!==1||actual.size!==info.size||typeof process.getuid==='function'&&actual.uid!==process.getuid())throw stopped();
  let value;try{value=JSON.parse(await handle.readFile('utf8'));}catch{throw stopped();}
  if(!value||Object.keys(value).some(k=>!cursorConfigKeys.has(k))||!Array.isArray(value.permissions?.allow)||value.permissions.allow.length||!Array.isArray(value.permissions?.deny)||value.approvalMode!==undefined&&value.approvalMode!=='allowlist')throw stopped();
  // Cursor can rewrite an otherwise safe file with 0644. The parent stays
  // private; restore 0600 only after verifying the exact opened file/content.
  if((actual.mode&0o777)!==0o600)await handle.chmod(0o600);
 }finally{await handle.close();}
}



const installedBridge='/Applications/RSSD.app/Contents/Resources/workbench/desktop/scripts/agent/bridge.mjs';
async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
// Operators can pin a reviewed installation. This records only file hashes and
// paths, never account data. Launch always rechecks every expected value.
export async function cursorGalleryRuntimeIdentity(){
 if(process.platform!=='darwin')throw stopped();
 const userHome=userInfo().homedir,launcher=await realpath(join(userHome,'.local/bin/cursor-agent'));
 const versions=join(userHome,'.local/share/cursor-agent/versions')+'/';
 if(!launcher.startsWith(versions)||!launcher.endsWith('/cursor-agent'))throw stopped();
 const runtime=launcher.slice(0,-'/cursor-agent'.length),node=await realpath(process.execPath);
 const paths={bridge:await realpath(installedBridge),node,launcher,cursorNode:await realpath(join(runtime,'node')),cursorEntry:await realpath(join(runtime,'index.js'))};
 const files=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([name,path])=>[name,{path,sha256:await digest(path)}])));
 return {version:1,files};
}
function sameIdentity(a,b){return protocol.hash(a)===protocol.hash(b);}

export function cursorGallerySandboxProfile({userHome,root}){
 if(typeof userHome!=='string'||typeof root!=='string'||/["\\\n\r]/.test(userHome+root))throw stopped();
 const parents=[];for(let parent=dirname(root);parent!=='/'&&parent!==dirname(parent);parent=dirname(parent))parents.push(`(allow file-read-metadata (literal "${parent}"))`);
 return '(version 1) (allow default) '+['.cursor','Documents','Desktop','Downloads','.ssh','.config','.codex'].map(p=>`(deny file-read* (subpath "${userHome}/${p}"))`).join(' ')+` (deny file-read* (subpath "${userHome}/Library/Application Support/com.thomas.papr")) (deny file-write* (subpath "${userHome}")) `+parents.join(' ')+` (allow file-read* (subpath "${root}")) (allow file-write* (subpath "${root}"))`;
}

async function recoveryIsReadOnly(root,state){
 const tasks=join(root,'workspace/.local/workbench/tasks');let names;
 try{names=await readdir(tasks);}catch(error){if(error.code==='ENOENT')return state.tasks.length===0;throw error;}
 const known=new Set(state.tasks.map(t=>t.taskId));
 if(state.tasks.some(t=>!validId(t.taskId))||names.some(id=>!validId(id)||!known.has(id)))return false;
 for(const item of state.tasks){
  const dir=join(tasks,item.taskId),info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())return false;
  const task=await readPrivate(join(dir,'task.json'),dir),admission=await readPrivate(join(dir,'queue-admission.json'),dir),session=await readPrivate(join(dir,'cursor/session.json'),dir);
  if(!task||task.id!==item.taskId||task.mode!=='image'||task.agentId!=='cursor')return false;
  if(task.runtime?.coordinatorPid&&await lockOwnerAlive({pid:task.runtime.coordinatorPid}))return false;
  if(recoverQueuedTask(task,session,admission)?.kind==='queued')return false;
 }
 return true;
}

// A legacy "starting" record has no saved child PID. Check the isolated
// environment inherited by the bridge and agent as well as gallery cwd/open
// files. A deliberately altered environment or detached service is outside
// what these process probes can prove; ambiguous probe results fail closed.
async function noGalleryProcesses(root,state){
 if(process.platform!=='darwin')return false;
 const markers=['CURSOR_CONFIG_DIR='+join(root,'config'),'CURSOR_DATA_DIR='+join(root,'workspace/.cursor-runtime'),...state.tasks.map(task=>'SCHOLAY_TASK_ID='+task.taskId)];
 const noMarkedProcesses=await new Promise(resolve=>execFile('/bin/ps',['eww','-A','-o','pid=,command='],{timeout:10000,maxBuffer:32*1024*1024,encoding:'utf8',env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LC_ALL:'C'}},(error,stdout,stderr)=>{
  resolve(!error&&!stderr.trim()&&!stdout.split('\n').some(line=>markers.some(marker=>line.includes(marker))));
 }));
 if(!noMarkedProcesses)return false;
 return new Promise(resolve=>execFile('/usr/sbin/lsof',['-n','-P','-Fpcn','+D',root],{timeout:10000,maxBuffer:1024*1024,encoding:'utf8',env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LC_ALL:'C'}},(error,stdout,stderr)=>{
  resolve(!!error&&error.code===1&&!stdout.trim()&&!stderr.trim());
 }));
}
async function allOriginalTasksSettled(root,state){
 if(state.ownerPid&&await lockOwnerAlive({pid:state.ownerPid}))return false;
 if(!state.tasks.every(t=>t.phase==='settled'&&validId(t.taskId)&&validId(t.runId)))return false;
 if(!await recoveryIsReadOnly(root,state))return false;
 const tasks=join(root,'workspace/.local/workbench/tasks');
 for(const item of state.tasks){
  const dir=join(tasks,item.taskId),task=await readPrivate(join(dir,'task.json'),dir),admission=await readPrivate(join(dir,'queue-admission.json'),dir),session=await readPrivate(join(dir,'cursor/session.json'),dir);
  const runtime=task?.runtime,recovered=recoverQueuedTask(task,session,admission);
  if(!runtime||runtime.runId!==item.runId||runtime.busy!==false||runtime.queued!==false||runtime.pendingPrompt||!['已完成','已停止'].includes(runtime.status)||!Number.isSafeInteger(runtime.coordinatorPid)||runtime.coordinatorPid<=0||await lockOwnerAlive({pid:runtime.coordinatorPid})||recovered?.kind!=='settled'||recovered.runId!==item.runId)return false;
 }
 return noGalleryProcesses(root,state);
}


// Read-only: no bridge is started and no incomplete task is replayed.
export async function inspectCursorGalleryOrphan(root){
 root=await privateRoot(root);const state=await readPrivate(join(root,'bridge-lifecycle.json'),root);
 if(!state)return null;
 if(state.version!==1||!Array.isArray(state.tasks))throw Error('Unrecognized gallery lifecycle record');
 return {phase:state.phase,tasks:state.tasks.map(({marker,taskId,runId,phase})=>({marker,taskId,runId,phase}))};
}

/**
 * `fixtureCommand` exists only for isolated synthetic tests. The actual Cursor
 * backend is intentionally not exposed as an executable production option.
 * An unclean or unfinished coordinator must be inspected without restarting it.
 */
export async function withCursorGalleryBridge({root,mode='production',enabled=false,fixtureCommand,expectedRuntime,jobDirectory,recover=false,signal,lockTimeout=150},use){
 if(enabled!==true||typeof use!=='function'||!['fixture','production'].includes(mode)||mode==='fixture'&&!fixtureCommand)throw stopped();
 if(mode==='production'&&(!expectedRuntime||!sameIdentity(await cursorGalleryRuntimeIdentity(),expectedRuntime)))throw stopped();
 if(signal?.aborted)throw stopped();
 root=await privateRoot(root);
 if(mode==='production'){if(!jobDirectory||join(await realpath(jobDirectory),'cursor-gallery')!==root||/["\\\n\r]/.test(root))throw stopped();}
 const file=join(root,'bridge-lifecycle.json');
 return withFileLock(join(root,'bridge-lifecycle.lock'),async()=>{
  const previous=await readPrivate(file,root);
  if(previous&&(previous.version!==1||!Array.isArray(previous.tasks)))throw stopped();
  const unfinished=previous&&(previous.phase!=='closed'||previous.tasks.some(t=>t.phase!=='settled'));
  let recovering=false;
  if(unfinished){
   if(!recover)throw stopped();
   if(previous.tasks.every(t=>t.phase==='settled')){if(!await allOriginalTasksSettled(root,previous))throw stopped();}
   else{if(!await recoveryIsReadOnly(root,previous))throw stopped();recovering=true;}
  }
  const state={version:1,phase:'starting',tasks:previous?.tasks||[],ownerPid:process.pid};
  const home=join(root,'home'),workspace=join(root,'workspace'),tmp=join(root,'tmp');
  for(const dir of [home,workspace,tmp]){await mkdir(dir,{recursive:true,mode:0o700});const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid())throw Error('Gallery isolation directory is unsafe');}
  if(mode==='production'){
   const index=join(workspace,'_ops/inventory/article-index.json');let value=await readPrivate(index,workspace);
   if(!value){if((await readdir(workspace)).length)throw stopped();await mkdir(join(workspace,'_ops/inventory'),{recursive:true,mode:0o700});await mkdir(join(workspace,'articles'),{mode:0o700});value={version:1,articles:{},annexColumns:[]};await writeFile(index,JSON.stringify(value),{mode:0o600,flag:'wx'});}
   await requireRegularFileInside(index,workspace);
   if(!value.articles||Object.keys(value.articles).length||!Array.isArray(value.annexColumns))throw stopped();
  }
  let command,args,env;
  if(mode==='fixture'){
   env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,TMPDIR:tmp,SCHOLAY_APP_DATA:home,SCHOLAY_GLOBAL_APP_DATA:home,SCHOLAY_EDITORIAL_ROOT:workspace,...(fixtureCommand.nodeOptions?{NODE_OPTIONS:fixtureCommand.nodeOptions}:{})};
   command=fixtureCommand.command;args=fixtureCommand.args||[];
  }else{
   const userHome=userInfo().homedir;if(/["\\\n\r]/.test(userHome))throw stopped();
   const config=join(root,'config'),data=join(workspace,'.cursor-runtime'),xdg=join(root,'xdg');
   await rejectExisting([join(config,'mcp.json'),join(workspace,'.cursor'),join(home,'agents.json')]);
   for(const dir of [config,data,xdg]){await mkdir(dir,{recursive:true,mode:0o700});const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid())throw stopped();}
   await privateCursorConfig(config);
   const profile=cursorGallerySandboxProfile({userHome,root});
   env={HOME:userHome,PATH:join(userHome,'.local/bin')+':/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:tmp,CURSOR_CONFIG_DIR:config,CURSOR_DATA_DIR:data,XDG_CONFIG_HOME:xdg,SCHOLAY_EDITORIAL_ROOT:workspace,SCHOLAY_APP_DATA:home,SCHOLAY_GLOBAL_APP_DATA:home};
   command='/usr/bin/sandbox-exec';args=['-p',profile,expectedRuntime.files.node.path,expectedRuntime.files.bridge.path];
  }
  // Initialization errors must not replace the original lifecycle journal.
  await save(file,state);
  const child=spawn(command,args,{cwd:workspace,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  let childExited=false;child.once('exit',()=>{childExited=true;});
  child.stderr.resume();const client=createBridgeClient(child,{callTimeout:fixtureCommand?.callTimeout||15000});
  let closing=false,chain=Promise.resolve();const terminalRuns=new Set();
  const call=async(method,params={})=>{
   if(closing||signal?.aborted)throw stopped();
   if(!allowed.has(method)||recovering&&!['task_list','task_get','status'].includes(method))throw Error('Gallery bridge method is not permitted');
   if(method==='task_create'){
    if(params.agentId!=='cursor'||params.mode!=='image'||typeof params.title!=='string'||!/^RSSD [a-zA-Z0-9-]{3,100}$/.test(params.title))throw Error('Only identified Cursor image tasks are permitted');
    if(state.tasks.some(t=>t.marker===params.title))throw Error('Original gallery request already exists');
    const task={marker:params.title,phase:'creating'};state.tasks.push(task);await save(file,state);
    const result=await client.call(method,params);if(!validId(result?.id))throw Error('Invalid gallery task identity');
    task.taskId=result.id;task.phase='created';await save(file,state);return result;
   }
   if(method==='task_list')return client.call(method,{});
   if(!validId(params.taskId))throw Error('Gallery task identity is required');
   const task=state.tasks.find(t=>t.taskId===params.taskId);if(!task)throw Error('Gallery task is outside the original request');
   if(method==='gallery_prompt'){
    if(task.phase!=='created'||typeof params.text!=='string'||!params.text.startsWith(task.marker+'\n'))throw Error('Original gallery prompt already dispatched or identity differs');
    task.phase='dispatching';await save(file,state);
    const result=await client.call(method,params);task.runId=result?.runId||null;task.phase='sent';await save(file,state);return result;
   }
   if(method==='cancel'){if(params.runId&&params.runId!==task.runId)throw Error('Cannot cancel a different run');task.phase='cancelling';await save(file,state);}
   const result=await client.call(method,params);
   if(method==='task_get')terminalRuns.delete(task.taskId);
   if(method==='status'&&(result?.busy||result?.pending?.length))terminalRuns.delete(task.taskId);
   if(method==='task_get'&&task.runId&&result?.id===task.taskId&&result?.runtime?.runId===task.runId&&!result.runtime.busy&&!result.runtime.queued&&['已完成','已停止'].includes(result.runtime.status))terminalRuns.add(task.taskId);
   if(method==='status'&&!result?.busy&&!result?.pending?.length&&(['已完成','已停止'].includes(result?.status)||terminalRuns.has(task.taskId))){task.phase='settled';await save(file,state);}
   return result;
  };
  async function confirmImported({taskId,requestId,assetId,sha256}={}){
   if(closing||signal?.aborted||!validId(taskId)||!validId(requestId)||!/^[a-f0-9]{64}$/.test(sha256||'')||assetId!==sha256.slice(0,24))throw stopped();
   const task=state.tasks.find(t=>t.taskId===taskId);if(!task||task.marker!=='RSSD '+requestId||!['created','settled'].includes(task.phase)||task.runId)throw stopped();
   const gallery=join(workspace,'.local/workbench/gallery'),index=await readPrivate(join(gallery,'index.json'),gallery);
   if(!Array.isArray(index))throw stopped();const matches=index.filter(x=>x.taskId===taskId&&x.id===assetId&&x.storage==='gallery'&&x.origin==='imported');
   if(matches.length!==1||matches[0].path!==matches[0].originalPath)throw stopped();
   const path=resolve(workspace,matches[0].path);if(!path.startsWith(gallery+'/'))throw stopped();await requireRegularFileInside(path,gallery);
   const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;try{const info=await handle.stat();if(!info.isFile()||info.nlink!==1||info.size>12*1024*1024)throw stopped();bytes=await handle.readFile();}finally{await handle.close();}
   if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw stopped();
   task.phase='settled';await save(file,state);return {ok:true};
  }
  const bridge={call(method,params){const result=chain.then(()=>call(method,params));chain=result.catch(()=>{});return result;},confirmImported(params){const result=chain.then(()=>confirmImported(params));chain=result.catch(()=>{});return result;}};
  let abort;const aborted=new Promise((_,reject)=>{abort=()=>reject(stopped());signal?.addEventListener('abort',abort,{once:true});});
  try{state.phase='running';await save(file,state);return await (signal?Promise.race([use(bridge),aborted]):use(bridge));}
  finally{
   closing=true;signal?.removeEventListener('abort',abort);await chain;
   // The child may have accepted work just before interruption. Closing the
   // channel is not evidence that its agent stopped; preserve the journal.
   await client.close();
   if(!childExited)await new Promise(resolve=>{const timer=setTimeout(resolve,2000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
   state.phase=childExited&&state.tasks.every(t=>t.phase==='settled')?'closed':'orphaned';await save(file,state);
  }
 },{timeout:lockTimeout});
}
