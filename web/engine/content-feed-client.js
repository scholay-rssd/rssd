(()=>{
 const root=document.querySelector('[data-feed-section]');if(!root)return;
 const input=document.getElementById('feed-search'),form=document.getElementById('feed-search-form'),entries=document.getElementById('feed-entries'),count=document.getElementById('feed-count'),pagination=document.getElementById('feed-pagination');
 const original={entries:entries.innerHTML,count:count.textContent,pagination:pagination.innerHTML},section=root.dataset.feedSection,size=24;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
   entries.innerHTML=matches.slice((page-1)*size,page*size).map(r=>`<article class="feed-entry">${r.cover?`<a class="feed-cover" href="${esc(r.route)}" tabindex="-1" aria-hidden="true"><img src="${esc(r.cover.src)}" alt="" width="640" height="400" loading="lazy" decoding="async"></a>`:''}<div class="entry-meta"><span>${esc(names[r.section])}</span><time>${esc(r.dateLabel)}</time></div><h2><a href="${esc(r.route)}">${esc(r.title)}</a></h2><p>${esc(r.summary.slice(0,240))}</p></article>`).join('')||'<p class="empty">没有匹配的内容，试试其他关键词或板块。</p>';
   count.textContent=matches.length+' 条匹配 · 第 '+page+' / '+pages+' 页';
   pagination.innerHTML=pages>1?`<nav class="feed-pagination" aria-label="搜索分页">${page>1?`<button data-feed-page="${page-1}">上一页</button>`:''}<span>${page} / ${pages}</span>${page<pages?`<button data-feed-page="${page+1}">下一页</button>`:''}</nav>`:'';
  }catch{if(version===generation)count.textContent='搜索暂不可用，仍可通过板块和分页阅读。';}
 }
 form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);page=1;search();});
 input.addEventListener('input',()=>{clearTimeout(timer);page=1;timer=setTimeout(search,180);});
 pagination.addEventListener('click',event=>{const button=event.target.closest('[data-feed-page]');if(!button)return;page=Number(button.dataset.feedPage);search();entries.scrollIntoView({block:'start'});});
 const params=new URLSearchParams(location.search),requested=Number(params.get('p'));input.value=params.get('q')||'';page=Number.isSafeInteger(requested)&&requested>0?requested:1;if(input.value)search();
})();
