import {plainText} from './page-metadata.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attrs=tag=>Object.fromEntries([...tag.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m=>[m[1].toLowerCase(),plainText(m[2]??m[3]??m[4])]));
const managed=/^(?:og:(?:type|locale|site_name|title|description|url|image(?::(?:url|secure_url|type|width|height|alt))?)|twitter:(?:card|title|description|image(?::alt)?))$/;
const locales={zh:'zh_CN','zh-CN':'zh_CN',en:'en_US',ja:'ja_JP',fr:'fr_FR',es:'es_ES'};
function publicUrl(value,origin){
 try{const url=new URL(value,origin);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}

// Run before page timestamps and release hashes are calculated. All metadata
// is in the initial HTML; link crawlers do not need to run browser scripts.
export function addSocialMetadata(html,{site,route,record,title,description}){
 const head=html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1];
 if(head===undefined)throw Error('Share page has no head: '+route);
 const metas=[...head.matchAll(/<meta\b[^>]*>/gi)].map(m=>attrs(m[0]));
 if(metas.some(m=>m.name==='robots'&&/\bnoindex\b/i.test(m.content||'')))return html;
 const meta=key=>metas.find(m=>(m.property||m.name)===key)?.content;
 const canonical=[...head.matchAll(/<link\b[^>]*>/gi)].map(m=>attrs(m[0])).find(m=>m.rel==='canonical')?.href;
 const url=publicUrl(canonical||route,site.origin);
 if(!url||new URL(url).origin!==new URL(site.origin).origin)throw Error('Share canonical belongs to another site: '+route);
 title=title||meta('og:title')||plainText(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]||'')||site.name;
 description=description||meta('og:description')||meta('description')||site.description;
 const type=record?'article':meta('og:type')||'website';
 const lang=attrs(html.match(/<html\b[^>]*>/i)?.[0]||'').lang||'zh-CN';
 const academic=site.id==='scholay-today';
 const fallback={src:academic?'/social-preview.png':'/apple-touch-icon.png',alt:site.name,...(!academic?{width:180,height:180}:{})};
 const articleImage=type==='article'?html.match(/<article\b[\s\S]*?<img\b[^>]*>/i)?.[0].match(/<img\b[^>]*>$/i)?.[0]:null;
 const bodyImage=articleImage?attrs(articleImage):null;
 const candidates=[record?.media?.[0],bodyImage?.src?{src:bodyImage.src,alt:bodyImage.alt}:null,meta('og:image')?{src:meta('og:image'),alt:meta('og:image:alt'),width:meta('og:image:width'),height:meta('og:image:height')}:null,fallback];
 const image=candidates.find(m=>m?.src&&publicUrl(m.src,site.origin));
 const imageUrl=publicUrl(image.src,site.origin),alt=image.alt||title,isFallback=new URL(imageUrl).origin===new URL(site.origin).origin&&new URL(imageUrl).pathname===fallback.src;
 const mime=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'})[new URL(imageUrl).pathname.split('.').at(-1).toLowerCase()];
 const values={
  'og:type':type,'og:locale':locales[lang]||lang.replaceAll('-','_'),'og:site_name':site.name,
  'og:title':title,'og:description':description,'og:url':url,'og:image':imageUrl,
  ...(imageUrl.startsWith('https:')?{'og:image:secure_url':imageUrl}:{}),...(mime?{'og:image:type':mime}:{}),
  ...(image.width&&image.height?{'og:image:width':image.width,'og:image:height':image.height}:{}),'og:image:alt':alt,
  'twitter:card':isFallback&&!academic?'summary':'summary_large_image','twitter:title':title,'twitter:description':description,'twitter:image':imageUrl,'twitter:image:alt':alt,
 };
 const tags=Object.entries(values).map(([key,value])=>`<meta ${key.startsWith('og:')?'property':'name'}="${key}" content="${esc(value)}">`).join('');
 const cleaned=head.replace(/<meta\b[^>]*>/gi,tag=>{const a=attrs(tag);return managed.test(a.property||a.name||'')?'':tag;});
 return html.replace(head,()=>cleaned+tags);
}
