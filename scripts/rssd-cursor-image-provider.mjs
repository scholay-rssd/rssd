// Isolated Cursor gallery adapter; never registers with a worker by itself.
import {mkdir,readFile,writeFile,rename,rm,realpath,lstat,open} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import fsConstants from 'node:fs';
import sharp from 'sharp';
import protocol from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {withFileLock} from './editorial-lock.mjs';
import {validateImagePolicySnapshot} from './rssd-image-policy.mjs';

async function optional(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){const temp=file+'.'+randomUUID();try{await writeFile(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}}
function pending(){return {status:'pending'};}

/** bridge is an isolated RSSD image-gallery bridge, not the article worker. */
export function createCursorGalleryProvider({bridge,workspace,stateDirectory,enabled=false,reference=null}){
 if(!bridge||typeof bridge.call!=='function'||!workspace||!stateDirectory)throw Error('Isolated gallery bridge and state directory are required');
 const root=resolve(workspace),states=resolve(stateDirectory),providerId='cursor-gallery-v1';
 async function inspect(state){
  if(!state.taskId)return pending();
  let task,status;try{task=await bridge.call('task_get',{taskId:state.taskId});status=await bridge.call('status',{taskId:state.taskId});}catch{return pending();}
  if(task.id!==state.taskId||task.mode!=='image'||task.agentId!=='cursor'||status.busy||status.pending?.length||task.runtime?.busy||task.runtime?.status!=='已完成')return pending();
  const history=status.history||[],tools=history.filter(x=>x.role==='tool').map(x=>x.tool||{});
  if(!tools.some(x=>x.title==='Generate Image'&&x.status==='completed')||!tools.some(x=>/asset_register/.test(x.title||'')&&x.status==='completed'))return pending();
  const assets=(task.assets||[]).filter(x=>x.storage==='gallery'&&x.origin==='generated');
  if(assets.length!==1||assets[0].taskId!==state.taskId)return pending();
  const asset=assets[0],gallery=await realpath(join(root,'.local/workbench/gallery'));
  const candidate=resolve(root,asset.path||'');let info;
  try{info=await lstat(candidate);}catch{return pending();}
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>media.MAX_BYTES)return pending();
  const actual=await realpath(candidate);if(!actual.startsWith(gallery+sep))return pending();
  const handle=await open(actual,fsConstants.constants.O_RDONLY|fsConstants.constants.O_NOFOLLOW);let bytes;
  try{bytes=await handle.readFile();}finally{await handle.close();}
  const digest=createHash('sha256').update(bytes).digest('hex');
  if(asset.id!==digest.slice(0,24))return pending();
  return {status:'ready',bytes,registration:{assetId:asset.id,taskId:state.taskId,sha256:digest},provenance:{kind:'generated',provider:'cursor-gallery'}};
 }
 async function operate(requestId,scope,start){
  protocol.id(requestId,'requestId');
  if(!enabled)return pending();
  await mkdir(states,{recursive:true,mode:0o700});const file=join(states,protocol.hash(requestId)+'.json');
  return withFileLock(file+'.lock',async()=>{
   let state=await optional(file);const scopeHash=protocol.hash(scope);
   if(state&&(state.requestId!==requestId||state.scopeHash!==scopeHash))throw Error('Image provider request scope differs');
   if(!state){
    if(!start)return pending();
    if(typeof scope?.requirement!=='string'||!scope.requirement.trim()||scope.requirement.length>3500)throw Error('Image requirement is invalid');
    let attachments=[];
    if(scope.referenceSha256){
     if(!reference||!Buffer.isBuffer(reference.bytes))return pending();
     const ref=media.imageManifest(reference.bytes),data=reference.bytes.toString('base64');
     if(ref.sha256!==scope.referenceSha256||data.length>1500000)return pending();
     const details=await sharp(reference.bytes,{failOn:'error',limitInputPixels:32000000}).metadata();
     if((details.pages||1)!==1||!details.width||!details.height)return pending();
     attachments=[{type:'image',name:'Approved brand reference',mimeType:ref.mime,data}];
    }
    let policyText='';
    if(scope.imagePolicy){
     const policy=validateImagePolicySnapshot(scope.imagePolicy,{siteId:scope.imagePolicy.siteId,workspaceId:scope.workspaceId,referenceSha256:scope.referenceSha256});
     policyText='\nFrozen image purpose: '+scope.alt+'\nFrozen explanatory caption: '+scope.caption+'\nSite image policy (follow the applicable instructions; do not publish):\n'+[...policy.skills,...policy.references].map(x=>'['+x.path+' SHA-256 '+x.sha256+']\n'+x.content).join('\n\n');
    }
    const marker='RSSD '+requestId;
    const text=marker+'\nGenerate exactly one image for this slot. '+scope.requirement+(attachments.length?' Use the attached approved image as the actual visual reference.':'')+policyText+'\nRegister the actual result with asset_register. Do not create or publish articles, call shell, access Center or retry generation.';
    state={version:1,requestId,scopeHash,phase:'creating',...(scope.imagePolicy?{prompt:text,imagePolicyHash:scope.imagePolicy.snapshotHash}:{})};await save(file,state);
    // A create timeout is ambiguous: lookup will inspect this marker, never
    // create another gallery task or send another prompt automatically.
    let task;try{task=await bridge.call('task_create',{agentId:'cursor',mode:'image',title:marker});}catch{return pending();}
    if(!task?.id)return pending();protocol.id(task.id,'taskId');
    state={...state,taskId:task.id,phase:'dispatching'};await save(file,state);
    try{const run=await bridge.call('gallery_prompt',{taskId:task.id,text,attachments});state={...state,phase:'sent',runId:run?.runId||null};await save(file,state);}catch{return pending();}
   }
   if(!state.taskId&&state.phase==='creating'){
    let tasks;try{tasks=await bridge.call('task_list');}catch{return pending();}
    const matches=tasks.filter(t=>t.mode==='image'&&t.agentId==='cursor'&&t.title==='RSSD '+requestId);
    if(matches.length>1)throw Error('More than one original gallery task matches; retain for review');
    if(matches.length===1){state={...state,taskId:matches[0].id,phase:'created-unconfirmed'};await save(file,state);}
   }
   return inspect(state);
  });
 }
 return {id:providerId,start:({requestId,scope})=>operate(requestId,scope,true),lookup:({requestId,scope})=>operate(requestId,scope,false)};
}
