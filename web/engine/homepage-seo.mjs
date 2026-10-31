// Enrich the private homepage build artifact without changing its authored body.
// Article and archive pages continue to use their existing Theme SEO renderer.
const marker='data-homepage-seo';
const managedScript=/<script\b[^>]*\bdata-homepage-seo(?:=["'][^"']*["'])?[^>]*>[\s\S]*?<\/script>\n?/gi;
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
const decode=value=>value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(whole,key)=>{
 if(key[0]!=='#')return entities[key.toLowerCase()];
 const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
 return code>0&&code<=0x10ffff?String.fromCodePoint(code):whole;
});
function attributes(tag){
 return Object.fromEntries([...tag.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3]??m[4])]));
}
export function addHomepageStructuredData(html,{site,route}){
 const clean=html.replace(managedScript,'');
 const head=clean.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1];
 if(head===undefined)throw Error('Homepage has no head: '+route);
 const metas=[...head.matchAll(/<meta\b[^>]*>/gi)].map(m=>attributes(m[0]));
 if(metas.some(m=>m.name?.toLowerCase()==='robots'&&/\bnoindex\b/i.test(m.content||'')))return clean;
 const canonical=[...head.matchAll(/<link\b[^>]*>/gi)].map(m=>attributes(m[0])).filter(a=>a.rel?.toLowerCase()==='canonical');
 const origin=new URL(site.origin).origin,url=origin+route;
 if(!route.startsWith('/')||route.startsWith('//')||canonical.length!==1||new URL(canonical[0].href,origin).href!==url)throw Error('Homepage canonical mismatch: '+route);
 const name=decode(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]||'').trim();
 const language=attributes(clean.match(/<html\b[^>]*>/i)?.[0]||'').lang;
 const description=metas.find(m=>m.name?.toLowerCase()==='description')?.content;
 if(!name||!language||!description)throw Error('Homepage metadata incomplete: '+route);
 const websiteId=origin+'/#website';
 const schema={'@context':'https://schema.org','@graph':[
  {'@type':'WebSite','@id':websiteId,url:origin+'/',name:site.name},
  {'@type':'WebPage','@id':url+'#webpage',url,name,description,inLanguage:language,isPartOf:{'@id':websiteId}}
 ]};
 const json=JSON.stringify(schema).replace(/</g,'\\u003c');
 return clean.replace(/<\/head\s*>/i,closing=>`<script type="application/ld+json" ${marker}>${json}</script>\n${closing}`);
}
