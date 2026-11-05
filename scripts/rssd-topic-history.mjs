// Read-only, site-scoped public history. Center demands and works must also be
// independently inventoried by the scheduler before a candidate is staged.
import {createHash} from 'node:crypto';
import {fetchPublicText} from './rssd-topic-public.mjs';

const sites=Object.freeze({
 'scholay-today':['academic','https://today.scholay.com','academic'],
 lingxi:['lingxi','https://xsime.com','journal'],piggytuck:['design','https://www.piggytuck.com','journal'],
 personal:['personal','https://pm.scholay.com','journal'],pets:['pets','https://pet.piggytuck.com','journal'],
 legis:['legis','https://legis.wiki','journal'],metho:['metho','https://metho.scholay.com','journal'],
 enter:['enter','https://enter.scholay.com','journal'],xsiching:['xsiching','https://xsiching.com','journal'],study:['study','https://study.scholay.com','journal']
});
const digest=value=>createHash('sha256').update(value).digest('hex');
const decode=value=>value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,(_,v)=>{
 if(v[0]==='#'){const n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10);if(!Number.isInteger(n)||n<1||n>0x10ffff||(n>=0xd800&&n<=0xdfff))throw Error('Invalid entity');return String.fromCodePoint(n);}
 const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',middot:'·',bull:'•'};
 const result=entities[v.toLowerCase()];if(result===undefined)throw Error('Unsupported entity &'+v+';');return result;
});
function locs(xml,kind){
 if(typeof xml!=='string'||xml.length>4*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||!new RegExp('<'+kind+'(?:\\s|>)','i').test(xml))throw Error('Invalid sitemap');
 const tag=kind==='urlset'?'url':'sitemap',n=[...xml.matchAll(new RegExp('<'+tag+'(?:\\s|>)','gi'))].length;
 const values=[...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(x=>decode(x[1]));
 const closed=[...xml.matchAll(new RegExp('</'+tag+'\\s*>','gi'))].length;if(!new RegExp('</'+kind+'\\s*>','i').test(xml)||!n||n!==closed||n!==values.length||new Set(values).size!==values.length)throw Error('Invalid sitemap entries');return values;
}
function articleRoute(value,origin,academic){
 const url=new URL(value,origin);const valid=/^\/(?:news|calendar|history|open-source)\/[^/]+\/$/;
 if(url.origin!==origin||url.search||url.hash||!valid.test(url.pathname)||/%2f|%5c|%2e/i.test(url.pathname))throw Error('Invalid public history route');return url.href;
}
function entriesFromPage(html,page,origin,academic){
 const count=academic?html.match(/id=["']archive-result-count["'][^>]*>\s*(\d+)\s*篇\s*·\s*第\s*(\d+)\s*\/\s*(\d+)\s*页/):html.match(/id=["']feed-count["'][^>]*>\s*(\d+)\s*条内容\s*·\s*第\s*(\d+)\s*\/\s*(\d+)\s*页/);
 if(!count||Number(count[2])!==page)throw Error('Archive pagination missing or incorrect');
 const entries=[];const cls=academic?'archive-record':'feed-entry';
 const re=new RegExp('<article\\b[^>]*class=["\'][^"\']*\\b'+cls+'\\b[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/article>','gi');
 for(const m of html.matchAll(re)){
  const match=academic?m[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/i):m[1].match(/<h2\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
  if(!match)throw Error('Archive article title missing');const title=decode(match[2].replace(/<[^>]*>/g,'')).trim();
  if(!title||title.length>1000)throw Error('Invalid archive title');entries.push({url:articleRoute(decode(match[1]),origin,academic),title});
 }
 return {total:Number(count[1]),pages:Number(count[3]),entries};
}
async function parallelMap(items,limit,fn){const out=Array(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const i=cursor++;out[i]=await fn(items[i]);}}));return out;}

/** Short-lived, memory-only cache. Fresh exact sitemap and public title-index fingerprints are
 * mandatory even on a hit; errors never fall back to stale entries. */
export function createPublicHistoryAdapter({fetchPage,clock=Date.now,cacheMs=300000,maxPages=200,concurrency=4,maxDurationMs=120000}={}){
 if(!Number.isSafeInteger(cacheMs)||cacheMs<0||cacheMs>300000||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>200||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>6||!Number.isSafeInteger(maxDurationMs)||maxDurationMs<1000||maxDurationMs>300000)throw Error('Invalid history limits');
 const cache=new Map();
 const load=fetchPage||((url)=>fetchPublicText(url,{proxyMode:'configured-rss',configuredRssHost:new URL(url).hostname,timeoutMs:12000,maxBytes:4*1024*1024}));
 return async function publicCatalog({slot,signal}={}){
  const spec=sites[slot?.siteId];if(!spec||slot.workspaceId!==spec[0])throw Error('Unknown or mismatched site history scope');
  const [workspaceId,origin,theme]=spec,academic=theme==='academic',started=Number(clock());
  if(!Number.isFinite(started))throw Error('Invalid history clock');
  const get=async path=>{
   const url=origin+path;let r;
   for(let attempt=0;attempt<2;attempt++){
    if(signal?.aborted)throw Object.assign(Error('History collection cancelled'),{name:'AbortError'});
    if(Number(clock())-started>maxDurationMs)throw Error('History collection timed out');
    try{r=await load(url);break;}catch(error){if(attempt||!(error?.code==='ECONNRESET'||error?.code==='ETIMEDOUT'||/timed out|disconnected before secure TLS/i.test(error?.message||'')))throw error;}
   }
   if(Number(clock())-started>maxDurationMs)throw Error('History collection timed out');
   if(!r?.reachable||r.finalUrl!==url||typeof r.text!=='string'||Buffer.byteLength(r.text)>4*1024*1024)throw Error('Public history unavailable or redirected');return r.text;
  };
  const mapPath=academic?'/sitemap.xml':'/sitemap-content.xml',indexPath=academic?'/archive-index.json':'/content-feed-index.json';
  const initial=await get(mapPath),hash=digest(initial),indexText=await get(indexPath),indexHash=digest(indexText),now=Number(clock());
  if(!Number.isFinite(now))throw Error('Invalid history clock');
  const old=cache.get(slot.siteId);if(old&&old.hash===hash&&old.indexHash===indexHash&&now>=old.storedAt&&now-old.storedAt<=cacheMs)return {...structuredClone(old.catalog),fetchedAt:new Date(now).toISOString(),cacheHit:true};
  let sitemap=[];
  if(academic){
   const maps=locs(initial,'sitemapindex').map(value=>new URL(value));if(maps.some(u=>u.origin!==origin||u.search||u.hash))throw Error('Unexpected sitemap index origin');
   const selected=maps.filter(u=>/^\/sitemap-(?:calendar|history|open-source|news)(?:-\d+)?\.xml$/.test(u.pathname));
   for(const name of ['calendar','history','open-source','news'])if(!selected.some(u=>new RegExp('^/sitemap-'+name+'(?:-\\d+)?\\.xml$').test(u.pathname)))throw Error('Academic sitemap shard missing');
   if(selected.length>100)throw Error('Too many sitemap shards');
   const shards=await parallelMap(selected,concurrency,u=>get(u.pathname));
   sitemap=shards.flatMap(xml=>locs(xml,'urlset').map(x=>articleRoute(x,origin,true)));
  }else sitemap=locs(initial,'urlset').filter(x=>{const u=new URL(x);if(u.origin!==origin)throw Error('Unexpected sitemap origin');return /^\/(?:news|calendar|history|open-source)\/[^/]+\/$/.test(u.pathname);}).map(x=>articleRoute(x,origin,false));
  if(!sitemap.length||new Set(sitemap).size!==sitemap.length)throw Error('Empty or duplicate content sitemap');
  let feedIndex;try{feedIndex=JSON.parse(indexText);}catch{throw Error('Public feed index unavailable');}if(!Array.isArray(feedIndex?.records)||(!academic&&(feedIndex.siteId!==slot.siteId||feedIndex.version!==1)))throw Error('Public feed index scope invalid');
  const first=entriesFromPage(await get('/archive/'),1,origin,academic);
  if(!Number.isSafeInteger(first.total)||first.total<1||!Number.isSafeInteger(first.pages)||first.pages<1||first.pages>maxPages)throw Error('Archive exceeds supported bounds');
  const rest=await parallelMap(Array.from({length:first.pages-1},(_,i)=>i+2),concurrency,async n=>entriesFromPage(await get('/archive/page/'+n+'/'),n,origin,academic));
  if(rest.some(p=>p.pages!==first.pages||p.total!==first.total))throw Error('Archive changed during collection');
  const entries=[...first.entries,...rest.flatMap(x=>x.entries)],ids=new Set(entries.map(x=>x.url)),expected=new Set(sitemap);
  if(entries.length!==first.total||ids.size!==entries.length||ids.size!==expected.size||[...ids].some(x=>!expected.has(x)))throw Error('Archive and sitemap do not match');
  if(feedIndex){const records=feedIndex.records.map(x=>({url:articleRoute(x.route,origin,academic),title:x.title}));const index=new Map(records.map(x=>[x.url,x.title]));if(records.length!==entries.length||index.size!==records.length||entries.some(x=>index.get(x.url)!==x.title))throw Error('Archive and public feed index do not match');}
  if(digest(await get(mapPath))!==hash||digest(await get(indexPath))!==indexHash)throw Error('Public history changed during collection');
  const finished=Number(clock());if(!Number.isFinite(finished)||finished<now)throw Error('Invalid history clock');
  const catalog={siteId:slot.siteId,workspaceId,origin,complete:true,fetchedAt:new Date(finished).toISOString(),titles:entries.map(x=>x.title),entries,cacheHit:false};cache.set(slot.siteId,{hash,indexHash,storedAt:finished,catalog:structuredClone(catalog)});return catalog;
 };
}
