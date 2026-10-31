// Curated statements, never inferred from keywords, tags or co-occurrence.
export function validateKnowledgeGraph(graph){
  if(!graph||graph.version!==1||typeof graph.siteId!=='string'||!Array.isArray(graph.nodes)||!Array.isArray(graph.relations))throw Error('Invalid knowledge graph');
  if(graph.nodes.length>500||graph.relations.length>2000)throw Error('Knowledge graph exceeds v1 limits');
  const text=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
  const id=s=>typeof s==='string'&&/^[a-z0-9][a-z0-9:_-]{0,119}$/.test(s);
  const evidence=items=>{
    if(!Array.isArray(items)||!items.length||items.length>20)throw Error('Knowledge requires explicit evidence');
    for(const e of items){
      if(!text(e.recordId,300)||!/^[a-f0-9]{64}$/.test(e.bodySha256||'')||!text(e.quote,3000))throw Error('Invalid knowledge evidence anchor');
      let url;try{url=new URL(e.sourceUrl);}catch{throw Error('Invalid knowledge source URL');}
      if(!/^https?:$/.test(url.protocol)||url.username||url.password)throw Error('Invalid knowledge source URL');
    }
  };
  const nodes=new Set(),relations=new Set();
  for(const n of graph.nodes){
    if(!id(n.id)||nodes.has(n.id)||!text(n.label,60)||!id(n.kind))throw Error('Invalid or duplicate knowledge node');
    evidence(n.evidence);nodes.add(n.id);
  }
  for(const r of graph.relations){
    if(!id(r.id)||relations.has(r.id)||nodes.has(r.id)||!nodes.has(r.from)||!nodes.has(r.to)||r.from===r.to||!id(r.kind)||!text(r.label,100)||!text(r.statement,1200)||!text(r.scope,1200))throw Error('Invalid knowledge relation');
    // Attribution is explicit; a reviewed article statement is not a proven
    // causal, medical or taxonomic fact.
    if(r.attribution!=='source-statement'||!text(r.reviewedBy,100)||!/^\d{4}-\d{2}-\d{2}$/.test(r.reviewedAt||''))throw Error('Missing knowledge attribution/review');
    evidence(r.evidence);relations.add(r.id);
  }
  return graph;
}
