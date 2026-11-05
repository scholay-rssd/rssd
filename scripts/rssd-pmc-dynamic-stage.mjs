// Dynamic single-PMC source stage. Discovery locators are canonical PMC page
// URLs; only the internally constructed official JATS URL reaches the snapshot.
// Import and construction never start a scheduler or write to Center.
import {mkdir,lstat,realpath,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {centerOrigin,writeCenterJson} from './rssd-center-client.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {fetchAuthoritativeSource} from './rssd-topic-public.mjs';
import {createJatsSourceVerifier} from './rssd-source-jats-verifier.mjs';
import {createPmcLeadVerifier} from './rssd-pmc-lead-verifier.mjs';
import {resolvePmcTopic} from './rssd-pmc-resolver.mjs';
import {createSourceStage} from './rssd-source-stage.mjs';

const fail=message=>Object.assign(Error(message),{code:'source_pending'});
const same=(a,b)=>protocol.canonical(a)===protocol.canonical(b);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const locator=x=>typeof x==='string'&&/^https:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC[1-9][0-9]{0,10}\/$/.test(x);
function identityAliases(record){
 if(record.identityAliasVersion===undefined)return undefined;
 const ids=record.ids,pmcid=ids?.pmcid,pmid=ids?.pmid,doi=ids?.doi;
 if(record.identityAliasVersion!==1||!/^PMC[1-9][0-9]{0,10}$/.test(pmcid||'')||!/^[1-9][0-9]{0,10}$/.test(pmid||'')||typeof doi!=='string'||doi!==doi.toLowerCase()||!/^10\.[0-9]{4,9}\/[a-z0-9._;()/:+-]{1,200}$/.test(doi)||record.sourceUrl!=='https://pmc.ncbi.nlm.nih.gov/articles/'+pmcid+'/'||record.observedSourceUrl!==record.rule?.url||record.rule?.url!=='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id='+pmcid.slice(3)+'&retmode=xml'||!hex(record.sourceTextSha256)||record.sourceTextSha256!==record.jatsTextSha256||!hex(record.idConversionSha256))throw fail('PMC identity evidence is incomplete');
 const evidence={version:1,slot:record.slot,sourceUrl:record.sourceUrl,observedSourceUrl:record.observedSourceUrl,ids,idConversionSha256:record.idConversionSha256,jatsTextSha256:record.jatsTextSha256,leadVerifier:record.leadVerifier};
 return [{url:record.rule.url,aliases:['https://doi.org/'+doi,record.sourceUrl,'https://pubmed.ncbi.nlm.nih.gov/'+pmid+'/'],identityEvidenceHash:protocol.hash(evidence)}];
}
function scope(slot){if(!slot)throw fail('Original slot is required');return Object.fromEntries(['id','siteId','workspaceId','sectionId'].map(k=>[k,protocol.id(slot[k],k)]));}
function identity(value){return {origin:centerOrigin(value?.origin),orgId:protocol.id(value?.orgId,'orgId'),workerId:protocol.id(value?.workerId,'workerId')};}
function demandOf(value,slot){const d=protocol.demand(value);if(d.kind!=='write'||d.source!==null||d.id!==slot.id||d.workspaceId!==slot.workspaceId||d.sectionId!==slot.sectionId)throw fail('Original demand differs from slot');return d;}
async function directory(home){const base=await realpath(home),dir=join(base,'pmc-dynamic-resolutions');await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||await realpath(dir)!==dir||(s.mode&0o077)||typeof process.getuid==='function'&&s.uid!==process.getuid())throw fail('Private PMC resolution directory is unsafe');return dir;}
async function pendingDirectory(home){const base=await realpath(home),dir=join(base,'pmc-dynamic-pending');await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||await realpath(dir)!==dir||(s.mode&0o077)||typeof process.getuid==='function'&&s.uid!==process.getuid())throw fail('Private PMC pending directory is unsafe');return dir;}
async function load(file){try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||typeof process.getuid==='function'&&s.uid!==process.getuid())throw Error('unsafe');const value=JSON.parse(await readFile(file,'utf8')),{recordHash,...body}=value;if(!hex(recordHash)||protocol.hash(body)!==recordHash)throw Error('changed');return value;}catch{throw fail('Original PMC resolution is unavailable');}}

