// Explicitly configured source stage for one Center identity. Importing this
// module does not claim, publish or enable a worker.
import {lstat,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {centerOrigin} from './rssd-center-client.mjs';
import {verifyTaskSourceCandidates,createStoredSelectionVerifier,createStoredSourceAdapters} from './rssd-source-verification.mjs';
import {freezeSourceSelection,bindSourceSelectionToClaim} from './rssd-source-selection.mjs';
import {captureTaskSourceSnapshot,sourceSnapshotPrompt,verifyEditionSourceSnapshot,normalizeVerifiedSources} from './rssd-source-snapshot.mjs';
import {fetchPublicText,publicHttpsUrl} from './rssd-topic-public.mjs';

const fail=message=>Object.assign(Error(message),{code:'source_pending'});
const equal=(a,b)=>protocol.canonical(a)===protocol.canonical(b);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const abort=s=>{if(s?.aborted)throw fail('Source stage cancelled');};
async function bounded(fn,signal){abort(signal);let timer,listener;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('Source stage timed out')),12000);listener=()=>reject(fail('Source stage cancelled'));signal?.addEventListener('abort',listener,{once:true});if(signal?.aborted)listener();})]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',listener);}}
function idOf(c){return {origin:centerOrigin(c?.origin),orgId:protocol.id(c?.orgId,'orgId'),workerId:protocol.id(c?.workerId,'workerId')};}
function originalDemand(value){const d=protocol.demand(value);if(d.kind!=='write'||d.source!==null||d.brief.length>1200)throw fail('A concise original write demand is required');return d;}
async function selectionRecord(home,id){
 const root=await realpath(home),dir=join(root,'source-selections'),file=join(dir,protocol.hash(protocol.id(id,'demandId'))+'.json');
 try{const d=await lstat(dir),i=await lstat(file);if(!d.isDirectory()||d.isSymbolicLink()||await realpath(dir)!==dir||(d.mode&0o077)!==0||!i.isFile()||i.isSymbolicLink()||(i.mode&0o077)!==0||typeof process.getuid==='function'&&(d.uid!==process.getuid()||i.uid!==process.getuid()))throw Error('unsafe');return JSON.parse(await readFile(file,'utf8'));}catch{throw fail('Original source selection is unavailable');}
}
function checkSelection(record,connection,demand){
 const s=record?.selection;if(record?.version!==1||!s||!hex(record.selectionHash)||protocol.hash(s)!==record.selectionHash||!equal({origin:s.origin,orgId:s.orgId,workerId:s.workerId},connection)||s.demandId!==demand.id||s.workspaceId!==demand.workspaceId||s.sectionId!==demand.sectionId||s.demandHash!==protocol.hash(demand)||!hex(s.verification?.evidenceHash))throw fail('Original source selection changed');
 const sources=normalizeVerifiedSources(s.verifiedSources);if(s.verification.sourceSetHash!==protocol.hash(sources))throw fail('Original source list changed');return {selection:s,sources};
}
function checkBinding(record,claim,selection){
 const b=record.binding;if(!b)throw fail('Original claim source binding is missing');const {bindingHash,...body}=b;
 if(!hex(bindingHash)||protocol.hash(body)!==bindingHash||b.selectionHash!==record.selectionHash||b.claimId!==claim.id||b.generation!==claim.generation||b.workerId!==selection.workerId||claim.workspaceId!==selection.workspaceId||claim.sectionId!==selection.sectionId)throw fail('Original claim source binding changed');
 return {claimId:claim.id,generation:claim.generation,workspaceId:claim.workspaceId,sectionId:claim.sectionId,demandHash:selection.demandHash};
}

/** The verifier and pin must be supplied by trusted host configuration, not by
 * the model or demand. Existing unsigned local hashes detect inconsistencies,
 * not a malicious actor able to rewrite the whole private directory. */
