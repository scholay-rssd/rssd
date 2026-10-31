import {createHash} from 'node:crypto';

export const sitemapNamespace='http://www.sitemaps.org/schemas/sitemap/0.9';
export const sitemapChunkSize=10000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const escapeXml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));

// Ignore JSON object key order; export timestamps are excluded by the caller.
export function stableJson(value) {
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')+'}';
  return JSON.stringify(value);
}

export function createSeoState(previous={},now=new Date()) {
  const time=new Date(now).getTime();
  if(!Number.isFinite(time))throw new Error('Invalid SEO build time');
  const modified=new Date(Math.floor(time/1000)*1000).toISOString().replace('.000Z','Z');
  const pages={},files={};
  const track=(group,key,content)=>{
    // Language navigation is added after a Theme renders. Its original page
    // fingerprint prevents that later decoration from churning base timestamps.
    const fingerprint=hash(content),prior=previous.version===2?(group==='pages'?previous.languageBasePages?.[key]||previous.pages?.[key]:previous[group]?.[key]):null;
    if(prior&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(prior.lastmod)||!Number.isFinite(Date.parse(prior.lastmod))||Date.parse(prior.lastmod)>time))throw new Error('Invalid prior SEO timestamp: '+key);
    const lastmod=prior?.hash===fingerprint?prior.lastmod:modified;
    const record={hash:fingerprint,lastmod};
    (group==='pages'?pages:files)[key]=record;
    return record;
  };
  return {pages,files,page:(route,content)=>track('pages',route,content),file:(name,content)=>track('files',name,content)};
}

export function sitemapXml(entries,{index=false}={}) {
  const root=index?'sitemapindex':'urlset',tag=index?'sitemap':'url';
  if(entries.length>50000)throw new Error('Sitemap exceeds 50,000 entries');
  const result='<?xml version="1.0" encoding="UTF-8"?>\n<'+root+' xmlns="'+sitemapNamespace+'">\n'+entries.map(({loc,lastmod})=>'  <'+tag+'>\n    <loc>'+escapeXml(loc)+'</loc>\n    <lastmod>'+escapeXml(lastmod)+'</lastmod>\n  </'+tag+'>').join('\n')+'\n</'+root+'>\n';
  if(Buffer.byteLength(result)>52428800)throw new Error('Sitemap exceeds 50 MiB');
  return result;
}

export function splitSitemap(name,entries) {
  const chunks=[];
  for(let offset=0;offset<entries.length;offset+=sitemapChunkSize)chunks.push({name:'sitemap-'+name+(offset?'-'+(offset/sitemapChunkSize+1):'')+'.xml',entries:entries.slice(offset,offset+sitemapChunkSize)});
  return chunks;
}
