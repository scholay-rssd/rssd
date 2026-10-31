import {portfolioCollections} from './portfolio-media.mjs';
import {escapeHtml as esc} from '../modules/shared.mjs';

const labels={update:'更新',tutorial:'教程',reflection:'复盘',note:'创作手记'};
export async function standingPages({organization,content,target,homepage}){
  if(!organization)return {hubs:[],pages:[],files:{},nav:[]};
  const hubs=organization.hubs.map(h=>({...h}));
  if(content.siteId==='piggytuck'){
    for(const g of await portfolioCollections(target,homepage))hubs.push({id:g.id,name:g.name,summary:g.description,sectionId:organization.sections.some(s=>s.id==='works')?'works':'column-2',route:'/works/'+g.id+'/',kind:g.kind,images:g.items,links:[{label:'首页作品集',url:'/#moods'}]});
  }
  const hubIds=new Set(hubs.map(h=>h.id));
  for(const r of content.records)for(const related of r.related||[])if(!hubIds.has(related.id))throw Error('Unknown standing page association: '+related.id);
  const updates=Object.fromEntries(hubs.map(h=>[h.id,content.records.filter(r=>r.related?.some(x=>x.id===h.id)).map(r=>({id:r.id,title:r.title,route:r.route,summary:r.summary,role:r.related.find(x=>x.id===h.id).role,date:r.publication.date}))]));
  const related=h=>`<section class="standing-notes"><h2>更新、教程与${content.siteId==='piggytuck'?'创作手记':'复盘'}</h2>${updates[h.id].length?updates[h.id].map(r=>`<article class="entry"><div class="entry-meta">${labels[r.role]} · ${esc(r.date||'')}</div><h3><a href="${esc(r.route)}">${esc(r.title)}</a></h3><p>${esc(r.summary)}</p></article>`).join(''):'<p class="empty">暂无已关联的公开文章。</p>'}</section>`;
  const cards=items=>`<div class="entries standing-cards">${items.map(h=>`<article class="entry">${h.images?.[0]?`<img class="standing-cover" src="/${esc(h.images[0].src)}" alt="${esc(h.name)}" width="160" height="160" loading="lazy">`:''}<h3><a href="${esc(h.route)}">${esc(h.name)}</a></h3><p>${esc(h.summary)}</p><a class="read" href="${esc(h.route)}">查看${h.images?'作品系列':'项目介绍'} ↗</a></article>`).join('')}</div>`;
  const pages=[];
  const files={'organization/project-notes.json':JSON.stringify({version:1,siteId:content.siteId,projects:updates})};
  for(const h of hubs){
    const notesRoute='/project-notes/'+h.id+'/';
    if(h.existingPage&&!homepage?.hashes[h.route.slice(1)+'index.html'])throw Error('Missing original project page: '+h.route);
    if(!h.existingPage&&homepage?.hashes[h.route.slice(1)+'index.html'])throw Error('Standing page collides with homepage: '+h.route);
    if(content.records.some(r=>[h.route,notesRoute].includes(r.route)))throw Error('Standing page collides with article');
    if(h.existingPage){pages.push({route:notesRoute,title:h.name+' · 文章',body:`<section class="hero compact"><p class="eyebrow">项目记录</p><h1>${esc(h.name)}</h1><a href="${esc(h.route)}">← 项目介绍</a></section>${related(h)}`});continue;}
    pages.push({route:h.route,title:h.name,body:`<article class="standing-page"><section class="hero compact"><p class="eyebrow">${esc(h.kind||'项目介绍')}</p><h1>${esc(h.name)}</h1><p>${esc(h.summary)}</p><div class="hero-links">${h.links.map(l=>`<a href="${esc(l.url)}">${esc(l.label)} ↗</a>`).join('')}</div></section>${h.images?`<div class="standing-gallery">${h.images.map(i=>`<figure><a href="/${esc(i.src)}"><img src="/${esc(i.src)}" alt="${esc(i.name)}" width="${i.width}" height="${i.height}" loading="lazy"></a><figcaption>${esc(i.name)}</figcaption></figure>`).join('')}</div>`:''}${related(h)}</article>`});
  }
  const nav=[];
  if(content.siteId==='piggytuck'){
    pages.unshift({route:'/works/',title:'作品系列',body:`<section class="hero compact"><p class="eyebrow">作品与系列</p><h1>每个角色，都有自己的故事。</h1><p>作品图片、系列介绍与持续记录。</p></section>${cards(hubs)}`});nav.push({route:'/works/',label:'作品系列'});
  }
  if(content.siteId==='lingxi')nav.push({route:'/projects/lingxi/',label:'项目介绍'});
  return {hubs,pages,files,nav,cards};
}
