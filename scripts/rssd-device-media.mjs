import {readFile,writeFile,mkdir,open,rename,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import p from '../contracts/rssd-v1.cjs';
import m from '../contracts/rssd-media.cjs';
import {markdownImageDetails} from './article-format.mjs';
import {fetchPublicBytes} from '../desktop/scripts/agent/notebook-images.mjs';
const key=(origin,workspaceId,id)=>p.hash([origin,workspaceId,id]);
async function json(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function save(file,value){await mkdir(dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID();await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);}
export async function stageMedia({directory,origin,workspaceId,bytes,name='image'}){
 const manifest=m.imageManifest(bytes),id=m.mediaId(workspaceId,manifest.sha256),stem=key(origin,workspaceId,id);await mkdir(directory,{recursive:true,mode:0o700});
 const file=join(directory,stem+'.image'),temporary=file+'.'+randomUUID(),handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 try{await rename(temporary,file);}finally{await rm(temporary,{force:true});}
 const record={version:1,id,origin,workspaceId,name:String(name).slice(0,300),manifest};await save(join(directory,stem+'.json'),record);
 return {...record,url:origin+'/api/rssd/v1/media/'+id+'/raw'};
}
export async function prepareEditionMedia({edition,home,directory,client,workspaceId,signal,fetchBytes=fetchPublicBytes}){
 const mappingFile=join(directory,'media-sources.json'),mapping=await json(mappingFile)||{},media=new Map((edition.media||[]).map(item=>[item.id,item]));let bodyMarkdown=edition.bodyMarkdown;
 for(const image of markdownImageDetails(bodyMarkdown)){
  signal?.throwIfAborted();const internal=image.src.match(/^(?:https?:\/\/[^/]+)?\/api\/rssd\/v1\/media\/([a-zA-Z0-9._:-]+)\/raw$/);
  if(internal){media.set(internal[1],{id:internal[1],alt:image.alt||''});continue;}
  let asset=mapping[image.src];
  if(asset&&(asset.origin!==client.origin||asset.workspaceId!==workspaceId))throw Error('Cached image belongs to a different center or workspace');
  if(!asset){const bytes=await fetchBytes(image.src,{maxBytes:m.MAX_BYTES});asset=await stageMedia({directory:join(home,'media'),origin:client.origin,workspaceId,bytes,name:image.alt||'article-image'});mapping[image.src]=asset;await save(mappingFile,mapping);}
  media.set(asset.id,{id:asset.id,alt:image.alt||''});bodyMarkdown=bodyMarkdown.replaceAll(image.src,asset.url);
 }
 return {...edition,bodyMarkdown,media:[...media.values()]};
}
export async function uploadPacketMedia({packet,directory,client}){
 for(const id of new Set(packet.editions.flatMap(e=>e.media.map(m=>m.id)))){
  let remote;try{remote=await client.request('/media/'+encodeURIComponent(id));}
  catch(error){
   if(error.status!==404)throw error;
   const stem=key(client.origin,packet.workspaceId,id),local=await json(join(directory,stem+'.json'));
   if(!local||local.id!==id||local.origin!==client.origin||local.workspaceId!==packet.workspaceId)throw Object.assign(Error('Required image is missing from this device and center'),{status:409,code:'missing_media'});
   const bytes=await readFile(join(directory,stem+'.image'));
   if(p.hash(m.imageManifest(bytes))!==p.hash(local.manifest)||m.mediaId(packet.workspaceId,local.manifest.sha256)!==id)throw Object.assign(Error('Local image checksum mismatch'),{status:409,code:'media_conflict'});
   remote=await client.request('/media',{method:'POST',body:{workspaceId:packet.workspaceId,name:local.name,...local.manifest,data:bytes.toString('base64')}});
   if(p.hash(remote.manifest)!==p.hash(local.manifest))throw Object.assign(Error('Center image receipt mismatch'),{status:409,code:'media_conflict'});
  }
  if(remote.id!==id||remote.workspaceId!==packet.workspaceId)throw Object.assign(Error('Center image identity mismatch'),{status:409,code:'media_conflict'});
 }
}
