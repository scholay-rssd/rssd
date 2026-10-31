import {escapeHtml as esc,moduleAsset} from '../shared.mjs';
export function showcaseCards(records){
  return records.map(r=>`<article class="showcase-card" data-showcase-card data-search="${esc([r.title,r.summary,...(r.tags||[])].join(' ').toLowerCase())}"><a href="${esc(r.route)}">${r.media?.[0]?`<img src="${esc(r.media[0].src)}" alt="${esc(r.media[0].alt)}" loading="lazy" decoding="async">`:'<span class="showcase-cover" aria-hidden="true">↗</span>'}<div class="showcase-copy"><small>${esc(r.publication?.date||'')}</small><h2>${esc(r.title)}</h2><p>${esc(r.summary||'')}</p><span>查看详情 ↗</span></div></a></article>`).join('');
}
export const showcaseModule={
  id:'showcase',version:1,contentVersion:1,route:'/showcase/',label:'橱窗',
  async render({host,options}){
    const records=host.records(options).slice().sort((a,b)=>String(b.publication.date||'').localeCompare(String(a.publication.date||'')));
    const series=new Map();for(const m of host.media(options))if(!m.recordId&&m.collectionId?.startsWith('portfolio:')&&!series.has(m.collectionId))series.set(m.collectionId,{title:m.group,summary:'作品系列',route:'/works/'+m.collectionId.slice(10)+'/',media:[m]});
    const items=[...series.values(),...records];
    return {title:'橱窗',body:`<section class="hero compact"><p class="eyebrow">橱窗</p><h1>从一篇内容开始探索。</h1><p>作品、知识与资源，各有一个可以继续阅读的入口。</p></section><label class="showcase-search" hidden>搜索橱窗 <input type="search" placeholder="标题、摘要或标签" data-showcase-search></label><p data-showcase-count aria-live="polite">${items.length} 条内容</p><div class="showcase-grid">${showcaseCards(items)||'<p class="empty">这里还没有公开的内容。</p>'}</div>`,styles:['/display/showcase/style.css'],scripts:['/display/showcase/client.js'],files:{'display/showcase/style.css':await moduleAsset('./showcase/style.css'),'display/showcase/client.js':await moduleAsset('./showcase/client.js')}};
  }
};
