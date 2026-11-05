// Conservative, optional rights verification for rssd-original-first-provider.
// Search metadata is never evidence. Only an explicitly trusted rights-holder
// origin can make the narrow, image-specific declaration described below.
// This module neither configures trusted origins nor connects to production.
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {publicAddress} from '../desktop/scripts/agent/notebook-images.mjs';
import {searchOriginalImageLeads} from './rssd-original-first-provider.mjs';
import protocol from '../contracts/rssd-v1.cjs';

const licenses=new Map([
 ['https://creativecommons.org/licenses/by/4.0/','CC BY 4.0'],
 ['https://creativecommons.org/publicdomain/zero/1.0/','CC0 1.0'],
]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const literal=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=300&&!/[\x00-\x1f"\\]/.test(x);
function validUrl(x){try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.port&&u.href===x;}catch{return false;}}
function query(scope){if(!literal(scope?.imageSearchQuery))throw Error('An explicit imageSearchQuery is required in the frozen image scope');return scope.imageSearchQuery;}

// Fetch exact HTTPS URL without redirects, pinning a public DNS result. A
// redirect is an unavailable read, not evidence about the configured origin.
export async function fetchExactRightsBytes(input,{maxBytes,accept,signal}={}){
 if(!validUrl(input)||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid exact rights fetch');
 signal?.throwIfAborted();const url=new URL(input),addresses=await lookup(url.hostname,{all:true});
 signal?.throwIfAborted();if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw Error('Public source required');
 return new Promise((resolve,reject)=>{
  const request=https.get(url,{headers:{Accept:accept||'*/*','User-Agent':'RSSD-Original-Rights-Verifier/1.0'},signal,lookup:(_host,options,callback)=>{const a=addresses[0];options?.all?callback(null,[a]):callback(null,a.address,a.family);}},response=>{
   if(response.statusCode!==200||Number(response.headers['content-length'])>maxBytes){response.resume();reject(Error('Exact rights source unavailable'));return;}
   const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)response.destroy(Error('Rights source too large'));else chunks.push(chunk);});
   response.on('error',reject);response.on('end',()=>resolve(Buffer.concat(chunks)));
  });
  const timeout=setTimeout(()=>request.destroy(Error('Rights source timeout')),20000);request.on('close',()=>clearTimeout(timeout));request.on('error',reject);
 });
}

// Keep the searched phrase inside the frozen scope that the verifier hashes.
export function createBoundOriginalSearch(search=searchOriginalImageLeads){
 if(typeof search!=='function')throw Error('Image search required');
 return async({scope,signal})=>{const result=await search({query:query(scope),signal});if(result?.complete!==true)throw Error('Image search incomplete');return result;};
}

// Recognizes a deliberately narrow JSON-LD ImageObject on an explicitly
// trusted rights-holder's own HTTPS origin. The description must be a literal
// and exact rights-holder declaration for this image, creator and license,
// including an explicit exclusion of separately licensed third-party content.
// The holder list is a trust configuration, not inferred from a search result.
export function rightsDeclaration(holder,creator,imageUrl,licenseUrl){
 return `The copyright holder ${holder} confirms that ${imageUrl} was created by ${creator}, is licensed under ${licenseUrl} for commercial reuse, and contains no third-party material requiring separate permission.`;
}
function evidenceFromPage(bytes,item,holders){
 if(!Buffer.isBuffer(bytes))throw Error('Invalid source response');
 const html=bytes.toString('utf8');if(!Buffer.from(html).equals(bytes))return null;
 // Multiple JSON-LD blocks are allowed, but each must independently establish
 // the whole claim. No values are inherited from unrelated page blocks.
 const scripts=html.matchAll(/<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script\s*>/gi);
 for(const match of scripts){
  let obj;try{obj=JSON.parse(match[1]);}catch{continue;}
  if(!obj||Array.isArray(obj)||obj['@context']!=='https://schema.org'||obj['@type']!=='ImageObject'||obj.contentUrl!==item.url||!licenses.has(obj.license))continue;
  const creator=obj.creator?.name,holder=obj.copyrightHolder?.name;
  if(obj.creator?.['@type']!=='Person'||obj.copyrightHolder?.['@type']!=='Organization'||!literal(creator)||!literal(holder)||!holders.includes(holder))continue;
  const quote=rightsDeclaration(holder,creator,item.url,obj.license);
  if(quote.length>2000||obj.description!==quote||!match[1].includes(quote)||!html.includes(item.url)||!html.includes(obj.license)||!html.includes(creator))continue;
  return {creator,licenseUrl:obj.license,license:licenses.get(obj.license),quote};
 }
 return null;
}

