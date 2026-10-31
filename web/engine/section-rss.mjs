import {sectionsForSite} from '../../contracts/site-sections.mjs';
import {renderRssFeed} from './rss-feed.mjs';
// Discourse's polling lock is keyed by URL, before its category filter runs.
// Distinct static feeds preserve every column while transferring each body once.
export function sectionRssFeeds(site,records){
 return sectionsForSite(site).map(section=>{
  const path='feeds/'+section.id+'.xml';
  const items=records.filter(r=>r.category===section.name).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.route.localeCompare(b.route)).slice(0,20);
  return {path,xml:renderRssFeed({...site,name:site.name+' · '+section.name},items,{feedPath:'/'+path})};
 });
}
