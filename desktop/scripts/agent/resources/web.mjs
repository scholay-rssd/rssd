import {createHash} from 'node:crypto';
import {fetchPublicBytes} from '../notebook-images.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
export function publicHttpUrl(value){
 try{
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
  if(/^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(url.hostname))return null;
  return url.href;
 }catch{return null;}
}
function extractDate(html){
 const props=['article:published_time','datePublished','pubdate','publish-date','DC.date'];
 for(const name of props){
  const match=html.match(new RegExp(`(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["']`,'i'))||html.match(new RegExp(`content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,'i'));
  if(match?.[1])return {date:match[1],basis:'页面标注的发布日期'};
 }
 const time=html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
 if(time)return {date:time[1],basis:'页面 time 元素'};
 return {date:null,basis:'页面未提供发布日期，抓取时间不能当作发表日期'};
}
function extractTitle(html,url){
 return (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()||new URL(url).hostname;
}
function extractText(html){
 return html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
export async function readPublicPage(url,fetcher=fetch,{maxBytes=800000}={}){
 const href=publicHttpUrl(url);if(!href)throw Error('请输入可公开访问的 http(s) 网址');
 let response;
 try{
  if(fetcher===fetch){
   // Reuse the existing DNS-pinned, size-bounded public fetch transport. It
   // validates every redirect before opening another connection.
   response=new Response(await fetchPublicBytes(href,{maxBytes,accept:'text/html,application/xhtml+xml,text/plain'}));
  }else{
   let next=href;
   for(let hops=0;;hops++){
    response=await fetcher(next,{redirect:'manual',headers:{Accept:'text/html,application/xhtml+xml'},signal:AbortSignal.timeout(20000)});
    if(![301,302,303,307,308].includes(response.status))break;
    const location=response.headers.get('location');
    next=location&&publicHttpUrl(new URL(location,next).href);
    if(!next||hops>=4)throw Error('重定向地址无效');
   }
  }
 }
 catch{throw Error('无法读取网页：'+href);}
 if(!response.ok)throw Error('网页不可用（'+response.status+'）：'+href);
 const type=String(response.headers.get('content-type')||'');
 if(type&&!/html|xml|text\/plain/i.test(type))throw Error('该地址不是可提取的网页文本');
 const buf=Buffer.from(await response.arrayBuffer());
 if(buf.length>maxBytes)throw Error('网页过大，已停止读取');
 const html=buf.toString('utf8');
 const pageText=extractText(html);
 // A 200 response may be an interstitial rather than the requested document.
 // Keep this as a failed read; never turn a security challenge into evidence.
 if(/checking (?:the security of your|your browser|your) (?:connection|browser)|verify (?:that )?you are human|enable javascript and cookies to continue|just a moment|access denied/i.test(extractTitle(html,href)+' '+pageText.slice(0,1200)))throw Error('网页返回访问验证页，未读取正文：'+href);
 const date=extractDate(html);
 const text=pageText.slice(0,20000);
 return {
  url:href,title:extractTitle(html,href),text,truncated:pageText.length>20000,
  publishedAt:date.date,dateBasis:date.basis,contentHash:hash(text||href),fetchedBytes:buf.length,
 };
}
export function webSearchCandidate(query,extra={}){
 const q=String(query||'').trim();if(!q||q.length>300)throw Error('请填写搜索词');
 return {kind:'web',title:'搜索：'+q,summary:'搜索结果先进入候选；读取页面片段后才能作为证据。',locator:{query:q,site:extra.site||null,freshness:extra.freshness||null},acquiredVia:'search'};
}
export function knownUrlCandidate(url,title=''){
 const href=publicHttpUrl(url);if(!href)throw Error('请输入可公开访问的网址');
 return {kind:'web',title:title||href,summary:'已知网址，读取后成为证据。',locator:{url:href},acquiredVia:'url'};
}
export async function resolveWebMount(input,fetcher=fetch){
 if(input.query&&!input.url){
  const candidate=webSearchCandidate(input.query,input);
  return {kind:'web',title:candidate.title,locator:candidate.locator,version:{contentHash:hash(input.query),label:'search',snapshot:{query:input.query,results:'candidates-only'}},state:'ready',scope:{mode:'search',query:input.query},role:'lead'};
 }
 const page=await readPublicPage(input.url,fetcher);
 return {
  kind:'web',title:page.title,locator:{url:page.url},
  version:{contentHash:page.contentHash,label:'page',snapshot:{url:page.url,title:page.title,publishedAt:page.publishedAt,dateBasis:page.dateBasis,truncated:page.truncated}},
  state:page.text?'ready':'partial',
  scope:{mode:'url',url:page.url},
  page,
 };
}
