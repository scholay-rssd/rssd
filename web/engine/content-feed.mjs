import {collectionIds} from './site-organization.mjs';
import {escapeHtml as esc} from '../modules/shared.mjs';

export const feedPageSize=24;
export const feedRoute=(base,page=1)=>page===1?base:base+'page/'+page+'/';
export function createFeedIndex(content){
 const sections=content.collections.filter(c=>c.route!=='/archive/').map(c=>({...c,members:[...collectionIds(content.collections,c.id)]}));
 const records=content.records.slice().sort((a,b)=>String(b.publication.date||'').localeCompare(String(a.publication.date||''))||a.id.localeCompare(b.id)).map(r=>({
  id:r.id,title:r.title,summary:plainSummary(r.summary),route:r.route,section:r.collectionId,
  ...(r.media?.[0]?.src?{cover:{src:r.media[0].src,alt:r.media[0].alt||''}}:{}),
  dateLabel:r.event?.mode==='historical'?`${r.event.year} 年 · ${r.event.monthDay}`:r.event?.mode==='annual'?'每年 '+r.event.recurrence.monthDay:r.event?.start?[r.event.start,r.event.end].filter(Boolean).join(' — '):r.publication.date||'',
 }));
 return {version:1,siteId:content.siteId,sections,records};
}
// Listing excerpts are plain text: a summary may open with a Markdown picture or
// links, which would otherwise show as raw syntax in every listing.
export function plainSummary(value){
 return String(value||'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/[#*_`>]/g,'').replace(/\s+/g,' ').trim();
}
export function feedCard(record,index){
 const label=index.sections.find(s=>s.id===record.section)?.name||'';
 return `<article class="feed-entry" data-section="${esc(record.section||'')}">${record.cover?`<a class="feed-cover" href="${esc(record.route)}" tabindex="-1" aria-hidden="true"><img src="${esc(record.cover.src)}" alt="" width="640" height="400" loading="lazy" decoding="async"></a>`:''}<div class="entry-meta"><span>${esc(label)}</span><time>${esc(record.dateLabel)}</time></div><h2><a href="${esc(record.route)}">${esc(record.title)}</a></h2><p>${esc(record.summary.slice(0,240))}</p></article>`;
}
export function renderFeed(index,{label,section='',page=1}={}){
 const selected=index.sections.find(s=>s.id===section),members=selected?.members||[section];
 const records=section?index.records.filter(r=>members.includes(r.section)):index.records;
 const base=selected?.route||'/archive/',pages=Math.max(1,Math.ceil(records.length/feedPageSize));
 const filter=s=>`<a data-feed-filter href="${esc(s.route)}"${section===s.id?' aria-current="page"':''}>${esc(s.name)}<small>${index.records.filter(r=>s.members.includes(r.section)).length}</small></a>`;
 const primary=index.sections.filter(s=>!s.legacy),legacy=index.sections.filter(s=>s.legacy);
 const links=`<a data-feed-filter href="/archive/"${!section?' aria-current="page"':''}>全部<small>${index.records.length}</small></a>`+primary.map(filter).join('');
 const pagination=pages>1?`<nav class="feed-pagination" aria-label="内容分页">${page>1?`<a rel="prev" href="${feedRoute(base,page-1)}">上一页</a>`:''}<span>第 ${page} / ${pages} 页</span>${page<pages?`<a rel="next" href="${feedRoute(base,page+1)}">下一页</a>`:''}</nav>`:'';
 const body=`<section class="content-feed" data-feed-section="${esc(section)}"><header class="hero compact"><p class="eyebrow">${esc(label)}</p><h1>${esc(selected?.name||'全部内容')}</h1><p>${esc(selected?.description||'在这里阅读文章与记录，按板块筛选感兴趣的内容。')}</p></header><div class="feed-layout"><aside class="feed-sidebar"><form id="feed-search-form" role="search" action="${esc(base)}"><label for="feed-search">搜索内容</label><div class="feed-search-control"><input id="feed-search" name="q" type="search" placeholder="标题、摘要或关键词"><button type="submit">搜索</button></div></form><nav class="feed-filters" aria-label="内容板块">${links}</nav>${legacy.length?`<details class="feed-legacy"${selected?.legacy?' open':''}><summary>旧栏目与既有文章 · ${legacy.length}</summary><nav class="feed-filters" aria-label="旧栏目">${legacy.map(filter).join('')}</nav></details>`:''}</aside><div class="feed-results"><p id="feed-count" role="status">${records.length} 条内容 · 第 ${page} / ${pages} 页</p><div id="feed-entries">${records.slice((page-1)*feedPageSize,page*feedPageSize).map(r=>feedCard(r,index)).join('')||'<p class="empty">这个板块还没有公开内容。</p>'}</div><div id="feed-pagination">${pagination}</div><noscript><p>板块与分页可直接浏览；关键词检索需要启用 JavaScript。</p></noscript></div></div></section><script src="/content-feed.js" defer></script>`;
 return {body,pages,title:selected?.name||label};
}
