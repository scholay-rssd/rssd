// Read-only public evidence for RSSD topic discovery. A successful fetch is
// evidence of reachability, not proof that a source supports a proposed claim.
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {BlockList,isIP} from 'node:net';

const blocked=new BlockList();
for(const [base,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(base,prefix,'ipv4');
for(const [base,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked.addSubnet(base,prefix,'ipv6');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');
const syntheticProxy=new BlockList();syntheticProxy.addSubnet('198.18.0.0',15,'ipv4');
// These are exact hostnames, not suffix or wildcard matches. DNS exceptions
// apply only to the local Surge synthetic range and keep full TLS validation.
export const authoritativeHosts=Object.freeze(['doi.org','www.doi.org','eutils.ncbi.nlm.nih.gov','pubmed.ncbi.nlm.nih.gov','pmc.ncbi.nlm.nih.gov','www.ncbi.nlm.nih.gov','www.cochrane.org','training.cochrane.org','methods.cochrane.org','www.equator-network.org','www.bmj.com','www.nejm.org','www.nature.com','jamanetwork.com','www.who.int','www.cdc.gov']);
const proxyHosts={metho:new Set(['metho.scholay.com']),authoritative:new Set(authoritativeHosts)};
export function isPublicAddress(address){
 const family=isIP(address);if(family===4)return !blocked.check(address,'ipv4');
 if(family===6)return global6.check(address,'ipv6')&&!blocked.check(address,'ipv6');
 return false;
}
export function publicHttpsUrl(value){
 let u;try{u=new URL(value);}catch{throw Error('Invalid public URL');}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443')throw Error('Only public HTTPS URLs on port 443 are allowed');
 const host=u.hostname.replace(/^\[|\]$/g,'');if(isIP(host)&&!isPublicAddress(host))throw Error('Private IP address is not allowed');
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))throw Error('Local hostname is not allowed');
 return u;
}

/** Resolve every hop, reject any nonpublic resolution and pin the TLS request
 * to the resolved IP. The original hostname remains the TLS server name. */
export async function fetchPublicText(value,{resolve=lookup,request=httpsRequest,timeoutMs=12000,maxBytes=1024*1024,maxRedirects=3,proxyMode=null,configuredRssHost=null}={}){
 if(proxyMode!==null&&proxyMode!=='configured-rss'&&!Object.hasOwn(proxyHosts,proxyMode))throw Error('Unknown trusted proxy mode');
 let url=publicHttpsUrl(value);
 // Only the adapter that selected an exact existing RSS subscription may
 // supply this exception. Redirects stay on that exact HTTPS hostname.
 if(proxyMode==='configured-rss'&&(!configuredRssHost||configuredRssHost!==url.hostname||isIP(configuredRssHost)))throw Error('Configured RSS hostname does not match the source');
 const trustedHosts=proxyMode==='configured-rss'?new Set([configuredRssHost]):proxyHosts[proxyMode];
 for(let hop=0;hop<=maxRedirects;hop++){
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(proxyMode&&!trustedHosts.has(host))throw Error('Trusted source cannot redirect to an unlisted hostname');
  let timer;const answers=isIP(host)?[{address:host,family:isIP(host)}]:await Promise.race([resolve(host,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS resolution timed out')),timeoutMs);})]).finally(()=>clearTimeout(timer));
  // Surge may return 198.18/15 for selected exact hosts. No general private
  // IP exception exists; HTTPS verification still checks the original host.
  const permitted=a=>isPublicAddress(a.address)||(proxyMode&&trustedHosts.has(host)&&isIP(a.address)===4&&syntheticProxy.check(a.address,'ipv4'));
  if(!Array.isArray(answers)||!answers.length||answers.some(a=>!permitted(a)))throw Error('Source DNS did not resolve exclusively to public addresses');
  const address=answers[0];
  const response=await new Promise((resolveResponse,reject)=>{
   let settled=false,total=0,chunks=[],timer;
   const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolveResponse(result);};
   const req=request(url,{agent:false,family:address.family,autoSelectFamily:false,headers:{'User-Agent':'RSSD-topic-reader/1.0','Accept':'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,text/plain;q=0.9','Accept-Encoding':'identity'},lookup:(_host,_options,cb)=>cb(null,address.address,address.family)},res=>{
    const status=res.statusCode||0,location=res.headers.location;
    if(status>=300&&status<400){res.resume();return finish(null,{status,location});}
    if(status!==200){res.resume();return finish(Object.assign(Error('Public source HTTP '+status),{status}));}
    const type=String(res.headers['content-type']||'').split(';')[0].toLowerCase();
    if(!['text/html','text/plain','application/xhtml+xml','application/xml','text/xml','application/json','application/rss+xml','application/atom+xml'].includes(type)){res.resume();return finish(Error('Unsupported public source content type'));}
    res.on('data',chunk=>{total+=chunk.length;if(total>maxBytes){req.destroy();finish(Error('Public source exceeds size limit'));}else chunks.push(chunk);});
    res.on('end',()=>finish(null,{status,type,text:Buffer.concat(chunks).toString('utf8')}));res.on('error',e=>finish(e));
   });
   timer=setTimeout(()=>{req.destroy();finish(Error('Public source timed out'));},timeoutMs);
   req.on('error',e=>finish(e));req.end();
  });
  if(response.status>=300&&response.status<400){if(!response.location||hop===maxRedirects)throw Error('Public source redirect limit exceeded');url=publicHttpsUrl(new URL(response.location,url).href);continue;}
  return {reachable:true,originalUrl:String(value),finalUrl:url.href,contentType:response.type,text:response.text};
 }
 throw Error('Public source redirect limit exceeded');
}
// Reachability and fetched text are not semantic verification. The caller must
// separately assess whether the specific source actually supports the topic.
export const fetchAuthoritativeSource=(url,options={})=>fetchPublicText(url,{...options,proxyMode:'authoritative'});

function decode(value){
 return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,key)=>{
  if(key[0]==='#'){const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);if(!Number.isInteger(n)||n<1||n>0x10ffff||n>=0xd800&&n<=0xdfff)throw Error('Invalid HTML entity');return String.fromCodePoint(n);}
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[key.toLowerCase()];
 }).replace(/&(?:#[a-z0-9]+|[a-z][a-z0-9]+);/gi,()=>{throw Error('Unsupported HTML entity');});
}
const origin='https://metho.scholay.com';
export class CatalogSnapshotChangedError extends Error {
 constructor(){super('Archive changed during collection');this.name='CatalogSnapshotChangedError';}
}
function route(raw){
 const url=new URL(decode(raw),origin);
 if(url.origin!==origin||url.search||url.hash||!/^\/news\/[^/]+\/$/.test(url.pathname))throw Error('Invalid archive article route');
 return url.href;
}
function sitemapRoutes(xml){
 if(!/<urlset\b/i.test(xml))throw Error('Invalid sitemap');
 const routes=[];for(const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)){
  const url=new URL(decode(m[1]));if(url.origin!==origin)throw Error('Unexpected sitemap origin');
  if(url.pathname.startsWith('/news/'))routes.push(route(m[1]));
 }
 if(!routes.length||new Set(routes).size!==routes.length)throw Error('Empty or duplicate sitemap routes');return routes;
}
function archivePage(html,page){
 const count=html.match(/id=["']feed-count["'][^>]*>\s*(\d+)\s*条内容\s*·\s*第\s*(\d+)\s*\/\s*(\d+)\s*页/);
 if(!count||Number(count[2])!==page)throw Error('Archive page count missing or incorrect');
 const entries=[];
 for(const item of html.matchAll(/<article\b[^>]*class=["'][^"']*\bfeed-entry\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)){
  const heading=item[1].match(/<h2\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
  if(!heading)throw Error('Archive title missing');
  const title=decode(heading[2].replace(/<[^>]*>/g,'')).trim();if(!title)throw Error('Archive title empty');
  entries.push({url:route(heading[1]),title});
 }
 if(!entries.length)throw Error('Archive page has no entries');
 return {total:Number(count[1]),pages:Number(count[3]),entries};
}

/** Fresh complete Chinese news catalog, fail closed on every disagreement. */
export async function fetchMethoCatalog({fetchPage=url=>fetchPublicText(url,{proxyMode:'metho'}),maxPages=50,now=()=>new Date(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const get=async path=>{const expected=origin+path,r=await fetchPage(expected);if(!r?.reachable||r.finalUrl!==expected||typeof r.text!=='string')throw Error('Archive response unavailable or redirected');return r.text;};
 const delays=[5000,15000];
 for(let attempt=0;;attempt++){
  try{return await collectMethoCatalog({get,maxPages,now});}
  catch(error){
   if(!(error instanceof CatalogSnapshotChangedError)||attempt>=delays.length)throw error;
   await wait(delays[attempt]);
  }
 }
}
async function collectMethoCatalog({get,maxPages,now}){
 const sitemap=sitemapRoutes(await get('/sitemap-content.xml'));
 const first=archivePage(await get('/archive/'),1);
 if(!Number.isSafeInteger(first.pages)||first.pages<1||first.pages>maxPages||first.total<1)throw Error('Invalid archive pagination');
 const entries=[...first.entries];
 for(let n=2;n<=first.pages;n++){const page=archivePage(await get('/archive/page/'+n+'/'),n);if(page.total!==first.total||page.pages!==first.pages)throw new CatalogSnapshotChangedError();entries.push(...page.entries);}
 const ids=new Set(entries.map(e=>e.url)),routes=new Set(sitemap);
 if(entries.length!==first.total||ids.size!==entries.length||ids.size!==routes.size||[...ids].some(url=>!routes.has(url)))throw Error('Archive and sitemap do not match');
 return {workspaceId:'metho',origin,complete:true,fetchedAt:now().toISOString(),titles:entries.map(e=>e.title),entries};
}
