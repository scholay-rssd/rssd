import {collectionIds} from './site-organization.mjs';
import {escapeHtml as esc} from '../modules/shared.mjs';
import {workTypeLabel} from '../../contracts/work-types.mjs';

export const feedPageSize=24;
export const feedRoute=(base,page=1)=>page===1?base:base+'page/'+page+'/';
// `ratio` gives a cover's real width/height when the picture is known, so
// listing cards can reserve each picture's own shape before it loads.
// `palette(sectionId)` gives a section's card colours ({paper, ink, accent}); a work without a picture gets a text
// cover in them, as the algorithmic card layout would draw its first card.
export function createFeedIndex(content,{ratio=()=>undefined,palette}={}){
 const sections=content.collections.filter(c=>c.route!=='/archive/').map(c=>{const colours=palette?cardPalette(palette(c.id)):undefined;return {...c,members:[...collectionIds(content.collections,c.id)],...(colours?{cover:colours}:{})};});
 const shape=src=>{const value=ratio(src);return Number.isFinite(value)&&value>0?{ratio:Math.round(value*10000)/10000}:{};};
 const records=content.records.slice().sort((a,b)=>String(b.publication.date||'').localeCompare(String(a.publication.date||''))||a.id.localeCompare(b.id)).map(r=>({
  id:r.id,title:r.title,summary:plainSummary(r.summary),route:r.route,section:r.collectionId,
  ...coverOf(r,shape),
  ...(r.type==='note'?{type:'note',pictures:r.media?.length||0}:{}),
  dateLabel:r.event?.mode==='historical'?`${r.event.year} 年 · ${r.event.monthDay}`:r.event?.mode==='annual'?'每年 '+r.event.recurrence.monthDay:r.event?.start?[r.event.start,r.event.end].filter(Boolean).join(' — '):r.publication.date||'',
 }));
 // Once a site has notes, every card says whether it is a long article or a note.
 // Text covers only where the theme gives section colours, so a theme that has no style for them is unchanged.
 return {version:1,siteId:content.siteId,sections,records,...(records.some(r=>r.type==='note')?{mixed:true}:{}),...(palette?{textCovers:true}:{})};
}
// A work's cover, in order: the first card of a card set made for its current revision (the set the site shows),
// else its first picture. A work with neither gets a text cover when it is listed.
function coverOf(r,shape){
 const card=r.cards?.pages?.[0],current=r.cards&&(r.revision===undefined||r.cards.revision===undefined||r.cards.revision===r.revision);
 if(current&&card?.src)return {cover:{src:card.src,alt:'',...(card.width&&card.height?{ratio:Math.round(card.width/card.height*10000)/10000}:shape(card.src))}};
 return r.media?.[0]?.src?{cover:{src:r.media[0].src,alt:r.media[0].alt||'',...shape(r.media[0].src)}}:{};
}
const COLOUR=/^#[0-9a-f]{3,8}$/i;
function cardPalette(value){
 if(!value)return undefined;
 const colours=Object.fromEntries(['paper','ink','accent'].filter(key=>COLOUR.test(value[key]||'')).map(key=>[key,value[key]]));
 return Object.keys(colours).length?colours:undefined;
}
/** The cover of a work without a picture: its section and title on the section's card colours. */
export function textCover(record,section,route){
 const c=section?.cover||{},vars=[['--tc-paper',c.paper],['--tc-ink',c.ink],['--tc-accent',c.accent]].filter(([,v])=>v).map(([k,v])=>k+':'+v).join(';');
 return `<a class="feed-cover feed-cover-text" href="${esc(route)}" tabindex="-1" aria-hidden="true"${vars?` style="${esc(vars)}"`:''}><span>${esc(section?.name||'')}</span><strong>${esc(record.title)}</strong></a>`;
}
// Listing excerpts are plain text: a summary may open with a Markdown picture or
// links, which would otherwise show as raw syntax in every listing.
export function plainSummary(value){
 return String(value||'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/[#*_`>]/g,'').replace(/\s+/g,' ').trim();
}
// A known ratio sets the picture's own height and a --ar custom property that
// site designs may use; without one the card keeps the old 16:10 placeholder.
export function feedCover(cover,route){
 const ratio=Number.isFinite(cover.ratio)&&cover.ratio>0?cover.ratio:null;
 return `<a class="feed-cover" href="${esc(route)}" tabindex="-1" aria-hidden="true"${ratio?` style="--ar:${ratio}"`:''}><img src="${esc(cover.src)}" alt="" width="640" height="${ratio?Math.round(640/ratio):400}" loading="lazy" decoding="async"></a>`;
}
// A long article is a page of text, a note a stack of pictures. The mark is a picture; its name and the
// number of pictures are read out and shown on hover.
export const FEED_TYPE_ICONS=Object.freeze({
 note:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 6.5v-1A2.5 2.5 0 0 1 10.5 3h8A2.5 2.5 0 0 1 21 5.5v8a2.5 2.5 0 0 1-2.5 2.5h-1"/><rect x="3" y="7" width="14" height="14" rx="2.5"/><circle cx="8" cy="11.5" r="1.4"/><path d="m3.5 19 4.5-4.5 3 3 2-2 3.5 3.5"/></svg>',
 article:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 3h7.5L19 7.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/><path d="M8.5 12.5h7M8.5 16h7M8.5 19h4"/></svg>',
});
/** The mark on a card in a feed that mixes long articles and notes; nothing on a feed of articles only. */
export function feedType(record,index){
 if(!index.mixed)return '';
 const type=record.type==='note'?'note':'article',label=workTypeLabel(type)+(type==='note'&&record.pictures>1?' · '+record.pictures+' 图':'');
 return `<span class="feed-type" data-type="${type}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${FEED_TYPE_ICONS[type]}</span>`;
}
export function feedCard(record,index){
 const section=index.sections.find(s=>s.id===record.section),label=section?.name||'';
 return `<article class="feed-entry" data-section="${esc(record.section||'')}"${record.type==='note'?' data-type="note"':''}>${record.cover?feedCover(record.cover,record.route):index.textCovers?textCover(record,section,record.route):''}${feedType(record,index)}<div class="entry-meta"><span>${esc(label)}</span><time>${esc(record.dateLabel)}</time></div><h2><a href="${esc(record.route)}">${esc(record.title)}</a></h2><p>${esc(record.summary.slice(0,240))}</p></article>`;
}
/** How a listing is laid out: covers in columns, rows of text, or a row of covers above rows of text. */
export const FEED_LAYOUTS=Object.freeze(['waterfall','list','mixed']);
const LEAD_SIZE=4;
// In rows of text, notes stay covers: the notes of a page form one row of covers, where the first of them would be,
// so the rows of articles keep their order and are not broken up by single notes.
function feedEntries(records,index,{layout,page}){
 if(layout==='waterfall')return records.map(r=>feedCard(r,index)).join('');
 const lead=layout==='mixed'&&page===1?records.slice(0,LEAD_SIZE):[],rest=records.slice(lead.length);
 const notes=rest.filter(r=>r.type==='note'),parts=[];let placed=false;
 for(const r of rest){
  if(r.type!=='note')parts.push(feedCard(r,index));
  else if(!placed){parts.push(`<div class="feed-notes">${notes.map(n=>feedCard(n,index)).join('')}</div>`);placed=true;}
 }
 return (lead.length?`<div class="feed-lead">${lead.map(r=>feedCard(r,index)).join('')}</div>`:'')+parts.join('');
}
export function renderFeed(index,{label,section='',page=1,layout='waterfall'}={}){
 if(!FEED_LAYOUTS.includes(layout))throw Error('Unknown feed layout: '+layout);
 const selected=index.sections.find(s=>s.id===section),members=selected?.members||[section];
 const records=section?index.records.filter(r=>members.includes(r.section)):index.records;
 const base=selected?.route||'/archive/',pages=Math.max(1,Math.ceil(records.length/feedPageSize));
 const filter=s=>`<a data-feed-filter href="${esc(s.route)}"${section===s.id?' aria-current="page"':''}>${esc(s.name)}<small>${index.records.filter(r=>s.members.includes(r.section)).length}</small></a>`;
 const primary=index.sections.filter(s=>!s.legacy),legacy=index.sections.filter(s=>s.legacy);
 const links=`<a data-feed-filter href="/archive/"${!section?' aria-current="page"':''}>全部<small>${index.records.length}</small></a>`+primary.map(filter).join('');
 const pagination=pages>1?`<nav class="feed-pagination" aria-label="内容分页">${page>1?`<a rel="prev" href="${feedRoute(base,page-1)}">上一页</a>`:''}<span>第 ${page} / ${pages} 页</span>${page<pages?`<a rel="next" href="${feedRoute(base,page+1)}">下一页</a>`:''}</nav>`:'';
 const body=`<section class="content-feed" data-feed-section="${esc(section)}" data-feed-layout="${layout}"${selected?.legacy?' data-feed-legacy':''}><header class="hero compact"><p class="eyebrow">${esc(label)}</p><h1>${esc(selected?.name||'全部内容')}</h1><p>${esc(selected?.description||'在这里阅读文章与记录，按板块筛选感兴趣的内容。')}</p></header><div class="feed-layout"><aside class="feed-sidebar"><form id="feed-search-form" role="search" action="${esc(base)}"><label for="feed-search">搜索内容</label><div class="feed-search-control"><input id="feed-search" name="q" type="search" placeholder="标题、摘要或关键词"><button type="submit">搜索</button></div></form><nav class="feed-filters" aria-label="内容板块">${links}</nav>${legacy.length?`<details class="feed-legacy"${selected?.legacy?' open':''}><summary>旧栏目与既有文章 · ${legacy.length}</summary><nav class="feed-filters" aria-label="旧栏目">${legacy.map(filter).join('')}</nav></details>`:''}</aside><div class="feed-results"><p id="feed-count" role="status">${records.length} 条内容 · 第 ${page} / ${pages} 页</p><div id="feed-entries">${feedEntries(records.slice((page-1)*feedPageSize,page*feedPageSize),index,{layout,page})||'<p class="empty">这个板块还没有公开内容。</p>'}</div><div id="feed-pagination">${pagination}</div><noscript><p>板块与分页可直接浏览；关键词检索需要启用 JavaScript。</p></noscript></div></div></section><script src="/content-feed.js" defer></script>`;
 return {body,pages,title:selected?.name||label};
}
