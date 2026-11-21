(()=>{
 const root=document.querySelector('[data-feed-section]');if(!root)return;
 const input=document.getElementById('feed-search'),form=document.getElementById('feed-search-form'),entries=document.getElementById('feed-entries'),count=document.getElementById('feed-count'),pagination=document.getElementById('feed-pagination');
 const original={entries:entries.innerHTML,count:count.textContent,pagination:pagination.innerHTML},section=root.dataset.feedSection,size=24;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Same markup as feedCover in content-feed.mjs.
 const cover=(c,route)=>{const ratio=Number.isFinite(c.ratio)&&c.ratio>0?c.ratio:null;return `<a class="feed-cover" href="${esc(route)}" tabindex="-1" aria-hidden="true"${ratio?` style="--ar:${ratio}"`:''}><img src="${esc(c.src)}" alt="" width="640" height="${ratio?Math.round(640/ratio):400}" loading="lazy" decoding="async"></a>`;};
 // Same markup as textCover in content-feed.mjs: a work without a picture shows its section and title.
 const textCover=(r,sec)=>{const c=sec?.cover||{},vars=[['--tc-paper',c.paper],['--tc-ink',c.ink],['--tc-accent',c.accent]].filter(([,v])=>v).map(([k,v])=>k+':'+v).join(';');return `<a class="feed-cover feed-cover-text" href="${esc(r.route)}" tabindex="-1" aria-hidden="true"${vars?` style="${esc(vars)}"`:''}><span>${esc(sec?.name||'')}</span><strong>${esc(r.title)}</strong></a>`;};
 // Same mark as feedType in content-feed.mjs: the icons are FEED_TYPE_ICONS, the names the work types contract's.
 const icons={note:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 6.5v-1A2.5 2.5 0 0 1 10.5 3h8A2.5 2.5 0 0 1 21 5.5v8a2.5 2.5 0 0 1-2.5 2.5h-1"/><rect x="3" y="7" width="14" height="14" rx="2.5"/><circle cx="8" cy="11.5" r="1.4"/><path d="m3.5 19 4.5-4.5 3 3 2-2 3.5 3.5"/></svg>',article:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 3h7.5L19 7.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/><path d="M8.5 12.5h7M8.5 16h7M8.5 19h4"/></svg>'};
 const mark=(r,index)=>{if(!index.mixed)return '';const type=r.type==='note'?'note':'article',label=type==='note'?'笔记'+(r.pictures>1?' · '+r.pictures+' 图':''):'长文';return `<span class="feed-type" data-type="${type}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${icons[type]}</span>`;};
 let pending,page=1,generation=0,timer;
 const load=()=>pending??(pending=fetch('/content-feed-index.json').then(r=>{if(!r.ok)throw Error('检索目录暂不可用');return r.json();}).catch(error=>{pending=null;throw error;}));
 async function search(){
  const version=++generation,query=input.value.trim(),url=new URL(location.href);
  for(const link of root.querySelectorAll('[data-feed-filter]')){const target=new URL(link.href);if(query)target.searchParams.set('q',query);else target.searchParams.delete('q');link.href=target.pathname+target.search;}
  if(query){url.searchParams.set('q',query);url.searchParams.set('p',String(page));}else{url.searchParams.delete('q');url.searchParams.delete('p');}
  history.replaceState(null,'',url);
  if(!query){entries.innerHTML=original.entries;count.textContent=original.count;pagination.innerHTML=original.pagination;return;}
  count.textContent='正在搜索…';
  try{
   const index=await load();if(version!==generation)return;
   const names=Object.fromEntries(index.sections.map(s=>[s.id,s.name])),members=index.sections.find(s=>s.id===section)?.members||[section],terms=query.toLocaleLowerCase().split(/\s+/);
   const matches=index.records.filter(r=>(!section||members.includes(r.section))&&terms.every(t=>(r.title+' '+r.summary+' '+r.dateLabel+' '+(names[r.section]||'')).toLocaleLowerCase().includes(t))),pages=Math.max(1,Math.ceil(matches.length/size));page=Math.min(page,pages);
   url.searchParams.set('p',String(page));history.replaceState(null,'',url);
   entries.innerHTML=matches.slice((page-1)*size,page*size).map(r=>`<article class="feed-entry" data-section="${esc(r.section||'')}"${r.type==='note'?' data-type="note"':''}>${r.cover?cover(r.cover,r.route):textCover(r,index.sections.find(x=>x.id===r.section))}${mark(r,index)}<div class="entry-meta"><span>${esc(names[r.section])}</span><time>${esc(r.dateLabel)}</time></div><h2><a href="${esc(r.route)}">${esc(r.title)}</a></h2><p>${esc(r.summary.slice(0,240))}</p></article>`).join('')||'<p class="empty">没有匹配的内容，试试其他关键词或板块。</p>';
   count.textContent=matches.length+' 条匹配 · 第 '+page+' / '+pages+' 页';
   pagination.innerHTML=pages>1?`<nav class="feed-pagination" aria-label="搜索分页">${page>1?`<button data-feed-page="${page-1}">上一页</button>`:''}<span>${page} / ${pages}</span>${page<pages?`<button data-feed-page="${page+1}">下一页</button>`:''}</nav>`:'';
  }catch{if(version===generation)count.textContent='搜索暂不可用，仍可通过板块和分页阅读。';}
 }
 form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);page=1;search();});
 input.addEventListener('input',()=>{clearTimeout(timer);page=1;timer=setTimeout(search,180);});
 pagination.addEventListener('click',event=>{const button=event.target.closest('[data-feed-page]');if(!button)return;page=Number(button.dataset.feedPage);search();entries.scrollIntoView({block:'start'});});
 const params=new URLSearchParams(location.search),requested=Number(params.get('p'));input.value=params.get('q')||'';page=Number.isSafeInteger(requested)&&requested>0?requested:1;if(input.value)search();
})();
