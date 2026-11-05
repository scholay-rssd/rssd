// Derive scoped caption links only from the original registered, independently
// reviewed image request. No network access and no mutable task changes.
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {bindImagePlan} from './rssd-image-plan.mjs';
import {hasGeneratedDisclosure} from './rssd-image-disclosure.mjs';
import {orderedOriginalImages} from './rssd-image-translation-prompt.mjs';

const fail=()=>Object.assign(Error('Original image credit evidence is unavailable or changed'),{code:'image_pending'});
async function json(file){try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077))throw fail();return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw fail();}}
const equal=(a,b)=>protocol.canonical(a)===protocol.canonical(b);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const label=value=>String(value).replace(/[\\`*_{}\[\]<>]/g,'\\$&').replace(/[\r\n]/g,' ').trim();
// English text is model-authored, so require the exact attribution generated
// from the saved provenance. A translated caption cannot silently drop it.
export function validateReusedImageCredits({edition,images}){
 const blocks=edition?.metadata?.notebook?.blocks;if(!Array.isArray(blocks)||!Array.isArray(images))throw fail();
 const imageBlocks=blocks.filter(b=>b.type==='image'&&b.state==='ready');
 if(imageBlocks.length!==images.length)throw fail();
 for(const [index,image] of images.entries()){
  const block=imageBlocks[index],captions=blocks.filter(b=>b.type==='annotation'&&b.role==='caption'&&b.targetId===block?.id&&b.state==='ready');
  if(block?.text!==image.url)throw fail();
  if(!block||captions.length!==1||typeof captions[0].text!=='string')throw fail();
  const caption=captions[0].text,p=image.provenance;
  if(!p||!['generated','licensed-source','code'].includes(p.kind))throw fail();
  if(p?.kind==='generated'&&!hasGeneratedDisclosure(caption,p,'en'))throw fail();
  if(p?.kind==='licensed-source'){
   const suffix=' · Source: '+label(p.creator)+' ([source]('+p.sourceUrl+')); license: ['+label(p.license)+']('+p.licenseUrl+'); unchanged original image';
   if(!caption.endsWith(suffix)||/\b(?:cropped|adapted|edited|modified|altered)\b/i.test(caption.slice(0,-suffix.length)))throw fail();
  }
 }
}
export async function imageCreditContext({directory,claim,client,edition}){
 const receipt=await json(join(directory,'zh-CN.image-receipt.json'));
 const licensed=receipt?.images?.filter(image=>image.provenance?.kind==='licensed-source')||[];
 if(!licensed.length)return {};
 const plan=await json(join(directory,'zh-CN.image-plan.json'));
 if(!plan||receipt.version!==1||receipt.planHash!==protocol.hash(plan)||receipt.origin!==client.origin||receipt.workspaceId!==claim.workspaceId||plan.claimId!==claim.id||plan.generation!==claim.generation)throw fail();
 const bound=bindImagePlan({plan,images:receipt.images,origin:client.origin}),blocks=edition?.metadata?.notebook?.blocks;
 if(!Array.isArray(blocks))throw fail();
 const ordered=orderedOriginalImages({edition:{metadata:{notebook:bound.notebook}},images:receipt.images});
 if(edition.locale==='en')validateReusedImageCredits({edition,images:ordered});
 const imageBlocks=blocks.filter(b=>b.type==='image'&&b.state==='ready');
 if(imageBlocks.length!==ordered.length||ordered.some((image,index)=>imageBlocks[index]?.text!==image.url))throw fail();
 const contexts=[];
 for(const image of ordered.filter(image=>image.provenance?.kind==='licensed-source')){
  const staged=await json(join(directory,'image-staging',protocol.hash([claim.id,image.blockId])+'.json'));
  const saved=await json(join(directory,'cursor-gallery','original-first',protocol.hash(image.requestId),'state.json'));
  const {stateHash,...state}=saved||{};
  if(!staged||staged.status!=='staged'||staged.requestId!==image.requestId||staged.scope?.origin!==client.origin||staged.scope?.workspaceId!==claim.workspaceId||staged.scope?.jobId!==claim.id||staged.scope?.blockId!==image.blockId||'image-'+protocol.hash(staged.scope).slice(0,48)!==image.requestId||!equal(staged.manifest,image.manifest)||!equal(staged.result?.provenance,image.provenance)||!equal(staged.result?.registration,image.registration)||stateHash!==protocol.hash(state)||state.phase!=='ready'||state.requestId!==image.requestId||state.scopeHash!==protocol.hash(staged.scope)||!equal(state.manifest,image.manifest)||!equal(state.registration,image.registration))throw fail();
  const e=state.evidence,p=image.provenance,le=p.licenseEvidence;
  if(!e||e.rightsVerified!==true||e.thirdPartyExcluded!==true||e.intendedUse!=='commercial-web'||e.imageSha256!==image.manifest.sha256||e.sourceSha256!==le?.sha256||e.evidenceUrl!==le.url||e.sourceUrl!==p.sourceUrl||e.creator!==p.creator||e.license!==p.license||e.licenseUrl!==p.licenseUrl||e.quote!==le.quote||state.reviewedBy!==le.reviewedBy||state.reviewedAt!==le.reviewedAt||p.changes!=='unchanged')throw fail();
  const imageFile=join(directory,'cursor-gallery','original-first',protocol.hash(image.requestId),'source.image');
  const stat=await lstat(imageFile).catch(()=>{throw fail();});if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.size!==image.manifest.bytes||stat.size>20*1024*1024)throw fail();
  const bytes=await readFile(imageFile).catch(()=>{throw fail();});if(sha(bytes)!==image.manifest.sha256)throw fail();
  const imageBlock=imageBlocks[ordered.indexOf(image)],caption=blocks.find(b=>b.type==='annotation'&&b.role==='caption'&&b.targetId===imageBlock?.id&&b.state==='ready');
  if(!imageBlock||!caption)throw fail();
  if((edition.locale||'zh-CN')==='zh-CN'){
   const expected=bound.notebook.blocks.find(b=>b.type==='annotation'&&b.role==='caption'&&b.targetId===image.blockId);
   if(imageBlock.id!==image.blockId||!expected||caption.id!==expected.id||caption.text!==expected.text)throw fail();
  }
  const evidenceHash=protocol.hash({requestId:image.requestId,scopeHash:state.scopeHash,manifest:state.manifest,registration:state.registration,evidence:e,reviewedBy:state.reviewedBy,reviewedAt:state.reviewedAt});
  for(const url of [p.sourceUrl,p.licenseUrl])contexts.push({url,purpose:'image-credit',evidenceHash,blockId:caption.id});
 }
 const allowed=new Set(contexts.map(x=>protocol.hash(x)));
 return {authorizedContextLinks:contexts,verifyContextLink:item=>allowed.has(protocol.hash(item))};
}
