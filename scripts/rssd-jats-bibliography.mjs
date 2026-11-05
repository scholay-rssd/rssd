// Derive bibliographic fields only from already-frozen, verified source bytes.
// This module never reads a URL or changes an existing source snapshot.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import protocol from '../contracts/rssd-v1.cjs';
import {sourceSnapshotPrompt} from './rssd-source-snapshot.mjs';

const parser=fileURLToPath(new URL('./rssd-jats-bibliography.py',import.meta.url));
const adapter=fileURLToPath(import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pending=message=>Object.assign(Error(message),{code:'source_pending'});
const pmc=/^https:\/\/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/efetch\.fcgi\?db=pmc&id=[1-9][0-9]{0,10}&retmode=xml$/;
async function parserIdentity(){try{return protocol.hash({adapter:sha(await readFile(adapter)),parser:sha(await readFile(parser))});}catch{throw pending('Bibliography parser identity is unavailable');}}

async function parse(text,signal){
 if(signal?.aborted)throw pending('Bibliography extraction cancelled');
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/python3',['-I',parser],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','ignore']});
  let output='',settled=false;const timer=setTimeout(()=>finish(pending('Bibliography extraction timed out')),5000);
  const abort=()=>finish(pending('Bibliography extraction cancelled'));signal?.addEventListener('abort',abort,{once:true});
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){child.kill();reject(error);}else resolve(value);}
  child.on('error',()=>finish(pending('Bibliography parser unavailable')));
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>100000)finish(pending('Bibliography output too large'));});
  child.on('close',code=>{if(code!==0)return finish(pending('Bibliography parser failed'));try{const result=JSON.parse(output);if(result.error)throw Error();finish(null,result);}catch{finish(pending('JATS bibliography is incomplete or ambiguous'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({text}));if(signal?.aborted)abort();
 });
}

/**
 * snapshot is exactly the `snapshot` returned by sourceStage.restore, with
 * records[].text included. Every byte, selected source and task binding is
 * checked by the existing snapshot verifier before any metadata is read.
 * Non-PMC sources retain their original title/link without invented metadata.
 */
export async function extractJatsBibliography(snapshot,{signal}={}){
 sourceSnapshotPrompt(snapshot,{maxBytes:2*1024*1024});
 const parserCodeSha256=await parserIdentity(),entries=[];
 for(const record of snapshot.records){
  if(signal?.aborted)throw pending('Bibliography extraction cancelled');
  const base={sourceUrl:record.url,title:record.title,textSha256:record.textSha256,...(record.aliases?{aliases:[...record.aliases]}:{})};
  if(!pmc.test(record.url)){entries.push({kind:'link-only',...base});continue;}
  if(!['text/xml','application/xml'].includes(record.contentType)||!record.identityEvidenceHash||!Array.isArray(record.aliases))throw pending('PMC bibliography lacks verified article identity');
  const article=await parse(record.text,signal),doiUrl='https://doi.org/'+String(article.doi||'').toLowerCase();
  if(article.title!==record.title||record.aliases.filter(url=>url.startsWith('https://doi.org/')).length!==1||!record.aliases.includes(doiUrl))throw pending('JATS bibliography differs from the frozen source identity');
  entries.push({kind:'jats',...base,doiUrl,authors:article.authors,year:article.year,journal:article.journal,volume:article.volume,location:article.location});
 }
 if(await parserIdentity()!==parserCodeSha256)throw pending('Bibliography parser changed during extraction');
 const body={version:1,snapshotHash:snapshot.snapshotHash,parserCodeSha256,entries};
 return {...body,metadataHash:protocol.hash(body)};
}

/** Re-derive from frozen bytes rather than trusting a saved or model-supplied record. */
export async function verifyJatsBibliography(snapshot,metadata,options){
 const actual=await extractJatsBibliography(snapshot,options);
 if(protocol.canonical(actual)!==protocol.canonical(metadata))throw pending('Frozen bibliography metadata no longer matches the original source');
 return actual;
}
