import {readFile,writeFile,mkdir,open,rename,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import p from '../contracts/rssd-v1.cjs';
import m from '../contracts/rssd-media.cjs';
import {markdownImageDetails} from './article-format.mjs';
import {fetchPublicBytes} from '../desktop/scripts/agent/notebook-images.mjs';
import {looksLikeCenterMediaPath,parseCenterMediaRef,registeredSourceMediaIds} from './rssd-center-media-ref.mjs';
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
export async function prepareEditionMedia({edition,home,directory,client,workspaceId,signal,fetchBytes=fetchPublicBytes,source}){
 const mappingFile=join(directory,'media-sources.json'),mapping=await json(mappingFile)||{};
 const media=new Map([...(source?.media||[]),...(edition.media||[])].map(item=>[item.id,{id:item.id,alt:item.alt||''}]));
 let bodyMarkdown=edition.bodyMarkdown;
 for(const image of markdownImageDetails(bodyMarkdown)){
  signal?.throwIfAborted();
  const internal=parseCenterMediaRef(image.src,{origin:client.origin});
  if(internal){
    const allowed=source?registeredSourceMediaIds(source):null;
    if(allowed&&!allowed.has(internal.id))throw Object.assign(Error('Image is not registered on the bound source edition'),{code:'media_ref_invalid'});
    const local=await json(join(home,'media',key(client.origin,workspaceId,internal.id)+'.json'));
    if(local&&(local.id!==internal.id||local.workspaceId!==workspaceId||local.origin!==client.origin))throw Object.assign(Error('Cached image belongs to a different center or workspace'),{code:'media_conflict'});
    const prior=media.get(internal.id);media.set(internal.id,{id:internal.id,alt:image.alt||prior?.alt||''});continue;
  }
  if(looksLikeCenterMediaPath(image.src))throw Object.assign(Error('Center media URL is not on the trusted origin or is an illegal path'),{code:'media_ref_invalid'});
  let asset=mapping[image.src];
  if(asset&&(asset.origin!==client.origin||asset.workspaceId!==workspaceId))throw Error('Cached image belongs to a different center or workspace');
  if(!asset){
   if(process.env.RSSD_ISOLATED_ACCEPTANCE==='1')throw Error('Isolated acceptance refuses public image fetch');
   const bytes=await fetchBytes(image.src,{maxBytes:m.MAX_BYTES});asset=await stageMedia({directory:join(home,'media'),origin:client.origin,workspaceId,bytes,name:image.alt||'article-image'});mapping[image.src]=asset;await save(mappingFile,mapping);
  }
  media.set(asset.id,{id:asset.id,alt:image.alt||''});bodyMarkdown=bodyMarkdown.replaceAll(image.src,asset.url);
 }
 const metadata=structuredClone(edition.metadata||{});
 if(metadata.notebook&&metadata.notebookBodyHash===p.hash(edition.bodyMarkdown)){
  metadata.notebook.blocks=metadata.notebook.blocks.map(block=>({...block,text:Object.entries(mapping).reduce((text,[url,asset])=>text.replaceAll(url,asset.url),block.text)}));
  metadata.notebookBodyHash=p.hash(bodyMarkdown);
 }
 if(metadata.platformContent){
  p.object(metadata.platformContent,'platform content');
  for(const content of Object.values(metadata.platformContent)){
   p.object(content,'platform content');const ids=new Set(p.array(content.mediaIds||[],'platform media',20).map(id=>p.id(id)));
   for(const url of p.array(content.mediaUrls||[],'platform media URLs',20)){
    signal?.throwIfAborted();p.text(url,'platform media URL',4096);
    const internal=parseCenterMediaRef(url,{origin:client.origin});
    if(internal){ids.add(internal.id);if(!media.has(internal.id))media.set(internal.id,{id:internal.id,alt:'Platform image'});continue;}
    if(looksLikeCenterMediaPath(url))throw Object.assign(Error('Center media URL is not on the trusted origin or is an illegal path'),{code:'media_ref_invalid'});
    p.publicUrl(url);let asset=mapping[url];
    if(asset&&(asset.origin!==client.origin||asset.workspaceId!==workspaceId))throw Error('Cached image belongs to a different center or workspace');
    if(!asset){const bytes=await fetchBytes(url,{maxBytes:m.MAX_BYTES});asset=await stageMedia({directory:join(home,'media'),origin:client.origin,workspaceId,bytes,name:'platform-image'});mapping[url]=asset;await save(mappingFile,mapping);}
    ids.add(asset.id);if(!media.has(asset.id))media.set(asset.id,{id:asset.id,alt:'Platform image'});
   }
   content.mediaIds=p.array([...ids],'platform media',20);delete content.mediaUrls;
  }
 }
 for(const id of p.referencedMediaIds(bodyMarkdown)){
  if(media.has(id))continue;
  throw Object.assign(Error('Article references media missing from its edition manifest'),{status:400,code:'missing_media'});
 }
 return {...edition,bodyMarkdown,metadata,media:[...media.values()]};
}
export function editionMediaComplete(edition){
 try{p.edition(edition);return true;}catch(error){if(error.code==='missing_media')return false;throw error;}
}
export async function completeStoredEdition({packet,home,directory,client,signal,source}){
 const edition=packet.editions[0];
 if(editionMediaComplete(edition))return packet;
 const repaired=await prepareEditionMedia({edition,home,directory,client,workspaceId:packet.workspaceId,signal,source});
 return p.submission({...packet,editions:[{...repaired,locale:edition.locale,translationOf:edition.translationOf}]});
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
