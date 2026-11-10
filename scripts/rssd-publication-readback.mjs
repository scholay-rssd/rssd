// Read-only verification of the exact receiver publication IDs produced by the
// original Center submission. No retry, submission or credential leaves Center.
import protocol from '../contracts/rssd-v1.cjs';
import {fetchPublicText} from './rssd-topic-public.mjs';
import {articleBodyOnPage} from './website-article-readback.mjs';
import {forumUrl} from './community-link-policy.mjs';

const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const abort=signal=>{if(signal?.aborted)throw Object.assign(Error('Publication readback cancelled'),{name:'AbortError'});};
const safeReason=error=>error?.status===401||error?.status===403?'center_access_denied':error?.status>=400&&error?.status<500&&error?.status!==408&&error?.status!==429?'center_request_rejected':'center_unavailable';
function canonicalOnPage(html,url){return [...html.matchAll(/<link\b[^>]*>/gi)].some(([tag])=>/\brel\s*=\s*["']canonical["']/i.test(tag)&&[...tag.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].some(m=>m[1]===url));}
export function createPublicationReadbackAdapter({client,profiles,fetchPage=fetchPublicText,bodyOnPage=articleBodyOnPage}){
 if(!client||typeof client.publications!=='function'||!Array.isArray(profiles)||typeof fetchPage!=='function'||typeof bodyOnPage!=='function')throw Error('Scoped Center and public readback adapters required');
 const sites=new Map(profiles.map(p=>[p.id,p]));
 return async({slot,work,signal})=>{
  abort(signal);const profile=sites.get(slot.siteId);let origin;try{origin=new URL(profile.origin);if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw Error();}catch{return {state:'blocked',reason:'site_origin_invalid'};}
  if(profile.spaceId!==slot.workspaceId||!Array.isArray(work.publications)||work.publications.length!==slot.requiredLocales.length)return {state:'blocked',reason:'publication_identity_missing'};
  const wanted=new Set(work.publications.map(x=>x.id));if(wanted.size!==slot.requiredLocales.length)return {state:'blocked',reason:'publication_identity_invalid'};
  const found=new Map();
  try{for(let offset=0;offset<=1000000;offset+=200){abort(signal);const page=await client.publications({workspaceId:slot.workspaceId,limit:200,offset});if(!Array.isArray(page)||page.length>200)throw Error('Invalid publication page');for(const row of page){if(row?.workspaceId!==slot.workspaceId||!row?.id||found.has(row.id))throw Error('Publication page scope changed');found.set(row.id,row);}if(page.length<200)break;if(offset===1000000)throw Error('Publication inventory exceeded');}}
  catch(error){abort(signal);const reason=safeReason(error);return {state:reason==='center_unavailable'?'pending':'blocked',reason};}
  const urls=[];
  for(const identity of work.publications){
   const row=found.get(identity.id);if(!row)return {state:'pending',reason:'publication_not_visible'};
   if(row.workspaceId!==slot.workspaceId||row.workId!==work.workId||row.destinationId!==slot.destinationId||row.locale!==identity.locale||row.revision!==identity.revision)return {state:'blocked',reason:'publication_identity_mismatch'};
   if(['queued','dispatching'].includes(row.state))return {state:'pending',reason:'receiver_pending'};
   if(row.state!=='published')return {state:'blocked',reason:row.state==='blocked'?'receiver_blocked':'receiver_unexpected_state'};
   const r=row.receipt;if(r?.state!=='success'||r.requestId!==identity.id||r.siteId!==slot.siteId||r.workId!==work.workId||r.locale!==identity.locale||r.revision!==identity.revision||r.contentHash!==identity.contentHash||!hex(r.packetHash))return {state:'blocked',reason:'receiver_receipt_mismatch'};
   const expectedData=origin.origin+'/rssd-content/'+protocol.hash([work.workId,identity.locale])+'.json';
   if(r.publicUrl!==expectedData||typeof r.url!=='string')return {state:'blocked',reason:'receiver_url_mismatch'};
   let url;try{url=new URL(r.url);if(url.origin!==origin.origin||url.search||url.hash||!/^\/(?:[A-Za-z0-9_\-\u0080-\uFFFF]+\/)+$/.test(url.pathname))throw Error();}catch{return {state:'blocked',reason:'receiver_url_mismatch'};}
   let data,page;
   try{
    const options={proxyMode:'configured-rss',configuredRssHost:origin.hostname,timeoutMs:12000,maxBytes:4*1024*1024,maxRedirects:0};
    const fetched=await fetchPage(expectedData,options);abort(signal);if(!fetched?.reachable||fetched.finalUrl!==expectedData||typeof fetched.text!=='string')throw Error('Content unavailable');data=JSON.parse(fetched.text);
    page=await fetchPage(url.href,options);abort(signal);if(!page?.reachable||page.finalUrl!==url.href||typeof page.text!=='string')throw Error('Page unavailable');
   }catch(error){abort(signal);return {state:'pending',reason:'public_readback_unavailable'};}
   if(protocol.hash(data)!==r.packetHash||data.requestId!==identity.id||data.siteId!==slot.siteId||data.workspaceId!==slot.workspaceId||data.sectionId!==slot.sectionId||data.workId!==work.workId||data.locale!==identity.locale||data.revision!==identity.revision||data.contentHash!==identity.contentHash||data.route!==url.pathname||typeof data.content?.bodyMarkdown!=='string')return {state:'blocked',reason:'public_content_mismatch'};
   if(!canonicalOnPage(page.text,url.href)||!bodyOnPage(page.text,data.content.bodyMarkdown,profile))return {state:'pending',reason:'public_page_not_converged'};
   urls.push({locale:identity.locale,url:url.href,publicationId:identity.id});
  }
  // The historic flow required the owned-site route-to-discussion map after
  // publication. This is a read-only check: never create a forum topic, start
  // an old writer, or dispatch an external social post.
  if(slot.requireFlow===true){
   const chinese=urls.find(x=>x.locale==='zh-CN');if(!chinese)return {state:'blocked',reason:'community_source_missing',publicUrls:urls};
   const path=new URL(chinese.url).pathname,mapUrl=origin.origin+'/community/links.json';let map;
   try{
    const response=await fetchPage(mapUrl,{proxyMode:'configured-rss',configuredRssHost:origin.hostname,timeoutMs:12000,maxBytes:2*1024*1024,maxRedirects:0});abort(signal);
    if(!response?.reachable||response.finalUrl!==mapUrl||typeof response.text!=='string')throw Error('Community map unavailable');map=JSON.parse(response.text);
    if(map?.version!==1||!map.links||typeof map.links!=='object'||Array.isArray(map.links))throw Error('Invalid community map');
   }catch(error){abort(signal);return {state:'pending',reason:'community_mapping_unavailable',publicUrls:urls};}
   const raw=Object.hasOwn(map.links,path)?map.links[path]:null;
   if(!raw)return {state:'pending',reason:'community_link_pending',publicUrls:urls};
   const communityUrl=forumUrl(raw);if(!communityUrl)return {state:'blocked',reason:'community_link_invalid',publicUrls:urls};
   return {state:'verified',reason:'receiver_public_pages_and_community_confirmed',urls,communityUrl};
  }
  return {state:'verified',reason:'receiver_and_public_page_confirmed',urls};
 };
}