export async function createPmcDynamicStage({home,connection,client,fetchPage=fetchAuthoritativeSource,authorizeCandidate}={}){
 if(typeof home!=='string'||!home||typeof fetchPage!=='function'||typeof authorizeCandidate!=='function'||typeof client?.identity!=='function'||typeof client?.activeClaim!=='function')throw fail('Trusted PMC stage configuration is incomplete');
 const c=identity(connection);if(centerOrigin(client.origin)!==c.origin)throw fail('Original Center identity differs');
 const leadVerifier=await createPmcLeadVerifier({fetchPage}),trustedLeadPin={id:leadVerifier.id,version:leadVerifier.version,codeSha256:leadVerifier.codeSha256},topics=new Map();
 const key=(url,s)=>protocol.hash([url,s.id,s.siteId,s.workspaceId,s.sectionId]);
 async function acceptCandidate({url,slot}={}){try{const s=scope(slot);return locator(url)&&await authorizeCandidate({url,slot:s})===true;}catch{return false;}}
 async function makeStage(record){
  const verifier=await createJatsSourceVerifier({rules:[record.rule]}),pin={id:verifier.id,version:verifier.version,codeSha256:verifier.codeSha256};if(!same(pin,record.verifier))throw fail('Original PMC verifier version changed');
  const aliases=identityAliases(record);
  return createSourceStage({enabled:true,home,connection:c,client,verifier,trustedVerifierPin:pin,fetchPage,authorizeCandidate:async({url,slot})=>url===record.rule.url&&same(scope(slot),record.slot),...(aliases?{identityAliases:aliases,verifyIdentityAliases:async item=>same(item,aliases[0])}:{})});
 }
 async function readForTopic({url,slot,signal}={}){
  const s=scope(slot),k=key(url,s);topics.delete(k);if(!await acceptCandidate({url,slot:s}))throw fail('PMC discovery locator is outside trusted scope');
  const resolved={...await resolvePmcTopic({slot:s,sourceUrl:url,leadVerifier,trustedLeadPin,fetchPage,signal}),identityAliasVersion:1};
  const pmcid=/\/articles\/(PMC[1-9][0-9]{0,10})\/$/.exec(url)[1],jats='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id='+pmcid.slice(3)+'&retmode=xml';
  if(!resolved||!same(resolved.slot,s)||resolved.sourceUrl!==url||!same(resolved.leadVerifier,trustedLeadPin)||!hex(resolved.jatsTextSha256)||resolved.ids?.pmcid!==pmcid||resolved.rule?.url!==jats||resolved.rule?.articleId!==pmcid)throw fail('PMC source identity was not verified');
  const stage=await makeStage(resolved),observed=await stage.readForTopic({url:resolved.rule.url,slot:s,signal});if(observed.textSha256!==resolved.jatsTextSha256)throw fail('PMC source changed during topic review');
  topics.set(k,{resolved,stage});return {text:observed.text,textSha256:observed.textSha256};
 }
 async function freeze({demand,slot,candidates,signal}={}){
  const s=scope(slot),d=demandOf(demand,s);if(!Array.isArray(candidates)||!candidates.length||candidates.length>8||d.brief.length>1200)throw fail('Exactly one PMC source is supported');
  const pendingDir=await pendingDirectory(home),stem=protocol.hash([c,d.id]),pendingFile=join(pendingDir,stem+'.json');
  return withFileLock(join(pendingDir,stem+'.slot-lock'),async()=>{
  if(candidates.length===1){try{await lstat(pendingFile);throw fail('Original multi-source PMC candidates are retained for review');}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(candidates.length>1){
   const resolutionFile=join(await directory(home),stem+'.json');try{await lstat(resolutionFile);throw fail('Original PMC resolution already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
   const selected=[],seen=new Set();for(const candidate of candidates){if(!await acceptCandidate({url:candidate?.url,slot:s})||seen.has(candidate.url)||!hex(candidate.expectedTextSha256)||typeof candidate.title!=='string'||!candidate.title.trim()||candidate.title.length>500)throw fail('PMC candidate set is not independently verified');seen.add(candidate.url);const item=topics.get(key(candidate.url,s));if(!item||item.resolved.jatsTextSha256!==candidate.expectedTextSha256)throw fail('PMC candidate set is not independently verified');selected.push({title:candidate.title.trim(),url:candidate.url,expectedTextSha256:candidate.expectedTextSha256,resolution:item.resolved});}
   const body={version:1,connection:c,demand:d,slot:s,candidates:selected,reason:'multiple_sources_unsupported'},dir=await pendingDirectory(home),file=join(dir,protocol.hash([c,d.id])+'.json');
   await withFileLock(file+'.lock',async()=>{let exists=true;try{await lstat(file);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}if(!exists)await writeCenterJson(file,{...body,recordHash:protocol.hash(body)});const record=await load(file),{recordHash,...old}=record;if(!same(old,body))throw fail('Original pending PMC candidate set cannot be replaced');},{timeout:100});
   throw fail('Exactly one PMC source is supported; original candidates retained');
  }
  const candidate=candidates[0];
  if(!await acceptCandidate({url:candidate?.url,slot:s})||!hex(candidate.expectedTextSha256))throw fail('PMC topic source is outside trusted scope');
  const selected=topics.get(key(candidate.url,s));if(!selected||selected.resolved.jatsTextSha256!==candidate.expectedTextSha256)throw fail('Original PMC topic source was not reviewed');
  const {resolved,stage}=selected,body={...resolved,version:1,connection:c,demandHash:protocol.hash(d)};const dir=await directory(home),file=join(dir,protocol.hash([c,d.id])+'.json');
  await withFileLock(file+'.lock',async()=>{let exists=true;try{await lstat(file);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}if(!exists)await writeCenterJson(file,{...body,recordHash:protocol.hash(body)});const saved=await load(file),{recordHash,...prior}=saved;if(!same(prior,body))throw fail('Original PMC resolution cannot be replaced');},{timeout:100});
  return stage.freeze({demand:d,slot:s,candidates:[{title:resolved.title,url:resolved.rule.url,expectedTextSha256:resolved.jatsTextSha256}],signal});
  },{timeout:100});
 }
 async function frozen(demand,slot){
  const s=scope(slot),d=demandOf(demand,s),dir=await directory(home),record=await load(join(dir,protocol.hash([c,d.id])+'.json'));
  if(record.version!==1||!same(record.connection,c)||!same(record.slot,s)||record.demandHash!==protocol.hash(d)||!same(record.leadVerifier,trustedLeadPin)||!locator(record.sourceUrl)||!await acceptCandidate({url:record.sourceUrl,slot:s}))throw fail('Original PMC resolution scope changed');
  const pmcid=/\/articles\/(PMC[1-9][0-9]{0,10})\/$/.exec(record.sourceUrl)[1],jats='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id='+pmcid.slice(3)+'&retmode=xml';
  if(record.ids?.pmcid!==pmcid||record.rule?.url!==jats||record.rule?.articleId!==pmcid||!hex(record.jatsTextSha256))throw fail('Original PMC resolution identity changed');
  return {slot:s,demand:d,stage:await makeStage(record)};
 }
 async function verifyDemand({demand,slot,signal}={}){const x=await frozen(demand,slot);return x.stage.verifyDemand({demand:x.demand,slot:x.slot,signal});}
 async function restore({claim,slot,directory,signal,offline=false}={}){if(!claim?.payload)throw fail('Original claim is required');const x=await frozen(claim.payload,slot);return x.stage.restore({claim,slot:x.slot,directory,signal,offline});}
 async function verifyEdition({claim,slot,directory,edition,signal,offline=false,authorizedContextLinks,verifyContextLink}={}){if(!claim?.payload)throw fail('Original claim is required');const x=await frozen(claim.payload,slot);return x.stage.verifyEdition({claim,slot:x.slot,directory,edition,signal,offline,authorizedContextLinks,verifyContextLink});}
 return {acceptCandidate,readForTopic,freeze,verifyDemand,restore,verifyEdition};
}
