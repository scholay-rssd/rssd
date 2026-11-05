// Isolated adapter: not wired to a worker, scheduler, or publication path.
// A provider must support recovery by requestId before any repeat attempt.
import {mkdir,readFile,writeFile,rename,open,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import protocol from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {stageMedia,uploadPacketMedia} from './rssd-device-media.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {validateImagePolicySnapshot} from './rssd-image-policy.mjs';
import {requireVisualReview} from './rssd-image-visual-review.mjs';

async function optional(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){const temp=file+'.'+randomUUID();try{await writeFile(temp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});await rename(temp,file);}finally{await rm(temp,{force:true});}}
function pending(message){return Object.assign(Error(message),{code:'image_pending'});}
function validText(value,name,max){if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw Error('Invalid '+name);return value.trim();}

/**
 * Prepare one image slot and return a content-addressed Center media reference.
 * The caller must bind the result to the correct notebook revision and only
 * submit after all required slots are ready. This adapter does not publish.
 */
export async function stageRequiredImage({jobId,slot,jobDirectory,home,client,workspaceId,siteId,provider,signal,resolveImagePolicy}){
 protocol.id(jobId,'jobId');protocol.id(workspaceId,'workspaceId');protocol.id(slot?.blockId,'blockId');
 const requirement=validText(slot.requirement,'image requirement',8000),alt=validText(slot.alt,'image alt',60),caption=validText(slot.caption,'image caption',1000);
 if([...alt].length<20)throw Error('Image alt must describe the scene in 20–60 characters');
 const origin=new URL(client?.origin).origin,parsedOrigin=new URL(origin);
 if(origin!==client.origin||!(parsedOrigin.protocol==='https:'||parsedOrigin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsedOrigin.hostname)))throw Error('Invalid Center origin');
 const directory=resolve(jobDirectory),stateDir=join(directory,'image-staging');await mkdir(stateDir,{recursive:true,mode:0o700});
 if(slot.referenceSha256!==undefined&&!/^[a-f0-9]{64}$/.test(slot.referenceSha256))throw Error('Invalid brand reference hash');
 // Derive the bounded image search phrase from the frozen slot requirement.
 // It is persisted in the original scope and therefore part of requestId.
 const imageSearchQuery=[...requirement.normalize('NFKC').replace(/[\x00-\x1f"\\]/g,' ').replace(/\s+/g,' ').trim()].slice(0,300).join('').trim();
 if(!imageSearchQuery)throw Error('Image search query is empty');
 const currentScope={origin,workspaceId,jobId,blockId:slot.blockId,requirement,imageSearchQuery,alt,caption,...(slot.referenceSha256?{referenceSha256:slot.referenceSha256}:{})};
 const w=slot.commonsSearchWindow;
 if(w!==undefined&&(!w||w.provider!=='wikimedia-commons'||!Number.isSafeInteger(w.maxPages)||w.maxPages<1||w.maxPages>5||!Number.isSafeInteger(w.pageSize)||w.pageSize<1||w.pageSize>20))throw Error('Invalid Commons search window');
 const stateFile=join(stateDir,protocol.hash([jobId,slot.blockId])+'.json');
 return withFileLock(stateFile+'.lock',async()=>{
  signal?.throwIfAborted();let state=await optional(stateFile);
  // Pre-query requests keep their exact original scope and request ID. They
  // may be looked up but cannot acquire a new search phrase retroactively.
  const {imageSearchQuery:_query,...legacyScope}=currentScope;
  let scope=state?.scope&&!Object.hasOwn(state.scope,'imageSearchQuery')?legacyScope:currentScope;
  // Existing requests retain their exact frozen scope and never acquire the
  // new search provider. Only newly created slots get a window in the hash.
  if(w&&(!state||Object.hasOwn(state.scope||{},'commonsSearchWindow')))scope={...scope,imageSearchQuery:[...imageSearchQuery].slice(0,200).join('').trim(),commonsSearchWindow:structuredClone(w)};
  if(state?.scope?.imagePolicy){
   const policy=validateImagePolicySnapshot(state.scope.imagePolicy,{siteId,workspaceId,referenceSha256:slot.referenceSha256});
   scope={...scope,imagePolicy:policy};
  }else if(!state){
   if(typeof resolveImagePolicy!=='function'||!siteId)throw pending('Site image policy is not configured');
   const policy=await resolveImagePolicy({directory,siteId,workspaceId,referenceSha256:slot.referenceSha256});
   scope={...scope,imagePolicy:validateImagePolicySnapshot(policy,{siteId,workspaceId,referenceSha256:slot.referenceSha256})};
  }
  const requestId='image-'+protocol.hash(scope).slice(0,48);
  if(state&&(state.requestId!==requestId||protocol.hash(state.scope)!==protocol.hash(scope)))throw Error('Image slot changed after its original request; retain it for review');
  if(state?.status==='staged'){
   const stem=protocol.hash([origin,workspaceId,state.id]),bytes=await readFile(join(home,'media',stem+'.image'));
   if(protocol.hash(media.imageManifest(bytes))!==protocol.hash(state.manifest))throw Error('Staged image bytes changed');
   await requireVisualReview({directory,jobId,slot,requestId,scope,bytes});
   return {...state.result,reused:true};
  }
  if(!provider||typeof provider.start!=='function'||typeof provider.lookup!=='function'||!provider.id)throw pending('No recoverable image provider is available; original task and slot remain pending');
  protocol.id(provider.id,'providerId');
  const fresh=!state;
  if(fresh){state={version:1,scope,requestId,providerId:provider.id,status:'pending'};await save(stateFile,state);}
  if(state.providerId!==provider.id)throw Error('Image request belongs to another provider');
  // After any uncertain call, only lookup the original ID; never issue a new
  // generation automatically. Providers must make start(requestId) idempotent.
  const response=await (fresh?provider.start({requestId,scope,signal}):provider.lookup({requestId,scope,signal}));
  if(response?.status!=='ready')throw pending('Image request is pending or needs attention; preserve the original request ID');
  if(!Buffer.isBuffer(response.bytes))throw pending('Image provider returned no actual file bytes');
  const manifest=media.imageManifest(response.bytes),info=await sharp(response.bytes,{failOn:'error',limitInputPixels:32000000}).metadata();
  if(!info.width||!info.height||(info.pages||1)!==1||!['png','jpeg','webp'].includes(info.format))throw Error('Image is not a valid static PNG, JPEG, or WebP');
  await sharp(response.bytes,{failOn:'error',limitInputPixels:32000000}).raw().toBuffer();
  // Only the original frozen site policy may supply a brand disclosure.
  const provenance=response.provenance?.kind==='generated'&&scope.imagePolicy?.disclosures?{...response.provenance,disclosures:structuredClone(scope.imagePolicy.disclosures)}:response.provenance;
  if(!provenance||!['generated','licensed-source','code'].includes(provenance.kind))throw Error('Image provenance is required');
  if(provenance.kind==='licensed-source'&&(!provenance.sourceUrl||!provenance.creator||!provenance.license||!provenance.licenseEvidence))throw Error('Licensed source requires attribution and license evidence');
  const registration=response.registration;
  if(!registration||registration.sha256!==manifest.sha256||!registration.assetId||!registration.taskId)throw Error('A matching registered gallery asset is required');
  protocol.id(registration.assetId,'assetId');protocol.id(registration.taskId,'taskId');
  await requireVisualReview({directory,jobId,slot,requestId,scope,bytes:response.bytes});
  const prepared=await stageMedia({directory:join(home,'media'),origin,workspaceId,bytes:response.bytes,name:alt});
  const result={requestId,blockId:slot.blockId,id:prepared.id,url:prepared.url,manifest,alt,caption,registration:structuredClone(registration),provenance:structuredClone(provenance),...(response.searchAudit?{searchAudit:structuredClone(response.searchAudit)}:{})};
  await save(stateFile,{...state,status:'staged',id:prepared.id,manifest,result});
  return {...result,reused:false};
 });
}

/** Stage every required slot before attempting any upload. Never submits work. */
export async function prepareAndUploadRequiredImages({slots,client,home,workspaceId,...options}){
 if(!Array.isArray(slots)||!slots.length||new Set(slots.map(x=>x.blockId)).size!==slots.length)throw pending('Required image slots are absent or ambiguous');
 const images=[];
 for(const slot of slots)images.push(await stageRequiredImage({...options,slot,client,home,workspaceId}));
 await uploadPacketMedia({packet:{workspaceId,editions:[{media:images.map(x=>({id:x.id,alt:x.alt}))}]},directory:join(home,'media'),client});
 return images.map(image=>({...image,uploaded:true}));
}
