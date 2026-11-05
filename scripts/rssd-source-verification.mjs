// Private, recoverable source-verification evidence. This is an unregistered
// prototype: callers must supply a trusted source list and a separately
// configured verifier; neither Center nor a model selects filesystem paths.
import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {centerOrigin,writeCenterJson} from './rssd-center-client.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {fetchPublicText,publicHttpsUrl} from './rssd-topic-public.mjs';
import {normalizeVerifiedSources} from './rssd-source-snapshot.mjs';

const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const limit=1024*1024,totalLimit=2*1024*1024;
const types=new Set(['text/html','text/plain','application/xhtml+xml','application/xml','text/xml']);
const fail=message=>Object.assign(Error(message),{code:'source_verification_unavailable'});
function identityOf(c){return {origin:centerOrigin(c?.origin),orgId:protocol.id(c?.orgId,'orgId'),workerId:protocol.id(c?.workerId,'workerId')};}
function demandOf(value){const d=protocol.demand(value);if(d.kind!=='write'||d.source!==null||d.brief.length>4000)throw fail('A concise original write demand is required');return d;}
function pinOf(value){if(!value||typeof value.id!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(value.id)||typeof value.version!=='string'||!value.version.trim()||value.version.length>100||!hex(value.codeSha256))throw fail('A configured verifier identity is required');return {id:value.id,version:value.version,codeSha256:value.codeSha256};}
function candidatesOf(values){
 if(!Array.isArray(values)||!values.length||values.length>8)throw fail('One to eight candidate sources are required');const seen=new Set();
 return values.map(value=>{if(!value||Object.keys(value).some(k=>!['title','url'].includes(k))||typeof value.title!=='string'||!value.title.trim()||value.title.length>500)throw fail('Invalid source candidate');const url=publicHttpsUrl(value.url).href;if(url!==value.url||seen.has(url))throw fail('Candidate URL is not canonical or is duplicated');seen.add(url);return {title:value.title.trim(),url};});
}
function aliasesOf(values,candidates){
 if(values===undefined)return undefined;if(!Array.isArray(values)||!values.length||values.length>candidates.length)throw fail('Invalid source identity evidence');
 const map=new Map();for(const item of values){if(!item||Object.keys(item).some(k=>!['url','aliases','identityEvidenceHash'].includes(k))||map.has(item.url)||!candidates.some(c=>c.url===item.url))throw fail('Identity evidence is outside the original sources');map.set(item.url,item);}
 const checked=normalizeVerifiedSources(candidates.map(c=>({title:c.title,url:c.url,verified:true,verifiedTextSha256:'0'.repeat(64),...(map.has(c.url)?{aliases:map.get(c.url).aliases,identityEvidenceHash:map.get(c.url).identityEvidenceHash}:{})})));
 return checked.filter(x=>x.aliases).map(({url,aliases,identityEvidenceHash})=>({url,aliases,identityEvidenceHash}));
}
async function privateDir(path){await mkdir(path,{recursive:true,mode:0o700});const i=await lstat(path);if(!i.isDirectory()||i.isSymbolicLink()||await realpath(path)!==path||(i.mode&0o077)!==0||typeof process.getuid==='function'&&i.uid!==process.getuid())throw fail('Source verification directory is unsafe');return path;}
async function dirOf(home,connection,demandId){const base=await realpath(home),root=await privateDir(join(base,'source-verifications'));return privateDir(join(root,protocol.hash([connection.origin,connection.orgId,connection.workerId,demandId])));}
async function load(file){try{const i=await lstat(file);if(!i.isFile()||i.isSymbolicLink()||(i.mode&0o077)!==0||typeof process.getuid==='function'&&i.uid!==process.getuid())throw Error('unsafe');return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw fail('Source verification evidence cannot be read');}}
function checked(value,name){const {recordHash,...body}=value||{};if(!hex(recordHash)||protocol.hash(body)!==recordHash)throw fail(name+' integrity check failed');return body;}
const save=(file,body)=>writeCenterJson(file,{...body,recordHash:protocol.hash(body)});
function when(clock){const t=clock();if(!(t instanceof Date)||!Number.isFinite(t.getTime()))throw fail('Invalid verification time');return t.toISOString();}
function paused(signal){if(signal?.aborted)throw fail('Source verification was cancelled');}
async function bounded(fn,ms,signal){paused(signal);let timer,abort;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('Source verification timed out')),ms);abort=()=>reject(fail('Source verification was cancelled'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
function assessmentOf(value,{candidate,textSha256,text,pin}){
 if(!value||value.sourceUrl!==candidate.url||value.observedTextSha256!==textSha256||protocol.canonical(value.verifier)!==protocol.canonical(pin)||!['full_text','abstract_only','unknown'].includes(value.coverage)||!['public','unknown'].includes(value.access)||typeof value.readable!=='boolean'||typeof value.primarySource!=='boolean'||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>2000||typeof value.assessedAt!=='string'||!Number.isFinite(Date.parse(value.assessedAt)))throw fail('Verifier response lacks bound access evidence');
 const quote=value.evidenceQuote;if(value.readable&&(typeof quote!=='string'||quote.length<20||quote.length>1000||typeof text!=='string'||!text.includes(quote)))throw fail('Verifier quote is not present in the original source');
 let details;if(value.evidenceDetails!==undefined){const d=value.evidenceDetails,byType=Array.isArray(d?.requiredSections),byTitle=Array.isArray(d?.requiredSectionTitles),sections=byType?d.requiredSections:d?.requiredSectionTitles;if(!value.readable||!d||d.format!=='jats'||typeof d.idType!=='string'||typeof d.articleId!=='string'||typeof d.licenseUrl!=='string'||!text.includes(d.articleId)||!text.includes(d.licenseUrl)||byType===byTitle||!sections.length||sections.some(x=>typeof x!=='string'||(byType?!/^[a-z-]{2,40}$/.test(x):!x.trim()||x.length>300||!text.includes(x)))||!Number.isSafeInteger(d.minSectionCharacters)||d.minSectionCharacters<100||d.minSectionCharacters>100000)throw fail('Source structure evidence is invalid');details={format:'jats',idType:d.idType,articleId:d.articleId,licenseUrl:d.licenseUrl,...(byType?{requiredSections:sections}:{requiredSectionTitles:sections}),minSectionCharacters:d.minSectionCharacters};}
 return {sourceUrl:candidate.url,observedTextSha256:textSha256,verifier:pin,coverage:value.coverage,access:value.access,readable:value.readable,primarySource:value.primarySource,reason:value.reason.trim(),assessedAt:value.assessedAt,...(value.readable?{evidenceQuote:quote,evidenceQuoteSha256:sha(quote)}:{}),...(details?{evidenceDetails:details}:{})};
}
function eligible(a){return a.coverage==='full_text'&&a.access==='public'&&a.readable===true&&a.primarySource===true;}
async function readVerified(dir,{connection,demandId,pin,expectedReceiptHash}={}){
 const rawRequest=await load(join(dir,'request.json')),rawReceipt=await load(join(dir,'receipt.json'));if(!rawRequest||!rawReceipt)throw fail('Original verification receipt is missing');
 const request=checked(rawRequest,'Source verification request'),receipt=checked(rawReceipt,'Source verification receipt');
 if(request.version!==1||receipt.version!==1||receipt.requestHash!==rawRequest.recordHash||request.demandId!==demandId||!hex(request.demandHash)||protocol.canonical(request.connection)!==protocol.canonical(connection)||protocol.canonical(request.verifier)!==protocol.canonical(pin)||protocol.canonical(candidatesOf(request.candidates))!==protocol.canonical(request.candidates)||protocol.canonical(aliasesOf(request.identityAliases,request.candidates)??null)!==protocol.canonical(request.identityAliases??null)||protocol.canonical(receipt.identityAliases??null)!==protocol.canonical(request.identityAliases??null)||!Array.isArray(receipt.records)||receipt.records.length!==request.candidates.length||expectedReceiptHash&&rawReceipt.recordHash!==expectedReceiptHash)throw fail('Original verification scope changed');
 let total=0;const docs=[];
 for(let i=0;i<request.candidates.length;i++){
  const candidate=request.candidates[i],key=protocol.hash(candidate.url),raw=await load(join(dir,key+'.response.json')),review=await load(join(dir,key+'.assessment.json'));if(!raw||!review)throw fail('Source response or verifier evidence is missing');
  const response=checked(raw,'Source response'),a=checked(review,'Source access assessment');
  if(response.requestHash!==rawRequest.recordHash||response.url!==candidate.url||response.originalUrl!==candidate.url||response.finalUrl!==candidate.url||!types.has(response.contentType)||typeof response.text!=='string'||response.text.includes('\uFFFD')||sha(response.text)!==response.textSha256||Buffer.byteLength(response.text)!==response.bytes||response.bytes<100||response.bytes>limit)throw fail('Saved source response changed');
  total+=response.bytes;if(total>totalLimit)throw fail('Saved sources exceed the size limit');
  const assessment=assessmentOf(a.assessment,{candidate,textSha256:response.textSha256,text:response.text,pin});if(response.version!==1||a.version!==1||a.requestHash!==rawRequest.recordHash||a.responseHash!==raw.recordHash||protocol.canonical(receipt.records[i])!==protocol.canonical({candidate,textSha256:response.textSha256,contentType:response.contentType,bytes:response.bytes,responseHash:raw.recordHash,assessment,assessmentHash:review.recordHash}))throw fail('Saved source verifier evidence changed');
  docs.push({candidate,response,assessment});
 }
 const all=docs.every(x=>eligible(x.assessment)),sources=all?normalizeVerifiedSources(docs.map(x=>{const a=request.identityAliases?.find(y=>y.url===x.candidate.url);return {title:x.candidate.title,url:x.candidate.url,verified:true,verifiedTextSha256:x.response.textSha256,...(a?{aliases:a.aliases,identityEvidenceHash:a.identityEvidenceHash}:{})};})):[];
 if(receipt.status!==(all?'verified':'pending')||receipt.sourceSetHash!==(all?protocol.hash(sources):null)||!Number.isFinite(Date.parse(receipt.verifiedAt)))throw fail('Source verification status changed');
 return {request,receipt,receiptHash:rawReceipt.recordHash,docs,verifiedSources:sources};
}
const summary=e=>({status:e.receipt.status,receiptHash:e.receiptHash,sourceSetHash:e.receipt.sourceSetHash,verifiedSources:e.verifiedSources,coverage:e.docs.map(d=>({url:d.candidate.url,coverage:d.assessment.coverage,access:d.assessment.access}))});

/** Fetch only preselected public URLs and preserve the actual decoded response.
 * The trusted verifier is pinned by application configuration, not model text.
 * A 200 response does not prove full-text access, permission, or factual truth. */
export async function verifyTaskSourceCandidates({home,connection,demand,candidates,verifier,trustedVerifierPin,identityAliases,verifyIdentityAliases,fetchPage=fetchPublicText,clock=()=>new Date(),signal,timeoutMs=12000}={}){
 if(typeof home!=='string'||!home||typeof fetchPage!=='function'||typeof verifier?.assess!=='function'||typeof clock!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw fail('Explicit source and access verification are required');
 const c=identityOf(connection),d=demandOf(demand),list=candidatesOf(candidates),pin=pinOf(trustedVerifierPin),aliases=aliasesOf(identityAliases,list);if(protocol.canonical(pinOf(verifier))!==protocol.canonical(pin))throw fail('Configured verifier identity differs');
 if(aliases){if(typeof verifyIdentityAliases!=='function')throw fail('Independent identity alias verification is required');for(const item of aliases)if(await bounded(()=>verifyIdentityAliases(structuredClone(item)),timeoutMs,signal)!==true)throw fail('Source identity aliases were not independently verified');}
 paused(signal);const dir=await dirOf(home,c,d.id),file=join(dir,'request.json');
 return withFileLock(join(dir,'verification.lock'),async()=>{
  const request={version:1,connection:c,demandId:d.id,workspaceId:d.workspaceId,sectionId:d.sectionId,demandHash:protocol.hash(d),candidates:list,verifier:pin,...(aliases?{identityAliases:aliases}:{})},prior=await load(file);
  if(prior&&protocol.canonical(checked(prior,'Source verification request'))!==protocol.canonical(request))throw fail('Original source request cannot be replaced');
  if(!prior)await save(file,request);const stored=await load(file),requestHash=stored.recordHash,existing=await load(join(dir,'receipt.json'));
  if(existing)return summary(await readVerified(dir,{connection:c,demandId:d.id,pin}));
  let total=0;const records=[];
  for(const candidate of list){
   paused(signal);const key=protocol.hash(candidate.url),responseFile=join(dir,key+'.response.json'),assessmentFile=join(dir,key+'.assessment.json');let raw=await load(responseFile);
   if(!raw){let response;try{response=await bounded(()=>fetchPage(candidate.url,{timeoutMs,maxBytes:limit,maxRedirects:0,signal}),timeoutMs,signal);}catch{throw fail('Original source could not be accessed');}
    if(!response?.reachable||response.originalUrl!==candidate.url||response.finalUrl!==candidate.url||!types.has(response.contentType)||typeof response.text!=='string'||response.text.includes('\uFFFD'))throw fail('Original source response is not readable');
    const bytes=Buffer.byteLength(response.text);if(bytes<100||bytes>limit)throw fail('Original source exceeds capture bounds');
    await save(responseFile,{version:1,requestHash,url:candidate.url,originalUrl:response.originalUrl,finalUrl:response.finalUrl,contentType:response.contentType,text:response.text,textSha256:sha(response.text),bytes});raw=await load(responseFile);
   }
   const response=checked(raw,'Source response');if(response.version!==1||response.requestHash!==requestHash||response.url!==candidate.url||response.originalUrl!==candidate.url||response.finalUrl!==candidate.url||!types.has(response.contentType)||typeof response.text!=='string'||response.text.includes('\uFFFD')||sha(response.text)!==response.textSha256||Buffer.byteLength(response.text)!==response.bytes||response.bytes<100||response.bytes>limit)throw fail('Original source response changed');
   total+=response.bytes;if(total>totalLimit)throw fail('Original sources exceed capture bounds');
   let review=await load(assessmentFile);if(!review){let verdict;try{verdict=await bounded(()=>verifier.assess({candidate:structuredClone(candidate),text:response.text,textSha256:response.textSha256,contentType:response.contentType,signal}),timeoutMs,signal);}catch{throw fail('Independent source verification is unavailable');}
    const assessment=assessmentOf(verdict,{candidate,textSha256:response.textSha256,text:response.text,pin});await save(assessmentFile,{version:1,requestHash,responseHash:raw.recordHash,assessment});review=await load(assessmentFile);
   }
   const reviewed=checked(review,'Source access assessment'),assessment=assessmentOf(reviewed.assessment,{candidate,textSha256:response.textSha256,text:response.text,pin});if(reviewed.version!==1||reviewed.requestHash!==requestHash||reviewed.responseHash!==raw.recordHash)throw fail('Original verifier evidence changed');
   records.push({candidate,textSha256:response.textSha256,contentType:response.contentType,bytes:response.bytes,responseHash:raw.recordHash,assessment,assessmentHash:review.recordHash});
  }
  paused(signal);const full=records.every(r=>eligible(r.assessment)),verifiedSources=full?normalizeVerifiedSources(records.map(r=>{const a=aliases?.find(x=>x.url===r.candidate.url);return {title:r.candidate.title,url:r.candidate.url,verified:true,verifiedTextSha256:r.textSha256,...(a?{aliases:a.aliases,identityEvidenceHash:a.identityEvidenceHash}:{})};})):[];
  await save(join(dir,'receipt.json'),{version:1,requestHash,status:full?'verified':'pending',sourceSetHash:full?protocol.hash(verifiedSources):null,records,verifiedAt:when(clock),...(aliases?{identityAliases:aliases}:{})});
  return summary(await readVerified(dir,{connection:c,demandId:d.id,pin}));
 },{timeout:100});
}

/** Resolve proof from the original receipt and source responses every time.
 * The hash detects accidental changes, not a signature against an OS user who
 * can alter all local records. The pinned verifier remains a trusted boundary. */
export function createStoredSelectionVerifier({home,connection,demandId,trustedVerifierPin,expectedReceiptHash}={}){
 const c=identityOf(connection),id=protocol.id(demandId,'demandId'),pin=pinOf(trustedVerifierPin);if(expectedReceiptHash!==undefined&&!hex(expectedReceiptHash))throw fail('Invalid receipt anchor');
 return async input=>{
  const dir=await dirOf(home,c,id),e=await readVerified(dir,{connection:c,demandId:id,pin,expectedReceiptHash});
  if(e.receipt.status!=='verified'||input?.demandId!==id||input.workspaceId!==e.request.workspaceId||input.sectionId!==e.request.sectionId||input.demandHash!==e.request.demandHash||input.sourceSetHash!==e.receipt.sourceSetHash||protocol.canonical(normalizeVerifiedSources(input.verifiedSources))!==protocol.canonical(e.verifiedSources))throw fail('Independent full-text verification is incomplete or does not match');
  return {valid:true,demandHash:e.request.demandHash,sourceSetHash:e.receipt.sourceSetHash,evidenceHash:e.receiptHash,method:pin.id+'@'+pin.version,verifiedAt:e.receipt.verifiedAt};
 };
}

/** Provide the same frozen response and access verdict to source-snapshot;
 * these adapters do not fetch again, access credentials or accept new URLs. */
export function createStoredSourceAdapters({home,connection,demandId,trustedVerifierPin,expectedReceiptHash}={}){
 const c=identityOf(connection),id=protocol.id(demandId,'demandId'),pin=pinOf(trustedVerifierPin);if(!hex(expectedReceiptHash))throw fail('Original receipt anchor is required');
 const document=async url=>{const dir=await dirOf(home,c,id),e=await readVerified(dir,{connection:c,demandId:id,pin,expectedReceiptHash});if(e.receipt.status!=='verified')throw fail('Full-text source verification is incomplete');const doc=e.docs.find(x=>x.candidate.url===url);if(!doc||!eligible(doc.assessment))throw fail('Source is outside the verified receipt');return doc;};
 return {
  fetchPage:async url=>{const d=await document(url);return {reachable:true,originalUrl:url,finalUrl:url,contentType:d.response.contentType,text:d.response.text};},
  assessAccess:async({source,text,contentType})=>{const d=await document(source.url);if(sha(text)!==d.response.textSha256||contentType!==d.response.contentType)throw fail('Source does not match the original verification');return {readable:true,coverage:'full_text',reason:d.assessment.reason};},
 };
}
