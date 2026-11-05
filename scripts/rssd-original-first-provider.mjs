// A source-image-first provider for a single frozen article slot. Search
// results are leads only: no candidate can become an image without a separate
// explicit rights review tied to the bytes of the actual source page.
// This module is not registered as a worker or a publishing route.
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import protocol from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {fetchPublicBytes,searchNotebookImages} from '../desktop/scripts/agent/notebook-images.mjs';
import {withFileLock} from './editorial-lock.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const known=new Map([
 ['https://creativecommons.org/licenses/by/4.0/','CC BY 4.0'],
 ['https://creativecommons.org/publicdomain/zero/1.0/','CC0 1.0'],
]);
const text=(x,max=4000)=>typeof x==='string'&&x.trim()&&x.length<=max&&!x.includes('\0');
function https(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&u.href===value;}catch{return false;}}
async function readJson(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function atomic(file,bytes){const temp=file+'.'+randomUUID();try{await writeFile(temp,bytes,{flag:'wx',mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}}
const save=(file,value)=>atomic(file,JSON.stringify(value)+'\n');
const saveState=(file,value)=>{const {stateHash,...body}=value;return save(file,{...body,stateHash:protocol.hash(body)});};
const pending=reason=>({status:'pending',reason});

/**
 * The rights verifier is a separate, trusted evidence source, which may be
 * automated or human-operated. It must return a frozen verification of this
 * exact scope and candidate set, not uncorroborated Openverse metadata. The
 * explicit original source and image bytes are
 * fetched again and checked before registration. A caller cannot manufacture
 * fallback merely from an empty, failed, or partial search.
 *
 * registrar and fallback must expose start/lookup with the original requestId;
 * after any uncertain side effect we call only lookup, never start twice.
 */
export function createOriginalFirstProvider({directory,search,review,registrar,fallback,read=fetchPublicBytes}={}){
 if(typeof directory!=='string'||!directory||typeof search!=='function'||typeof review!=='function'||!registrar||!['start','lookup'].every(k=>typeof registrar[k]==='function')||!fallback||!['start','lookup'].every(k=>typeof fallback[k]==='function')||typeof read!=='function')throw Error('Explicit image search, independent rights review and recoverable providers are required');
 const root=resolve(directory);
 async function run({requestId,scope,signal},initial){
  protocol.id(requestId,'requestId');if(!scope||typeof scope!=='object')throw Error('Image scope required');
  const scopeHash=protocol.hash(scope),stem=protocol.hash(requestId),dir=join(root,stem);await mkdir(dir,{recursive:true,mode:0o700});const stateFile=join(dir,'state.json'),imageFile=join(dir,'source.image');
  return withFileLock(stateFile+'.lock',async()=>{
   signal?.throwIfAborted();let state=await readJson(stateFile);
   if(state){const {stateHash,...body}=state;if(stateHash!==protocol.hash(body))throw Error('Original image state integrity check failed');}
   if(state&&(state.version!==1||state.requestId!==requestId||state.scopeHash!==scopeHash))throw Error('Image request scope differs from original');
   if(!state){if(!initial)return pending('original_request_not_found');state={version:1,requestId,scopeHash,phase:'selection'};await saveState(stateFile,state);}
   if(state.phase==='selection'){
    let found;try{found=await search({scope,signal});}catch{return pending('source_search_unavailable');}
    if(typeof found?.complete!=='boolean'||!Array.isArray(found.candidates)||found.candidates.length>100)return pending('source_search_incomplete');
    const candidates=found.candidates.map(x=>({id:x?.id,url:x?.url,sourceUrl:x?.sourceUrl}));
    if(candidates.some(x=>!text(x.id,300)||!https(x.url)||!https(x.sourceUrl))||new Set(candidates.map(x=>x.id)).size!==candidates.length)return pending('source_candidates_invalid');
    const searchHash=protocol.hash(candidates);let verdict;try{verdict=await review({requestId,scope,scopeHash,candidates:structuredClone(candidates),searchHash,signal});}catch{return pending('rights_review_unavailable');}
    if(!verdict||verdict.scopeHash!==scopeHash||verdict.searchHash!==searchHash||!text(verdict.reviewedBy,200)||!Number.isFinite(Date.parse(verdict.reviewedAt)))return pending('independent_rights_review_required');
    if(found.coverage!==undefined&&(!found.coverage||typeof found.coverage!=='object'||Array.isArray(found.coverage)||JSON.stringify(found.coverage).length>50000))return pending('source_coverage_invalid');
    const searchAudit={coverage:found.coverage??null,scopeHash,searchHash};
    if(verdict.status==='none'){
     if(!found.complete||!text(verdict.reason,2000)||!Array.isArray(verdict.reviewedCandidateIds)||protocol.canonical([...verdict.reviewedCandidateIds].sort())!==protocol.canonical(candidates.map(x=>x.id).sort()))return pending('source_review_incomplete');
     searchAudit.decision='no_verified_candidate_in_scope';searchAudit.reason=verdict.reason;searchAudit.outcomes=verdict.outcomes??[];
     state={...state,phase:'fallback_pending',review:verdict,searchAudit};await saveState(stateFile,state);
     // This marker is saved before the single external generation attempt.
     return audited(await fallback.start({requestId,scope,signal}),searchAudit);
    }
    if(verdict.status!=='approved')return pending('independent_rights_review_required');
    const item=candidates.find(x=>x.id===verdict.candidateId),e=verdict.evidence;
    if(!item||!e||e.rightsVerified!==true||e.thirdPartyExcluded!==true||e.intendedUse!=='commercial-web'||e.sourceUrl!==item.sourceUrl||e.imageUrl!==item.url||e.evidenceUrl!==item.sourceUrl||!https(e.sourceUrl)||!https(e.imageUrl)||!known.has(e.licenseUrl)||e.license!==known.get(e.licenseUrl)||!text(e.creator,300)||!text(e.quote,2000)||!/^[a-f0-9]{64}$/.test(e.sourceSha256||'')||!/^[a-f0-9]{64}$/.test(e.imageSha256||''))return pending('rights_evidence_incomplete');
    let source,bytes;try{source=await read(e.sourceUrl,{maxBytes:2*1024*1024,accept:'text/html'});bytes=await read(e.imageUrl,{maxBytes:12*1024*1024,accept:'image/*'});}catch{return pending('verified_source_unavailable');}
    if(!Buffer.isBuffer(source)||!Buffer.isBuffer(bytes)||sha(source)!==e.sourceSha256||sha(bytes)!==e.imageSha256)return pending('verified_source_changed');
    const html=source.toString('utf8');if(!Buffer.from(html).equals(source)||!html.includes(e.quote)||!html.includes(e.creator)||!html.includes(e.imageUrl)||!html.includes(e.licenseUrl))return pending('rights_evidence_not_found');
    const manifest=media.imageManifest(bytes);try{const img=sharp(bytes,{failOn:'error',limitInputPixels:32000000});const info=await img.metadata();if(!info.width||!info.height||(info.pages||1)!==1||!['png','jpeg','webp'].includes(info.format))throw Error('invalid');await img.raw().toBuffer();}catch{return pending('source_image_invalid');}
    searchAudit.decision='verified_original';searchAudit.outcomes=verdict.outcomes??[];
    await atomic(imageFile,bytes);state={...state,phase:'registration_pending',evidence:e,reviewedBy:verdict.reviewedBy,reviewedAt:verdict.reviewedAt,manifest,searchAudit};await saveState(stateFile,state);
    const registration=await registrar.start({requestId,scope,bytes,manifest,evidence:e,signal});return finish(state,registration,bytes);
   }
   if(state.phase==='fallback_pending')return audited(await fallback.lookup({requestId,scope,signal}),state.searchAudit);
   if(state.phase==='registration_pending'||state.phase==='ready'){
    const bytes=await readFile(imageFile);if(sha(bytes)!==state.manifest?.sha256)throw Error('Original image bytes changed');
    const registration=state.phase==='ready'?{status:'ready',...state.registration}:await registrar.lookup({requestId,scope,signal});return finish(state,registration,bytes);
   }
   throw Error('Unknown original-image state');
   async function finish(saved,registration,bytes){
    if(registration?.status!=='ready')return pending('original_registration_pending');
    if(!registration.assetId||!registration.taskId||registration.sha256!==saved.manifest.sha256)throw Error('Original registration identity mismatch');
    protocol.id(registration.assetId,'assetId');protocol.id(registration.taskId,'taskId');
    const r={assetId:registration.assetId,taskId:registration.taskId,sha256:registration.sha256};
    if(saved.phase!=='ready')await saveState(stateFile,{...saved,phase:'ready',registration:r});
    return audited({status:'ready',bytes,registration:r,provenance:{kind:'licensed-source',sourceUrl:saved.evidence.sourceUrl,creator:saved.evidence.creator,license:saved.evidence.license,licenseUrl:saved.evidence.licenseUrl,changes:'unchanged',licenseEvidence:{url:saved.evidence.evidenceUrl,sha256:saved.evidence.sourceSha256,quote:saved.evidence.quote,reviewedBy:saved.reviewedBy,reviewedAt:saved.reviewedAt}}},saved.searchAudit);
   }
  });
 }
 return {id:'original-first-v1',start:args=>run(args,true),lookup:args=>run(args,false)};
}

function audited(result,searchAudit){return searchAudit&&result&&typeof result==='object'?{...result,searchAudit:structuredClone(searchAudit)}:result;}

// Search is deliberately anonymous and only returns leads. Rights verification
// remains a separate explicit review; this helper does not approve anything.
export async function searchOriginalImageLeads({query,signal,read=fetchPublicBytes}){
 const candidates=[],ids=new Set(),pages=[];let complete=false,lastHasMore=null;
 for(let page=1;page<=5;page++){
  signal?.throwIfAborted();const result=await searchNotebookImages(null,{query,mode:'online',page},{read});signal?.throwIfAborted();
  for(const x of result.items){if(ids.has(String(x.id)))throw Error('Image search results changed during pagination');ids.add(String(x.id));candidates.push({id:String(x.id),url:x.url,sourceUrl:x.sourceUrl});}
  lastHasMore=result.hasMore;pages.push({page,candidateCount:result.items.length,reportedHasMore:result.hasMore});
  if(!result.hasMore){complete=true;break;}
 }
 // The legacy helper exposes only its hasMore interpretation, not the API's
 // raw page_count or continuation. Preserve exactly what was observed and do
 // not claim that the broader source or the web has been exhausted.
 return {complete,candidates,coverage:{provider:'openverse',query,maxPages:5,pageSize:20,pages,stop:complete?'helper_reported_no_more':'window_limit',reportedHasMore:lastHasMore,continuation:lastHasMore?{page:pages.length+1}:null,exhausted:'unknown',meaning:'configured_window_only'}};
}