export function createSourceStage({enabled=false,home,connection,client,verifier,trustedVerifierPin,authorizeCandidate,identityAliases,verifyIdentityAliases,fetchPage,clock=()=>new Date()}={}){
 if(enabled!==true)return null;
 if(typeof home!=='string'||!home||typeof verifier?.assess!=='function'||typeof authorizeCandidate!=='function'||typeof client?.identity!=='function'||typeof client?.activeClaim!=='function'||typeof clock!=='function')throw fail('Trusted source stage configuration is incomplete');
 const identity=idOf(connection),pin={id:trustedVerifierPin?.id,version:trustedVerifierPin?.version,codeSha256:trustedVerifierPin?.codeSha256};
 if(centerOrigin(client.origin)!==identity.origin||!pin.id||!pin.version||!hex(pin.codeSha256)||!equal(pin,{id:verifier.id,version:verifier.version,codeSha256:verifier.codeSha256}))throw fail('Trusted source verifier identity differs');
 if(identityAliases!==undefined&&(!Array.isArray(identityAliases)||typeof verifyIdentityAliases!=='function'))throw fail('Trusted source identity evidence is incomplete');
 const verifierFor=(id,anchor)=>createStoredSelectionVerifier({home,connection:identity,demandId:id,trustedVerifierPin:pin,expectedReceiptHash:anchor});
 const topicReads=new Map(),topicKey=(url,s)=>protocol.hash([url,s.id,s.siteId,s.workspaceId,s.sectionId]);
 async function acceptCandidate({url,slot}={}){if(typeof url!=='string'||!slot||typeof slot.siteId!=='string'||typeof slot.workspaceId!=='string'||typeof slot.sectionId!=='string')return false;try{return await authorizeCandidate({url,slot:structuredClone(slot)})===true;}catch{return false;}}
 async function authorized(slot,d,sources){if(!slot||slot.id!==d.id||slot.workspaceId!==d.workspaceId||slot.sectionId!==d.sectionId)throw fail('Source slot does not match the original demand');for(const s of sources)if(!await acceptCandidate({url:s.url,slot}))throw fail('Source is outside trusted site scope');}
 async function readForTopic({url,slot,signal}={}){
  abort(signal);if(!await acceptCandidate({url,slot})||publicHttpsUrl(url).href!==url||typeof slot.id!=='string')throw fail('Source is outside trusted site scope');const key=topicKey(url,slot);topicReads.delete(key);
  const response=await bounded(()=>(fetchPage||fetchPublicText)(url,{timeoutMs:12000,maxBytes:1024*1024,maxRedirects:0,signal}),signal);
  if(!response?.reachable||response.originalUrl!==url||response.finalUrl!==url||!['text/html','text/plain','application/xhtml+xml','application/xml','text/xml'].includes(response.contentType)||typeof response.text!=='string'||response.text.includes('\uFFFD')||Buffer.byteLength(response.text)<100||Buffer.byteLength(response.text)>1024*1024)throw fail('Original topic source is unavailable');
  const textSha256=createHash('sha256').update(response.text,'utf8').digest('hex'),a=await bounded(()=>verifier.assess({candidate:{url},text:response.text,textSha256,contentType:response.contentType,signal}),signal);
  if(a?.sourceUrl!==url||a.observedTextSha256!==textSha256||!equal(a.verifier,pin)||a.coverage!=='full_text'||a.access!=='public'||a.readable!==true||a.primarySource!==true||typeof a.evidenceQuote!=='string'||a.evidenceQuote.length<20||a.evidenceQuote.length>1000||!response.text.includes(a.evidenceQuote))throw fail('Topic source access is not verified');
  topicReads.set(key,textSha256);return {text:response.text,textSha256};
 }
 async function inspect(demand){
  const d=originalDemand(demand),record=await selectionRecord(home,d.id),{selection,sources}=checkSelection(record,identity,d),verify=verifierFor(d.id,selection.verification.evidenceHash);
  const saved=sources.filter(s=>s.aliases).map(({url,aliases,identityEvidenceHash})=>({url,aliases,identityEvidenceHash}));if(!equal(saved,identityAliases??[])||saved.length&&typeof verifyIdentityAliases!=='function')throw fail('Original source identity aliases changed');for(const item of saved)if(await verifyIdentityAliases(structuredClone(item))!==true)throw fail('Original source identity aliases are unavailable');
  const proof=await verify({demandId:d.id,workspaceId:d.workspaceId,sectionId:d.sectionId,demandHash:protocol.hash(d),verifiedSources:sources,sourceSetHash:protocol.hash(sources)});
  if(!equal(proof,selection.verification))throw fail('Original source verification receipt changed');return {d,record,selection,sources};
 }
 async function freeze({demand,candidates,slot,signal}={}){
  abort(signal);const d=originalDemand(demand);if(!Array.isArray(candidates)||!candidates.length||candidates.some(c=>!hex(c?.expectedTextSha256)))throw fail('Original source list and topic evidence hashes required');await authorized(slot,d,candidates);if(candidates.some(c=>topicReads.get(topicKey(c.url,slot))!==c.expectedTextSha256))throw fail('Original topic source was not verified by this stage');const expected=candidates.map(c=>c.expectedTextSha256),minimal=candidates.map(({title,url})=>({title,url}));const result=await verifyTaskSourceCandidates({home,connection:identity,demand:d,candidates:minimal,verifier,trustedVerifierPin:pin,...(identityAliases?{identityAliases,verifyIdentityAliases}:{}),...(fetchPage?{fetchPage}:{}),clock,signal});
  if(result.status!=='verified')throw fail('Original full-text access is not verified');
  if(result.verifiedSources.some((s,i)=>s.verifiedTextSha256!==expected[i]))throw fail('Source changed after topic review');
  // Reject obvious verbatim extracts. This is not a semantic privacy check;
  // callers must still construct a concise brief rather than source excerpts.
  const adapters=createStoredSourceAdapters({home,connection:identity,demandId:d.id,trustedVerifierPin:pin,expectedReceiptHash:result.receiptHash}),brief=d.brief.replace(/\s+/g,' ').trim();
  if(brief.length>=100)for(const source of result.verifiedSources){const text=(await adapters.fetchPage(source.url)).text.replace(/\s+/g,' ');for(let i=0;i+100<=brief.length;i+=25)if(text.includes(brief.slice(i,i+100)))throw fail('The public brief contains source text');}
  const record=await freezeSourceSelection({home,connection:identity,demand:d,verifiedSources:result.verifiedSources,verifySelection:verifierFor(d.id,result.receiptHash),clock});return {selectionHash:record.selectionHash,receiptHash:result.receiptHash};
 }
 async function verifyDemand({demand,slot,signal}={}){abort(signal);const x=await inspect(demand);await authorized(slot,x.d,x.sources);return {selectionHash:x.record.selectionHash,receiptHash:x.selection.verification.evidenceHash};}
 async function restore({claim,directory,slot,signal,offline=false}={}){
  abort(signal);if(!claim?.payload||!directory)throw fail('Original claim and private job directory are required');const x=await inspect(claim.payload);if(claim.id!==x.d.id||claim.workspaceId!==x.d.workspaceId||claim.sectionId!==x.d.sectionId)throw fail('Claim differs from original demand');
  await authorized(slot,x.d,x.sources);
  let binding,selectionHash,bindingHash;
  if(offline){binding=checkBinding(x.record,claim,x.selection);selectionHash=x.record.selectionHash;bindingHash=x.record.binding.bindingHash;}
  else{const bound=await bindSourceSelectionToClaim({home,connection:identity,claim,client,verifySelection:verifierFor(x.d.id,x.selection.verification.evidenceHash),clock});binding=bound.binding;selectionHash=bound.selectionHash;bindingHash=bound.bindingHash;}
  if(offline){try{const file=join(await realpath(directory),'source-evidence','snapshot.json'),s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('unsafe');}catch{throw fail('Original source snapshot is missing during offline recovery');}}
  const adapters=createStoredSourceAdapters({home,connection:identity,demandId:x.d.id,trustedVerifierPin:pin,expectedReceiptHash:x.selection.verification.evidenceHash});
  const snapshot=await captureTaskSourceSnapshot({jobDirectory:directory,binding,verifiedSources:x.sources,...adapters,clock,signal});const prompt=sourceSnapshotPrompt(snapshot);return {snapshot,prompt,selectionHash,bindingHash};
 }
 async function verifyEdition({claim,directory,slot,edition,signal,offline=false,authorizedContextLinks,verifyContextLink}={}){const data=await restore({claim,directory,slot,signal,offline});return verifyEditionSourceSnapshot({edition,snapshot:data.snapshot,...(authorizedContextLinks?{authorizedContextLinks}:{}),...(verifyContextLink?{verifyContextLink}:{})});}
 return {acceptCandidate,readForTopic,freeze,verifyDemand,restore,verifyEdition};
}
