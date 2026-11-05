// Private, single-attempt registration of an independently reviewed original.
// This module does not search, assess rights, run an agent or publish anything.
import {mkdir, lstat, realpath, readFile, writeFile, rename, rm, open} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {constants} from 'node:fs';
import sharp from 'sharp';
import protocol from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {withFileLock} from './editorial-lock.mjs';
import {saveGallery} from '../desktop/scripts/agent/image-library.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const pending=reason=>({status:'pending',reason});
async function read(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){const {stateHash,...body}=value,temp=file+'.'+randomUUID();try{await writeFile(temp,JSON.stringify({...body,stateHash:protocol.hash(body)})+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}}
async function privateDir(path){await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid())throw Error('Unsafe private gallery directory');if(await realpath(path)!==resolve(path))throw Error('Gallery path must not contain symlinks');}
async function privateFile(path){try{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o077)!==0||s.uid!==process.getuid())throw Error('Unsafe private gallery file');}catch(e){if(e.code!=='ENOENT')throw e;}}
function verifiedState(s,requestId,scopeHash){if(!s)return;if(s.stateHash!==protocol.hash(Object.fromEntries(Object.entries(s).filter(([k])=>k!=='stateHash')))||s.version!==1||s.requestId!==requestId||s.scopeHash!==scopeHash)throw Error('Original gallery request differs or was altered');}

/** bridge is scoped to this private workspace and permits only identified image tasks.
 * Reconstruct this object after restart with the same workspace and bridge. */
export function createOriginalGalleryRegistrar({workspace,bridge}={}){
 if(typeof workspace!=='string'||!workspace||!bridge||typeof bridge.call!=='function'||typeof bridge.confirmImported!=='function')throw Error('Private gallery workspace and restricted bridge with import confirmation required');
 const root=resolve(workspace),stateDir=join(root,'.local/workbench/original-registrations'),gallery=join(root,'.local/workbench/gallery');
 async function operate({requestId,scope,bytes,manifest,evidence,signal},start){
  protocol.id(requestId,'requestId');if(!/^[a-zA-Z0-9-]{3,100}$/.test(requestId))throw Error('Gallery request identity is invalid');if(!scope||typeof scope!=='object'||Array.isArray(scope))throw Error('Original image scope required');
  signal?.throwIfAborted();await privateDir(root);for(const dir of [join(root,'.local'),join(root,'.local/workbench'),stateDir,gallery])await privateDir(dir);
  const file=join(stateDir,protocol.hash(requestId)+'.json'),scopeHash=protocol.hash(scope),marker='RSSD '+requestId;
  return withFileLock(file+'.lock',async()=>{
   await privateFile(file);await privateFile(join(gallery,'index.json'));let s=await read(file);verifiedState(s,requestId,scopeHash);
   if(s&&start&&(protocol.hash(media.imageManifest(bytes))!==protocol.hash(s.manifest)||protocol.hash(evidence)!==s.evidenceHash))throw Error('Original gallery bytes or evidence differ');
   if(!s){
    if(!start)return pending('original_request_not_found');
    const actual=media.imageManifest(bytes);if(protocol.hash(actual)!==protocol.hash(manifest)||!evidence||evidence.imageSha256!==actual.sha256||evidence.rightsVerified!==true||evidence.thirdPartyExcluded!==true||evidence.intendedUse!=='commercial-web')throw Error('Original image or rights evidence differs');
    const image=sharp(bytes,{failOn:'error',limitInputPixels:32000000});const info=await image.metadata();if(!info.width||!info.height||(info.pages||1)!==1||!['png','jpeg','webp'].includes(info.format))throw Error('Invalid image');await image.raw().toBuffer();
    s={version:1,requestId,scopeHash,manifest:actual,evidenceHash:protocol.hash(evidence),phase:'creating'};await save(file,s);
    let task;try{task=await bridge.call('task_create',{agentId:'cursor',mode:'image',title:marker});}catch{return pending('creation_unconfirmed');}
    if(!task?.id)return pending('creation_unconfirmed');protocol.id(task.id,'taskId');
    s={...s,taskId:task.id,phase:'registering'};await save(file,s);
    // The marker precedes registration: an exception or crash must only query.
    try{await saveGallery(root,{id:task.id,articleId:task.articleId,brief:''},bytes,'Licensed original','imported');}catch{return pending('registration_unconfirmed');}
   }
   if(!s.taskId){let tasks;try{tasks=await bridge.call('task_list');}catch{return pending('creation_unconfirmed');}const matches=Array.isArray(tasks)?tasks.filter(t=>t.title===marker&&t.mode==='image'&&t.agentId==='cursor'):[];if(matches.length>1)throw Error('Multiple original gallery tasks found');if(matches.length!==1)return pending('creation_unconfirmed');protocol.id(matches[0].id,'taskId');s={...s,taskId:matches[0].id,phase:'creation_unconfirmed'};await save(file,s);}
   let task;try{task=await bridge.call('task_get',{taskId:s.taskId});}catch{return pending('task_unavailable');}
   if(task?.id!==s.taskId||task.title!==marker||task.mode!=='image'||task.agentId!=='cursor')throw Error('Original gallery task identity differs');
   const values=await read(join(gallery,'index.json'));if(!Array.isArray(values))return pending('registration_unconfirmed');
   const found=values.filter(x=>x.taskId===s.taskId&&x.id===s.manifest.sha256.slice(0,24)&&x.storage==='gallery'&&x.origin==='imported');if(found.length!==1)return pending('registration_unconfirmed');
   const item=found[0],path=resolve(root,item.originalPath||'');if(!path.startsWith(gallery+sep)||item.path!==item.originalPath)return pending('registration_invalid');
   let handle,stored;try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size!==s.manifest.bytes||await realpath(path)!==path)return pending('registration_invalid');handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);stored=await handle.readFile();}catch{return pending('registration_invalid');}finally{await handle?.close();}
   if(sha(stored)!==s.manifest.sha256)return pending('registration_invalid');
   // The lifecycle independently rechecks the original task and file before
   // recording a terminal imported task; an unconfirmed import is not ready.
   try{await bridge.confirmImported({taskId:s.taskId,requestId,assetId:item.id,sha256:s.manifest.sha256});}catch{return pending('registration_unconfirmed');}
   if(s.phase!=='ready'){s={...s,phase:'ready',assetId:item.id};await save(file,s);}else if(s.assetId!==item.id)throw Error('Gallery registration changed');
   return {status:'ready',taskId:s.taskId,assetId:item.id,sha256:s.manifest.sha256};
  });
 }
 return {start:args=>operate(args,true),lookup:args=>operate(args,false)};
}
