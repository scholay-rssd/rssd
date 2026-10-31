import {mkdir,readFile,writeFile,rename,readdir,lstat,copyFile,chmod,rm} from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {withFileLock,lockOwnerAlive} from '../../../../scripts/editorial-lock.mjs';

export const runtimeHome=()=>resolve(process.env.RSSD_RUNTIME_HOME||join(homedir(),'.local/share/rssd/headless'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function atomic(path,text,mode=0o600){await mkdir(dirname(path),{recursive:true,mode:0o700});const temporary=path+'.'+randomUUID();await writeFile(temporary,text,{mode});await rename(temporary,path);}
async function active(base){
  const directory=join(base,'active');let files=[];try{files=await readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const name of files){const path=join(directory,name);let owner;try{owner=JSON.parse(await readFile(path,'utf8'));}catch{throw Error('Unreadable runtime lease; inspect the installation before updating');}
    if(await lockOwnerAlive(owner))return true;await rm(path,{force:true});}
  return false;
}
export async function withRuntimeLease(work,{base=runtimeHome()}={}){
  const lease=join(base,'active',process.pid+'-'+randomUUID()+'.json');
  await withFileLock(join(base,'install.lock'),()=>atomic(lease,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})));
  try{return await work();}finally{await rm(lease,{force:true});}
}
function safeFile(root,name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes('\0')||isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid artifact path');
  const path=resolve(root,name),rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Artifact escaped its directory');return path;
}
async function ordinaryFile(root,name){
  let current=root;
  for(const part of name.split('/')){current=join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('Artifact symlinks are not accepted');}
  const file=safeFile(root,name);if(!(await lstat(file)).isFile())throw Error('Artifact entry is not a file');return file;
}
export async function verifyRuntime(source,{expectedManifestHash}={}){
  source=resolve(source);
  const bytes=await readFile(await ordinaryFile(source,'runtime-manifest.json')),hash=digest(bytes),manifest=JSON.parse(bytes);
  if(expectedManifestHash&&hash!==expectedManifestHash)throw Error('Runtime manifest checksum does not match');
  if(manifest.protocol!==1||manifest.platform!==process.platform||manifest.arch!==process.arch||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version))throw Error('Incompatible runtime artifact');
  if(!manifest.files||Array.isArray(manifest.files)||!Object.keys(manifest.files).length)throw Error('Empty runtime manifest');
  for(const [name,entry] of Object.entries(manifest.files)){
    safeFile(source,name);
    if(!/^[a-f0-9]{64}$/.test(entry?.sha256)||typeof entry.executable!=='boolean'||name==='runtime-manifest.json')throw Error('Invalid runtime file record');
    if(digest(await readFile(await ordinaryFile(source,name)))!==entry.sha256)throw Error('Runtime file checksum mismatch: '+name);
  }
  for(const name of [process.platform==='win32'?'node.exe':'node','desktop/scripts/agent/headless/standalone.mjs'])if(!manifest.files[name])throw Error('Missing runtime entrypoint');
  return {source,manifest,hash,bytes};
}
export async function installRuntime(source,{base=runtimeHome(),expectedManifestHash}={}){
  // Verify before taking the installation gate; verify copied bytes again below.
  const checked=await verifyRuntime(source,{expectedManifestHash});
  return withFileLock(join(base,'install.lock'),async()=>{
    if(await active(base))throw Error('A production command is still running; finish or stop it before updating');
    const id=checked.manifest.version+'-'+checked.hash.slice(0,16),release=join(base,'releases',id);
    let exists=false;try{await lstat(release);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(exists)await verifyRuntime(release,{expectedManifestHash:checked.hash});
    else{
      const stage=join(base,'releases','.staging-'+randomUUID());await mkdir(stage,{recursive:true,mode:0o700});
      try{
        for(const [name,entry] of Object.entries(checked.manifest.files)){
          const destination=safeFile(stage,name);await mkdir(dirname(destination),{recursive:true,mode:0o700});
          await copyFile(await ordinaryFile(checked.source,name),destination);await chmod(destination,entry.executable?0o700:0o600);
        }
        await writeFile(join(stage,'runtime-manifest.json'),checked.bytes,{mode:0o600});
        await verifyRuntime(stage,{expectedManifestHash:checked.hash});await rename(stage,release);
      }catch(error){await rm(stage,{recursive:true,force:true});throw error;}
    }
    let previous=null;try{previous=(await readFile(join(base,'current'),'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;}
    // The launcher resolves one immutable release before starting the process.
    const launcher='#!/bin/sh\nset -eu\nbase=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nrelease=$(cat "$base/current")\ncase "$release" in *[!a-zA-Z0-9._-]*|\'\') exit 1;; esac\nexec "$base/releases/$release/node" "$base/releases/$release/desktop/scripts/agent/headless/standalone.mjs" "$@"\n';
    await atomic(join(base,'rssd'),launcher,0o700);
    if(previous)await atomic(join(base,'previous'),previous+'\n');
    await atomic(join(base,'current'),id+'\n');
    return {status:previous===id?'unchanged':'installed',version:checked.manifest.version,manifestSha256:checked.hash,release,previous,command:join(base,'rssd')};
  });
}
