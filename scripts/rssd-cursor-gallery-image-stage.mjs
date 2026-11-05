// Scoped image stage; construction or import never starts a worker.
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {withCursorGalleryBridge} from './rssd-cursor-bridge-lifecycle.mjs';
import {createCursorGalleryProvider} from './rssd-cursor-image-provider.mjs';
import {createOriginalFirstProvider} from './rssd-original-first-provider.mjs';
import {prepareAndUploadRequiredImages} from './rssd-image-staging.mjs';
const pending=message=>Object.assign(Error(message),{code:'image_pending'});

/** The trusted rights reviewer and registrar are mandatory; no automatic fallback on search failure. */
export function createCursorGalleryImageStage({client,home,siteId,workspaceId,jobId,galleryRoot,bridgeOptions={},reference=null,resolveImagePolicy,originalSource,timeoutMs=180000,pollMs=2500}){
 if(!client||typeof client.origin!=='string'||!home||!workspaceId||!jobId||!Number.isInteger(timeoutMs)||timeoutMs<1||!Number.isInteger(pollMs)||pollMs<1)throw Error('Invalid private image stage configuration');
 return {origin:client.origin,async prepare({plan,directory,signal}){
  if(plan?.claimId!==jobId||!Array.isArray(plan.slots)||!directory)throw Error('Image plan is outside the original job');
  if(!originalSource||typeof originalSource.search!=='function'||typeof originalSource.review!=='function'||!(typeof originalSource.registrarFactory==='function'||originalSource.registrar&&['start','lookup'].every(k=>typeof originalSource.registrar[k]==='function')))throw pending('Independent licensed-source search, rights review and registration are not configured');
  if(!reference||!Buffer.isBuffer(reference.bytes)||!reference.bytes.length)throw pending('Approved image reference is not configured');
  const referenceSha256=createHash('sha256').update(reference.bytes).digest('hex');
  if(plan.slots.some(slot=>slot.referenceSha256&&slot.referenceSha256!==referenceSha256))throw pending('Approved image reference differs from the original slot');
  const jobDirectory=await realpath(directory),expected=join(jobDirectory,'cursor-gallery');
  const root=bridgeOptions.mode==='fixture'?resolve(galleryRoot||expected):expected;
  if(bridgeOptions.mode!=='fixture'&&galleryRoot&&resolve(galleryRoot)!==expected)throw pending('Gallery is outside the original job directory');
  await mkdir(root,{recursive:true,mode:0o700});
  return withCursorGalleryBridge({...bridgeOptions,root,jobDirectory,signal},async bridge=>{
   const provider=createCursorGalleryProvider({bridge,workspace:join(root,'workspace'),stateDirectory:join(root,'provider-state'),enabled:true,reference});
   async function awaitOriginal(action,input){
    const deadline=Date.now()+timeoutMs;let result=await provider[action](input);
    while(result?.status==='pending'&&Date.now()<deadline){signal?.throwIfAborted();await delay(Math.min(pollMs,Math.max(1,deadline-Date.now())),undefined,{signal});result=await provider.lookup(input);}
    return result;
   }
   const fallback={id:provider.id,start:input=>awaitOriginal('start',input),lookup:input=>awaitOriginal('lookup',input)};
   const registrar=originalSource.registrar||await originalSource.registrarFactory({galleryRoot:root,workspace:join(root,'workspace'),bridge});
   if(!registrar||!['start','lookup'].every(k=>typeof registrar[k]==='function'))throw pending('Licensed-image registrar is unavailable');
   const original=createOriginalFirstProvider({directory:join(root,'original-first'),search:originalSource.search,review:originalSource.review,registrar,fallback,...(originalSource.read?{read:originalSource.read}:{})});
   const slots=plan.slots.map(slot=>({...slot,referenceSha256,...(originalSource.commonsSearchWindow?{commonsSearchWindow:originalSource.commonsSearchWindow}:{})}));
   return prepareAndUploadRequiredImages({slots,jobId,jobDirectory,home,client,siteId,workspaceId,resolveImagePolicy,provider:original,signal});
  });
 }};
}

// Explicit host composition: the runtime, reference and independent rights
// dependencies must be supplied by the caller. Nothing is scheduled here.
export function createCursorGalleryImageStageFactory({client,home,expectedRuntime,resolveReference,resolveImagePolicy,originalSource,timeoutMs,pollMs}={}){
 if(!client||!home||!expectedRuntime||typeof resolveReference!=='function')throw Error('Pinned Cursor runtime and reference resolver are required');
 return async({siteId,workspaceId,sectionId,jobId})=>{
  const reference=await resolveReference({siteId,workspaceId,sectionId});
  return createCursorGalleryImageStage({client,home,siteId,workspaceId,jobId,bridgeOptions:{mode:'production',enabled:true,expectedRuntime,recover:true},reference,resolveImagePolicy,originalSource,...(timeoutMs?{timeoutMs}:{}),...(pollMs?{pollMs}:{})});
 };
}
