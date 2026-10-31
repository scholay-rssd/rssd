import {escapeHtml as esc,moduleAsset} from '../shared.mjs';
import {ROADMAP_STATES} from '../../../contracts/article-views.mjs';
export const roadmapModule={
  id:'roadmap',version:1,contentVersion:1,route:'/roadmap/',label:'路线图',
  async render({host,options}){
    const records=host.records(options).filter(r=>r.views?.roadmap);
    const columns=Object.entries(ROADMAP_STATES).map(([state,label])=>{
      const items=records.filter(r=>r.views.roadmap.state===state).sort((a,b)=>String(a.views.roadmap.targetDate||'9999').localeCompare(String(b.views.roadmap.targetDate||'9999'))||String(b.publication.date||'').localeCompare(String(a.publication.date||'')));
      return `<section class="roadmap-column"><h2>${label}<small>${items.length}</small></h2>${items.map(r=>`<article class="roadmap-card"><h3><a href="${esc(r.route)}">${esc(r.title)}</a></h3><p>${esc(r.summary)}</p>${r.views.roadmap.platforms?.length?`<p class="roadmap-tags">${r.views.roadmap.platforms.map(p=>`<span>${esc(p)}</span>`).join('')}</p>`:''}${r.views.roadmap.targetDate?`<p>目标日期 <time>${esc(r.views.roadmap.targetDate)}</time></p>`:''}<small>文章更新 ${esc(r.publication.date||'未标注')}</small><div><a href="${esc(r.route)}">阅读进展 →</a><a href="${esc(r.views.roadmap.sourceUrl)}" rel="noreferrer">GitHub 来源 ↗</a></div></article>`).join('')||'<p class="empty">暂无公开记录。</p>'}</section>`;
    }).join('');
    return {title:'路线图',body:`<section class="hero compact"><p class="eyebrow">项目进展</p><h1>路线图</h1><p>每一项进展都有独立文章；状态与目标日期以文章最近记录为准。</p></section><div class="roadmap-board">${columns}</div>`,styles:['/display/roadmap/style.css'],scripts:[],files:{'display/roadmap/style.css':await moduleAsset('./roadmap/style.css')}};
  }
};