export function createAutomaticRightsVerifier({trustedSources,read=fetchExactRightsBytes,now=()=>new Date()}={}){
 if(!Array.isArray(trustedSources)||typeof read!=='function'||typeof now!=='function')throw Error('Explicit trusted source configuration required');
 const trusted=new Map();
 for(const source of trustedSources){
  if(!source||!validUrl(source.origin+'/')||new URL(source.origin).origin!==source.origin||!Array.isArray(source.holders)||!source.holders.length||source.holders.some(x=>!literal(x))||trusted.has(source.origin))throw Error('Invalid trusted rights-holder origin');
  trusted.set(source.origin,[...source.holders]);
 }
 return async function verify({scope,scopeHash,candidates,searchHash,signal}){
  query(scope);if(scopeHash!==protocol.hash(scope)||!Array.isArray(candidates)||searchHash!==protocol.hash(candidates)||candidates.length>100||candidates.some(x=>!x||!literal(x.id)||!validUrl(x.url)||!validUrl(x.sourceUrl))||new Set(candidates.map(x=>x.id)).size!==candidates.length)throw Error('Search or scope binding invalid');
  const date=now();if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw Error('Invalid verification time');
  const common={scopeHash,searchHash,reviewedBy:'automatic-original-rights-v1',reviewedAt:date.toISOString()};
  const outcomes=[];let incomplete=false;
  for(const item of candidates){
   signal?.throwIfAborted();const holders=trusted.get(new URL(item.sourceUrl).origin);
   if(!holders){outcomes.push({id:item.id,status:'unverified',reason:'source_not_configured_as_rights_holder'});continue;}
   let page;try{page=await read(item.sourceUrl,{maxBytes:2*1024*1024,accept:'text/html',signal});}catch(e){signal?.throwIfAborted();outcomes.push({id:item.id,status:'pending',reason:'source_read_failed'});incomplete=true;continue;}
   let data;try{data=evidenceFromPage(page,item,holders);}catch{outcomes.push({id:item.id,status:'pending',reason:'source_read_invalid'});incomplete=true;continue;}
   if(!data){outcomes.push({id:item.id,status:'unverified',reason:'rights_declaration_not_verified'});continue;}
   let image;try{image=await read(item.url,{maxBytes:12*1024*1024,accept:'image/*',signal});if(!Buffer.isBuffer(image))throw Error('Invalid image');}catch(e){signal?.throwIfAborted();outcomes.push({id:item.id,status:'pending',reason:'image_read_failed'});incomplete=true;continue;}
   try{const decoder=sharp(image,{failOn:'error',limitInputPixels:32000000});const info=await decoder.metadata();if(!info.width||!info.height||(info.pages||1)!==1||!['png','jpeg','webp'].includes(info.format))throw Error('unsupported image');await decoder.raw().toBuffer();}catch{outcomes.push({id:item.id,status:'unverified',reason:'image_bytes_invalid'});continue;}
   return {...common,status:'approved',candidateId:item.id,evidence:{rightsVerified:true,thirdPartyExcluded:true,intendedUse:'commercial-web',sourceUrl:item.sourceUrl,imageUrl:item.url,evidenceUrl:item.sourceUrl,...data,sourceSha256:sha(page),imageSha256:sha(image)},outcomes};
  }
  if(incomplete)return {...common,status:'pending',reason:'some_candidate_reads_incomplete',outcomes};
  return {...common,status:'none',reason:'All candidates checked; no candidate had verified usable rights under configured sources.',reviewedCandidateIds:candidates.map(x=>x.id),outcomes};
 };
}
