import {sectionsForSite} from './site-sections.mjs';

// Byline and category of a device-produced Center edition. The frozen claim
// owns them, as it owns sectionId: a translation or update keeps the value of
// the edition it came from, and anything else takes the site's byline and the
// section's display name, for every language. The writing agent's own
// author/category is never used.
const filled=value=>typeof value==='string'&&value.trim()?value:'';

export function siteByline(profiles,workspaceId,sectionId){
 const site=(Array.isArray(profiles)?profiles:[]).find(s=>s?.spaceId===workspaceId);
 const section=site?sectionsForSite(site).find(s=>s?.id===sectionId):null;
 return {author:filled(site?.author),category:filled(section?.name)};
}

export function withEditionByline(edition,{source,site}={}){
 const prior=source?.payload?.metadata||{},metadata={...(edition?.metadata||{})};
 for(const key of ['author','category']){
  const value=filled(prior[key])||filled(site?.[key]);
  if(value)metadata[key]=value;else delete metadata[key];
 }
 return {...edition,metadata};
}
