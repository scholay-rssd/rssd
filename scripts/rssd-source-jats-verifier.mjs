// Trusted host configuration, not model-generated instructions, determines the
// exact source URLs, identifiers, structure and permitted reuse declarations.
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import protocol from '../contracts/rssd-v1.cjs';
import {publicHttpsUrl} from './rssd-topic-public.mjs';

const script=fileURLToPath(new URL('./rssd-source-jats-verifier.py',import.meta.url));
const self=fileURLToPath(import.meta.url);
const licenses=new Set(['https://creativecommons.org/licenses/by/4.0/','https://creativecommons.org/publicdomain/zero/1.0/']);
function rulesOf(input){
 if(!Array.isArray(input)||!input.length||input.length>100)throw Error('Explicit trusted original-source rules required');const seen=new Set();
 return input.map(r=>{const url=publicHttpsUrl(r?.url).href,byType=Array.isArray(r?.requiredSections),byTitle=Array.isArray(r?.requiredSectionTitles),sections=byType?r.requiredSections:r?.requiredSectionTitles;if(url!==r.url||seen.has(url)||!/^[a-zA-Z0-9._-]{1,40}$/.test(r.idType||'')||!/^[a-zA-Z0-9._/-]{1,200}$/.test(r.articleId||'')||!Array.isArray(r.licenseUrls)||!r.licenseUrls.length||r.licenseUrls.some(x=>!licenses.has(x))||byType===byTitle||!sections.length||sections.some(x=>typeof x!=='string'||(byType?!/^[a-z-]{2,40}$/.test(x):!x.trim()||x.length>300||x!==x.trim()))||new Set(sections).size!==sections.length||!Number.isSafeInteger(r.minSectionCharacters)||r.minSectionCharacters<100||r.minSectionCharacters>100000)throw Error('Invalid source verification rule');seen.add(url);return {url,idType:r.idType,articleId:r.articleId,licenseUrls:[...r.licenseUrls].sort(),...(byType?{requiredSections:[...sections].sort()}:{requiredSectionTitles:[...sections].sort()}),minSectionCharacters:r.minSectionCharacters};});
}
function run(input,signal){return new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/python3',['-I',script],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','ignore']});let out='',done=false;const timer=setTimeout(()=>finish(Error('JATS verification timed out')),5000);const abort=()=>finish(Error('JATS verification cancelled'));signal?.addEventListener('abort',abort,{once:true});
 function finish(error,value){if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){child.kill();reject(error);}else resolve(value);}
 child.on('error',e=>finish(e));child.stdout.on('data',chunk=>{out+=chunk;if(out.length>10000)finish(Error('JATS verifier output exceeded limit'));});child.on('close',code=>{if(code!==0)return finish(Error('JATS verifier unavailable'));try{finish(null,JSON.parse(out));}catch{finish(Error('JATS verifier invalid response'));}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));if(signal?.aborted)abort();
 });}

/** Rules must be curated from the original provider, with a known stable full
 * text format and exact article identity; no domain-wide blanket trust. */
export async function createJatsSourceVerifier({rules,clock=()=>new Date()}={}){
 const normalized=rulesOf(rules),hash=createHash('sha256').update(await readFile(self)).update(await readFile(script)).update(protocol.canonical(normalized)).digest('hex'),pin={id:'jats-original-structure',version:'1',codeSha256:hash};
 return {...pin,async assess({candidate,text,textSha256,contentType,signal}){
  const now=clock();if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('Invalid verification clock');const rule=normalized.find(x=>x.url===candidate?.url);
  let verdict={ok:false,reason:'URL or document type is outside the configured original source'};
  if(rule&&['application/xml','text/xml'].includes(contentType))verdict=await run({text,rule},signal);
  const ok=verdict.ok===true;return {sourceUrl:candidate.url,observedTextSha256:textSha256,verifier:pin,coverage:ok?'full_text':'unknown',access:ok?'public':'unknown',readable:ok,primarySource:ok,reason:ok?'Configured original JATS article, expected full sections and explicit public license were found.':String(verdict.reason||'Source structure unavailable').slice(0,2000),assessedAt:now.toISOString(),...(ok?{evidenceQuote:verdict.quote,evidenceDetails:{format:'jats',idType:rule.idType,articleId:rule.articleId,licenseUrl:verdict.licenseUrl,...(rule.requiredSections?{requiredSections:rule.requiredSections}:{requiredSectionTitles:rule.requiredSectionTitles}),minSectionCharacters:rule.minSectionCharacters}}:{})};
 }};
}
