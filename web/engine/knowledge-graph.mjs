import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateKnowledgeGraph} from '../../contracts/knowledge-graph.mjs';
import {markdownLinks} from '../../scripts/article-format.mjs';
export const bodyHash=body=>createHash('sha256').update(body).digest('hex');
export function bindKnowledgeGraph(content,input){
  validateKnowledgeGraph(input);
  if(input.siteId!==content.siteId)throw Error('Knowledge belongs to another site');
  const records=new Map(content.records.map(r=>[r.id,{record:r,hash:bodyHash(r.bodyMarkdown),urls:new Set([...r.sources.map(s=>s.url),...markdownLinks(r.bodyMarkdown)])}]));
  const matches=e=>{const r=records.get(e.recordId);return Boolean(r&&r.hash===e.bodySha256&&r.record.bodyMarkdown.includes(e.quote)&&r.urls.has(e.sourceUrl));};
  // Project only allowlisted fields into public output. Unpublished or changed
  // evidence and its annotations must never leak via JSON, HTML or tooltips.
  const proof=items=>items.map(({recordId,bodySha256,quote,sourceUrl})=>({recordId,bodySha256,quote,sourceUrl}));
  const nodes=input.nodes.filter(n=>n.evidence.every(matches)).map(n=>({id:n.id,label:n.label,kind:n.kind,evidence:proof(n.evidence)}));
  const ids=new Set(nodes.map(n=>n.id));
  const relations=input.relations.filter(r=>ids.has(r.from)&&ids.has(r.to)&&r.evidence.every(matches)).map(r=>({id:r.id,from:r.from,to:r.to,kind:r.kind,label:r.label,statement:r.statement,scope:r.scope,attribution:r.attribution,reviewedBy:r.reviewedBy,reviewedAt:r.reviewedAt,evidence:proof(r.evidence)}));
  return {graph:{version:1,siteId:content.siteId,nodes,relations},omitted:{nodes:input.nodes.length-nodes.length,relations:input.relations.length-relations.length}};
}
export async function attachKnowledgeGraph(content,{source,site}){
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(site.id))throw Error('Invalid knowledge site ID');
  const file=join(source,'sites/knowledge',site.id+'.json');
  let input;
  try{if((await lstat(file)).isSymbolicLink())throw Error('Knowledge symlink rejected');input=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {content,omitted:null};throw e;}
  const result=bindKnowledgeGraph(content,input);
  return {content:{...content,knowledge:result.graph},omitted:result.omitted};
}
