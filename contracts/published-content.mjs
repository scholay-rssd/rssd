/** Read-only public-content contract. RSS source material and human drafts stay
 * local; this adapter accepts only the existing published server snapshot.
 * v1 is additive: it does not migrate databases or change publishing receipts. */
import {validateKnowledgeGraph} from './knowledge-graph.mjs';
import {validateArticleViews} from './article-views.mjs';
export const CONTENT_VERSION=1;
export function validatePublicMedia(items){
 if(!Array.isArray(items))throw Error('Invalid public media');
 const ids=new Set();
 for(const m of items){
  if(!m||typeof m.id!=='string'||!m.id||ids.has(m.id)||typeof m.alt!=='string')throw Error('Invalid public media identity');
  ids.add(m.id);
  const safe=value=>{
   if(typeof value!=='string'||/[\\\x00-\x20]/.test(value))return false;
   if(/^\/(?!\/)/.test(value))return !value.includes('..')&&!/%(?:2f|5c|2e)/i.test(value);
   try{const url=new URL(value);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password;}catch{return false;}
  };
  if(!safe(m.src)||(m.href&&!safe(m.href)))throw Error('Invalid public media URL');
  if(m.width!==undefined&&(!Number.isInteger(m.width)||m.width<1||!Number.isInteger(m.height)||m.height<1))throw Error('Invalid media dimensions');
 }
 return items;
}
export function validatePublishedContent(document){
 if(document?.version!==CONTENT_VERSION||!document.siteId||!Array.isArray(document.records)||!Array.isArray(document.collections))throw Error('Invalid published-content envelope');
 const ids=new Set(),collections=new Set(document.collections.map(x=>x.id));
 for(const item of document.records){
  if(!item.id||ids.has(item.id)||!['article','event','resource'].includes(item.type))throw Error('Invalid or duplicate content identity');
  ids.add(item.id);
  if(typeof item.title!=='string'||!item.title.trim()||!/^\/(?!\/)[^?#\\]*\/$/.test(item.route)||item.route.includes('..'))throw Error('Invalid public content route or title');
  if(!collections.has(item.collectionId)||typeof item.bodyMarkdown!=='string'||!Array.isArray(item.sources))throw Error('Invalid public content fields');
  if(item.type==='event'&&!['annual','scheduled','historical'].includes(item.event?.mode))throw Error('Invalid event mode');
  if(item.media!==undefined)validatePublicMedia(item.media);
  if(item.views!==undefined)validateArticleViews(item.views);
 }
 if(document.media!==undefined)validatePublicMedia(document.media);
 if(document.knowledge!==undefined){validateKnowledgeGraph(document.knowledge);if(document.knowledge.siteId!==document.siteId)throw Error('Knowledge belongs to another site');}
 return document;
}
