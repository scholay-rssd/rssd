const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Keep only public source links suitable for both the article and its feed.
export function publicArticleSources(sources){
 const result=[],seen=new Set();
 for(const source of Array.isArray(sources)?sources:[]){
  if(typeof source?.url!=='string'||/[\\\x00-\x20]/.test(source.url))continue;
  let url;try{url=new URL(source.url);}catch{continue;}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||seen.has(url.href))continue;
  seen.add(url.href);result.push({label:typeof source.label==='string'&&source.label.trim()?source.label:url.href,url:url.href});
 }
 return result;
}

export function articleSourcePanel(sources,markdown,locale){
 const missing=publicArticleSources(sources).filter(source=>!String(markdown??'').includes(source.url));
 if(!missing.length)return '';
 return `<h2>${locale==='en'?'Sources':'资料来源'}</h2><ul>${missing.map(source=>`<li><a href="${esc(source.url)}">${esc(source.label)}</a></li>`).join('')}</ul>`;
}
