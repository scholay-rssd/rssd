// A durable inspection request, not an automatic visual-quality decision.
// The image and its exact original request remain private until an independent
// reviewer records a decision for the exact bytes and scope.
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
const pending=message=>Object.assign(Error(message),{code:'image_pending'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function writeOnce(path,bytes){try{await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||!Buffer.from(await readFile(path)).equals(Buffer.from(bytes)))throw pending('Original image review evidence changed');}}

export async function requireVisualReview({directory,jobId,slot,requestId,scope,bytes}){
 if(!Buffer.isBuffer(bytes)||!bytes.length||scope?.jobId!==jobId||scope?.blockId!==slot?.blockId)throw pending('Image visual review identity is invalid');
 const root=join(directory,'image-visual-review');await mkdir(root,{recursive:true,mode:0o700});
 const request={version:1,jobId,blockId:slot.blockId,requestId,scopeHash:protocol.hash(scope),imageSha256:sha(bytes),imagePolicyHash:scope.imagePolicy?.snapshotHash??null,referenceSha256:scope.referenceSha256??null};
 const requestHash=protocol.hash(request),stem=protocol.hash([jobId,slot.blockId,requestId]);
 await writeOnce(join(root,stem+'.image'),bytes);await writeOnce(join(root,stem+'.request.json'),JSON.stringify({...request,requestHash})+'\n');
 const path=join(root,stem+'.receipt.json');let receipt;
 try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>50000)throw pending('Image visual review receipt is invalid');receipt=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')throw pending('Image awaits independent visual review');if(error.code==='image_pending')throw error;throw pending('Image visual review receipt cannot be read');}
 if(receipt?.version!==1||receipt.requestHash!==requestHash||receipt.imageSha256!==request.imageSha256||receipt.decision!=='approved'||receipt.method!=='visual-inspection'||typeof receipt.reviewer!=='string'||!receipt.reviewer.trim()||!Number.isFinite(Date.parse(receipt.reviewedAt))||typeof receipt.notes!=='string'||!receipt.notes.trim()||!receipt.checks||!['fullImageViewed','preview390Viewed','matchesArticle','factsAccurate','siteStyle','legible'].every(k=>receipt.checks[k]===true))throw pending('Image has no matching approved visual inspection');
 return {requestHash,imageSha256:request.imageSha256,reviewer:receipt.reviewer,reviewedAt:receipt.reviewedAt};
}

// Outbox recovery must verify the same review without re-running generation.
export async function verifyStoredVisualReview({directory,jobId,image}){
 if(!image?.blockId||!image?.requestId||!/^[a-f0-9]{64}$/.test(image?.manifest?.sha256||''))throw pending('Stored image review identity is missing');
 const stateFile=join(directory,'image-staging',protocol.hash([jobId,image.blockId])+'.json');let state,bytes;
 try{
  state=JSON.parse(await readFile(stateFile,'utf8'));
  const stem=protocol.hash([jobId,image.blockId,image.requestId]);bytes=await readFile(join(directory,'image-visual-review',stem+'.image'));
 }catch{throw pending('Original visual review candidate is unavailable');}
 const {uploaded,reused,...persisted}=image;
 if(uploaded!==true||state?.status!=='staged'||state?.requestId!==image.requestId||state?.scope?.jobId!==jobId||state?.scope?.blockId!==image.blockId||sha(bytes)!==image.manifest.sha256||state?.manifest?.sha256!==image.manifest.sha256||!state?.result||protocol.hash(state.result)!==protocol.hash(persisted))throw pending('Original visual review candidate does not match the image receipt');
 return requireVisualReview({directory,jobId,slot:{blockId:image.blockId},requestId:image.requestId,scope:state.scope,bytes});
}
