import {escapeHtml as esc,moduleAsset} from '../shared.mjs';
const anchor=id=>'graph-'+id;
export function graphLayout(nodes){
  // Stable order/positions: no simulation, random layout or network library.
  return nodes.map((n,i)=>({...n,x:i===0?440:440+265*Math.cos((i-1)*2*Math.PI/Math.max(1,nodes.length-1)-Math.PI/2),y:i===0?290:290+205*Math.sin((i-1)*2*Math.PI/Math.max(1,nodes.length-1)-Math.PI/2)}));
}
export const graphModule={
  id:'graph',version:1,contentVersion:1,requires:['knowledge'],route:'/graph/',label:'关系图',
  async render({host,options}){
    const graph=host.knowledge(options),records=new Map(host.records().map(r=>[r.id,r]));
    const evidence=items=>items.map(e=>{
      const record=records.get(e.recordId);
      return `<div class="graph-evidence"><blockquote>${esc(e.quote)}</blockquote><p><a href="${esc(host.permalink(record))}">文章：${esc(record.title)}</a><span> · </span><a href="${esc(e.sourceUrl)}" rel="noreferrer">原始来源 ↗</a></p></div>`;
    }).join('');
    const allNodes=new Map(graph.nodes.map(n=>[n.id,n]));
    // Large graphs keep the complete accessible index; the visual overview is
    // deliberately bounded instead of producing hundreds of overlapping nodes.
    const visible=graph.nodes.slice(0,12),positions=graphLayout(visible),byId=new Map(positions.map(n=>[n.id,n]));
    const edges=graph.relations.map((r,i)=>{
      const a=byId.get(r.from),b=byId.get(r.to);if(!a||!b)return '';
      const length=Math.hypot(b.x-a.x,b.y-a.y),dx=(b.x-a.x)/length,dy=(b.y-a.y)/length;
      const x1=a.x+dx*48,y1=a.y+dy*48,x2=b.x-dx*52,y2=b.y-dy*52;
      return `<a class="graph-edge" href="#${anchor(r.id)}" data-relation="${esc(r.id)}" data-from="${esc(r.from)}" data-to="${esc(r.to)}" aria-label="关系 ${i+1}：${esc(a.label)}，${esc(r.label)}，${esc(b.label)}"><path d="M${x1} ${y1} L${x2} ${y2}" marker-end="url(#graph-arrow)"/><circle cx="${(x1+x2)/2}" cy="${(y1+y2)/2}" r="13"/><text x="${(x1+x2)/2}" y="${(y1+y2)/2+4}">${i+1}</text></a>`;
    }).join('');
    const nodes=positions.map(n=>`<a class="graph-node" href="#${anchor(n.id)}" data-node="${esc(n.id)}" aria-label="实体：${esc(n.label)}"><title>${esc(n.label)}</title><circle cx="${n.x}" cy="${n.y}" r="46"/><text x="${n.x}" y="${n.y-(n.label.length>6?5:-5)}">${esc(n.label.slice(0,6))}${n.label.length>6?`<tspan x="${n.x}" dy="18">${esc(n.label.slice(6,12))}${n.label.length>12?'…':''}</tspan>`:''}</text></a>`).join('');
    const cards=graph.relations.map((r,i)=>`<article class="graph-relation" id="${anchor(r.id)}" data-from="${esc(r.from)}" data-to="${esc(r.to)}"><div class="graph-relation-heading"><span>${String(i+1).padStart(2,'0')}</span><h2>${esc(allNodes.get(r.from).label)} <small>${esc(r.label)}</small> ${esc(allNodes.get(r.to).label)}</h2></div><p>${esc(r.statement)}</p><p class="graph-scope">来源边界：${esc(r.scope)}</p><details><summary>查看依据与来源</summary>${evidence(r.evidence)}<p class="graph-review">整理核对：${esc(r.reviewedBy)} · ${esc(r.reviewedAt)}（核对文章表述，不代表独立实证验证）</p></details></article>`).join('');
    const body=`<section class="hero compact"><p class="eyebrow">KNOWLEDGE / 关系图</p><h1>循着关系，回到依据。</h1><p>每条连线都对应文章中的明确表述。来源建议与事实证明分开呈现。</p></section><section class="knowledge-graph" aria-label="百科实体关系"><div class="graph-toolbar"><p id="graph-count" aria-live="polite">${graph.nodes.length} 个实体 · ${graph.relations.length} 条有据关系</p>${graph.nodes.length?`<label hidden id="graph-filter-label">查看实体 <select id="graph-filter"><option value="">全部实体</option>${graph.nodes.map(n=>`<option value="${esc(n.id)}">${esc(n.label)}</option>`).join('')}</select></label>`:''}</div>${graph.nodes.length?`<div class="graph-stage" tabindex="0" aria-label="关系图区域，可横向滚动"><svg class="graph-svg" viewBox="0 0 880 580" role="group" aria-label="实体关系图，连线编号对应下方依据"><defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edges}${nodes}</svg></div><p class="graph-caption">点击编号查看依据，点击实体定位介绍。位置不代表分类层级或因果强度；窄屏可横向滑动。${graph.nodes.length>12?'概览只显示前 12 个实体；完整实体与关系见下方索引。':''}</p>`:'<div class="graph-empty"><h2>暂没有可展示的关系</h2><p>只有公开文章中有明确依据、且正文版本一致的实体与关系才会出现在这里。</p></div>'}<div class="graph-relations">${cards}</div>${graph.nodes.length?`<details class="graph-entities"><summary>实体索引与依据 · ${graph.nodes.length}</summary>${graph.nodes.map(n=>`<article id="${anchor(n.id)}"><h2>${esc(n.label)}</h2>${evidence(n.evidence)}</article>`).join('')}</details>`:''}</section>`;
    return {title:'百科关系图',body,styles:['/display/graph/style.css'],scripts:graph.nodes.length?['/display/graph/client.js']:[],files:{'display/graph/style.css':await moduleAsset('./graph/style.css'),...(graph.nodes.length?{'display/graph/client.js':await moduleAsset('./graph/client.js')}:{}),'display/graph/content.json':JSON.stringify(graph)}};
  },
};
