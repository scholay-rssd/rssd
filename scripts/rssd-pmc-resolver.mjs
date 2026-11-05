// Isolated proof of concept; no scheduler or publication side effects.
// The lead verifier is trusted host code that independently read the original
// PMC page. Model-provided article identifiers or a URL alone are not proof.
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,lstat,realpath,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import protocol from '../contracts/rssd-v1.cjs';
import {writeCenterJson,centerOrigin} from './rssd-center-client.mjs';
import {fetchAuthoritativeSource} from './rssd-topic-public.mjs';
import {createJatsSourceVerifier} from './rssd-source-jats-verifier.mjs';
import {createSourceStage} from './rssd-source-stage.mjs';
import {withFileLock} from './editorial-lock.mjs';

const parser=fileURLToPath(new URL('./rssd-pmc-resolver.py',import.meta.url));
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const pending=message=>Object.assign(Error(message),{code:'source_pending'});
const same=(a,b)=>protocol.canonical(a)===protocol.canonical(b);
const licenses=['https://creativecommons.org/licenses/by/4.0/','https://creativecommons.org/publicdomain/zero/1.0/'];
const pmid=s=>typeof s==='string'&&/^[1-9][0-9]{0,10}$/.test(s);
const doi=s=>typeof s==='string'&&/^10\.[0-9]{4,9}\/[a-z0-9._;()/:+-]{1,200}$/i.test(s);
export function parsePmcSourceId(url){const page=/^https:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/(PMC[1-9][0-9]{0,10})\/$/.exec(url||''),xml=/^https:\/\/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/efetch\.fcgi\?db=pmc&id=([1-9][0-9]{0,10})&retmode=xml$/.exec(url||'');if(!page&&!xml)throw pending('Selected source is not a canonical PMC article page or E-utilities document');return page?page[1]:'PMC'+xml[1];}
function slotScope(slot){if(!slot)throw pending('Original slot is required');for(const name of ['id','siteId','workspaceId','sectionId'])protocol.id(slot[name],name);return {id:slot.id,siteId:slot.siteId,workspaceId:slot.workspaceId,sectionId:slot.sectionId};}
function scope(slot,demand){const bound=slotScope(slot);if(bound.id!==demand?.id||bound.workspaceId!==demand.workspaceId||bound.sectionId!==demand.sectionId)throw pending('Original slot differs from demand');return bound;}
async function bounded(fn,signal){if(signal?.aborted)throw pending('Source resolution cancelled');let timer,abort;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(pending('Source resolution timed out')),12000);abort=()=>reject(pending('Source resolution cancelled'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
export async function parsePmcMetadata(text,signal){return new Promise((resolve,reject)=>{const child=spawn('/usr/bin/python3',['-I',parser],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','ignore']});let result='',settled=false;const timer=setTimeout(()=>end(pending('Metadata parser timed out')),5000),abort=()=>end(pending('Metadata parser cancelled'));signal?.addEventListener('abort',abort,{once:true});function end(e,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(e){child.kill();reject(e);}else resolve(value);}child.on('error',()=>end(pending('Metadata parser unavailable')));child.stdout.on('data',x=>{result+=x;if(result.length>30000)end(pending('Metadata parser output too large'));});child.on('close',code=>{if(code!==0)return end(pending('Metadata parser failed'));try{const x=JSON.parse(result);if(x.error)throw Error();end(null,x);}catch{end(pending('Unsupported JATS structure'));}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({text}));if(signal?.aborted)abort();});}
function sectionsOf(titles){if(!Array.isArray(titles)||titles.some(x=>typeof x!=='string'||!x||x.length>300))throw pending('Unsupported section structure');const methods=titles.filter(x=>/^(methods|materials and methods|methodology|methodological guidance for data collection using audio- and video-based observational research)$/i.test(x));const outcomes=titles.filter(x=>/^(results|discussion|conclusion|conclusions)$/i.test(x));if(methods.length!==1||!outcomes.length||new Set(titles).size!==titles.length)throw pending('Known complete-text sections are missing or ambiguous');return [methods[0],outcomes[0]];}
async function fetchExact(fetchPage,url,types,signal){let r;try{r=await bounded(()=>fetchPage(url,{timeoutMs:12000,maxBytes:1024*1024,maxRedirects:0,signal}),signal);}catch{throw pending('Official source unavailable');}if(!r?.reachable||r.originalUrl!==url||r.finalUrl!==url||!types.includes(r.contentType)||typeof r.text!=='string'||r.text.includes('\uFFFD')||Buffer.byteLength(r.text)>1024*1024)throw pending('Official response is unavailable or redirected');return r.text;}
async function resolutionDir(home){const base=await realpath(home),dir=join(base,'pmc-resolutions');await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||await realpath(dir)!==dir||(s.mode&0o077)||typeof process.getuid==='function'&&s.uid!==process.getuid())throw pending('Private resolution directory is unsafe');return dir;}
async function readResolution(file){try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||typeof process.getuid==='function'&&s.uid!==process.getuid())throw Error();const x=JSON.parse(await readFile(file,'utf8')),{recordHash,...body}=x;if(!hex(recordHash)||protocol.hash(body)!==recordHash)throw Error();return x;}catch{throw pending('Original PMC resolution is unavailable');}}
async function stageFor({home,connection,client,record,fetchPage}){
 const verifier=await createJatsSourceVerifier({rules:[record.rule]});const pin={id:verifier.id,version:verifier.version,codeSha256:verifier.codeSha256};if(!same(pin,record.verifier))throw pending('Original verifier version changed');
 const authorizeCandidate=async({url,slot})=>url===record.rule.url&&same({id:slot.id,siteId:slot.siteId,workspaceId:slot.workspaceId,sectionId:slot.sectionId},record.slot);
 return createSourceStage({enabled:true,home,connection,client,verifier,trustedVerifierPin:pin,fetchPage,authorizeCandidate});
}

/** Verify an exact PMC candidate before topic selection; no demand or file is
 * written and no URL from a model, document or feed is followed. */
export async function resolvePmcTopic({slot,sourceUrl,leadVerifier,trustedLeadPin,fetchPage=fetchAuthoritativeSource,signal}={}){
 const bound=slotScope(slot),id=parsePmcSourceId(sourceUrl);if(!leadVerifier||typeof leadVerifier.verify!=='function'||!trustedLeadPin||!same({id:leadVerifier.id,version:leadVerifier.version,codeSha256:leadVerifier.codeSha256},trustedLeadPin)||!hex(trustedLeadPin.codeSha256))throw pending('Independent lead verifier is required');
 const expectedDocument='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id='+id.slice(3)+'&retmode=xml';
 const lead=await bounded(()=>leadVerifier.verify({sourceUrl,signal}),signal);if(!lead||lead.verified!==true||lead.primarySource!==true||lead.sourceUrl!==sourceUrl||![sourceUrl,expectedDocument].includes(lead.observedSourceUrl)||!hex(lead.observedTextSha256)||lead.pmcid!==id||!pmid(lead.pmid)||!doi(lead.doi))throw pending('Selected source identity is not independently verified');
 const convertedUrl='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id='+id.slice(3)+'&retmode=json',jatsUrl='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id='+id.slice(3)+'&retmode=xml';
 const conversion=await fetchExact(fetchPage,convertedUrl,['application/json'],signal);let parsed;try{parsed=JSON.parse(conversion);}catch{throw pending('ID conversion is invalid');}
 const uid=id.slice(3),row=parsed?.result?.[uid],rows=row?.articleids;const values=name=>Array.isArray(rows)?rows.filter(x=>x?.idtype===name).map(x=>x.value):[];if(parsed?.header?.type!=='esummary'||!same(parsed?.result?.uids,[uid])||row?.uid!==uid||!same(values('pmcid'),[id])||!same(values('pmid'),[lead.pmid])||values('doi').length!==1||typeof values('doi')[0]!=='string'||values('doi')[0].toLowerCase()!==lead.doi.toLowerCase())throw pending('Official article identifiers do not match selected source');
 const text=await fetchExact(fetchPage,jatsUrl,['text/xml','application/xml'],signal),jats=await parsePmcMetadata(text,signal),ids=jats.ids;
 if(!ids||!same(ids.pmcid,[id])||!same(ids.pmid,[lead.pmid])||ids.doi?.length!==1||ids.doi[0].toLowerCase()!==lead.doi.toLowerCase()||typeof jats.title!=='string'||!jats.title||jats.title.length>500)throw pending('JATS identity does not match official identifiers');
 const rule={url:jatsUrl,idType:'pmcid',articleId:id,licenseUrls:licenses,requiredSectionTitles:sectionsOf(jats.sections),minSectionCharacters:100},verifier=await createJatsSourceVerifier({rules:[rule]}),pin={id:verifier.id,version:verifier.version,codeSha256:verifier.codeSha256},verdict=await verifier.assess({candidate:{url:jatsUrl},text,textSha256:sha(text),contentType:'text/xml',signal});
 if(verdict.coverage!=='full_text'||verdict.access!=='public'||verdict.readable!==true||verdict.primarySource!==true||!verdict.evidenceDetails?.licenseUrl)throw pending('Original article structure or reuse license is unsupported');
 if(lead.observedSourceUrl===jatsUrl&&lead.observedTextSha256!==sha(text))throw pending('Verified lead source changed during resolution');
 return {slot:bound,sourceUrl,observedSourceUrl:lead.observedSourceUrl,sourceTextSha256:lead.observedTextSha256,leadVerifier:trustedLeadPin,ids:{pmcid:id,pmid:lead.pmid,doi:lead.doi.toLowerCase()},idConversionSha256:sha(conversion),jatsTextSha256:sha(text),title:jats.title,licenseUrl:verdict.evidenceDetails.licenseUrl,rule,verifier:pin};
}

/** Freeze one independently resolved source to an exact demand. */
export async function preparePmcSource({home,connection,client,demand,slot,sourceUrl,leadVerifier,trustedLeadPin,fetchPage=fetchAuthoritativeSource,signal}={}){
 const bound=scope(slot,demand),resolved=await resolvePmcTopic({slot:bound,sourceUrl,leadVerifier,trustedLeadPin,fetchPage,signal}),jatsUrl=resolved.rule.url;
 const identity={origin:centerOrigin(connection?.origin),orgId:protocol.id(connection?.orgId),workerId:protocol.id(connection?.workerId)},dir=await resolutionDir(home),file=join(dir,protocol.hash([identity,demand.id])+'.json');
 const body={version:1,connection:identity,demandHash:protocol.hash(protocol.demand(demand)),...resolved};
 await withFileLock(file+'.lock',async()=>{let exists=true;try{await lstat(file);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}if(!exists)await writeCenterJson(file,{...body,recordHash:protocol.hash(body)});const old=await readResolution(file);if(!same(Object.fromEntries(Object.entries(old).filter(([k])=>k!=='recordHash')),body))throw pending('Original PMC resolution cannot be replaced');},{timeout:100});
 const record=await readResolution(file),sourceStage=await stageFor({home,connection:identity,client,record,fetchPage}),observed=await sourceStage.readForTopic({url:jatsUrl,slot:bound,signal});if(observed.textSha256!==record.jatsTextSha256)throw pending('Original JATS changed during topic resolution');
 const frozen=await sourceStage.freeze({demand,slot:bound,candidates:[{title:record.title,url:jatsUrl,expectedTextSha256:record.jatsTextSha256}],signal});
 return {identity:record.ids,sourceUrl,jatsUrl,licenseUrl:record.licenseUrl,resolutionHash:record.recordHash,...frozen,sourceStage};
}

/** Resume only the recorded original demand and scope; no source refetch. */
export async function resumePmcSource({home,connection,client,demand,slot,fetchPage=fetchAuthoritativeSource}={}){
 const bound=scope(slot,demand),identity={origin:centerOrigin(connection?.origin),orgId:protocol.id(connection?.orgId),workerId:protocol.id(connection?.workerId)},dir=await resolutionDir(home),file=join(dir,protocol.hash([identity,demand.id])+'.json'),record=await readResolution(file);
 if(record.version!==1||!same(record.connection,identity)||!same(record.slot,bound)||record.demandHash!==protocol.hash(protocol.demand(demand)))throw pending('Original PMC resolution scope changed');
 const sourceStage=await stageFor({home,connection:identity,client,record,fetchPage}),checked=await sourceStage.verifyDemand({demand,slot:bound});return {identity:record.ids,sourceUrl:record.sourceUrl,jatsUrl:record.rule.url,licenseUrl:record.licenseUrl,resolutionHash:record.recordHash,...checked,sourceStage};
}
