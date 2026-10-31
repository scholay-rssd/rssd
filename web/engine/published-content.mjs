import {sectionsForSite,validateSectionId} from '../../contracts/site-sections.mjs';
import {sourceKey,permalink} from '../../admin/model.mjs';
import {validatePublishedContent,CONTENT_VERSION} from '../../contracts/published-content.mjs';
import {markdownImageDetails} from '../../scripts/article-format.mjs';
import {createHash} from 'node:crypto';
import {articleViewsFromMarkdown} from '../../scripts/article-metadata.mjs';

// Legacy names and positional columns are confined to this compatibility
// adapter. The Theme interface uses stable collection IDs and semantic types.
export function adaptPublishedSnapshot(snapshot,site){
 const collections=site.columns.map((name,i)=>({id:`column-${i+1}`,name,route:`/archive/column-${i+1}/`}));
 const items=[...(snapshot.news||[]).map(x=>({...x,kind:'news'})),...(snapshot.data?.year||[]).map(x=>({...x,kind:'year'})),...(snapshot.data?.history||[]).map(x=>({...x,kind:'history'})),...(snapshot.openSource?.items||[]).map(x=>({...x,kind:'openSource'}))];
 const records=items.map(x=>{
  const label=x.kind==='year'?site.columns[3]:x.kind==='history'?site.columns[4]:x.kind==='openSource'?site.columns[2]:x.category||site.columns[1];
  const sectionId=validateSectionId(x.sectionId,site),section=sectionsForSite(site).find(s=>s.id===sectionId);
  let collection=section?collections.find(c=>c.id===section.id):collections.find(c=>c.name===label);
  if(section&&!collection){collection={...section,route:`/archive/${section.id}/`};collections.push(collection);}
  if(!collection){collection={id:`extra-${collections.length+1}`,name:label,route:'/archive/'};collections.push(collection);}
  const id=sourceKey(x.kind,x),type=['year','history'].includes(x.kind)?'event':x.kind==='openSource'?'resource':'article';
  const record={id,type,title:x.title,route:snapshot.permalinks?.[id]||permalink(x.kind,x),collectionId:collection.id,...(sectionId?{sectionId}:{}),summary:x.summary||x.factSummary||'',bodyMarkdown:x.markdown||`# ${x.title}\n\n${x.summary||x.factSummary||''}\n\n${x.body||x.historicalSignificance||x.value||''}`,sources:(x.sources||[{label:x.sourceName||'原始来源',url:x.sourceUrl||x.url}]).filter(s=>/^https?:\/\//.test(s.url||'')).map(s=>({label:s.label||'原始来源',url:s.url})),publication:{date:x.date||null,author:x.author||site.author},legacy:{kind:x.kind}};
  const media=markdownImageDetails(record.bodyMarkdown).filter(({src})=>/^https?:\/\//.test(src)||/^\/article-media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(src)).map(({src,alt})=>({id:id+':image:'+createHash('sha256').update(src).digest('hex').slice(0,16),src,alt:alt||x.title}));
  if(media.length)record.media=media;
  const views=articleViewsFromMarkdown(record.bodyMarkdown);if(views)record.views=views;
  if(type==='event')record.event=x.kind==='history'?{mode:'historical',year:x.year,monthDay:x.dateKey}:{mode:x.recurrence?.frequency==='yearly'?'annual':'scheduled',start:x.start,...(x.end?{end:x.end}:{}),...(x.dateBasis?{dateBasis:x.dateBasis}:{}),recurrence:x.recurrence||null};
  return record;
 });
 return validatePublishedContent({version:CONTENT_VERSION,siteId:site.id,timezone:site.timezone,collections,records});
}
