import {sectionsForSite} from './site-sections.mjs';

// Byline and category of a device-produced Center edition. The frozen claim
// owns them, as it owns sectionId: a translation or update keeps the value of
// the edition it came from, and anything else takes the site's byline and the
// section's display name, for every language, unless the section's frozen policy
// names a persona, whose name is then the byline. The writing agent's own
// author/category is never used.
const filled=value=>typeof value==='string'&&value.trim()?value:'';

export function siteByline(profiles,workspaceId,sectionId){
 const site=(Array.isArray(profiles)?profiles:[]).find(s=>s?.spaceId===workspaceId);
 const section=site?sectionsForSite(site).find(s=>s?.id===sectionId):null;
 return {author:filled(site?.author),category:filled(section?.name)};
}

/**
 * `persona` is the claim's frozen `policy.persona` ({id,name}), if the section has one. Its name is the byline
 * of a new work in every language; a translation or update keeps the byline of the edition it came from, and
 * with it the persona that edition recorded. The persona's ID is kept in the edition's private metadata
 * (`metadata.persona`), which no public packet carries.
 */
export function withEditionByline(edition,{source,site,persona}={}){
 const prior=source?.payload?.metadata||{},metadata={...(edition?.metadata||{})};
 const signed=filled(persona?.name)&&filled(persona?.id)?persona:null;
 for(const key of ['author','category']){
  const value=filled(prior[key])||(key==='author'&&signed?signed.name:'')||filled(site?.[key]);
  if(value)metadata[key]=value;else delete metadata[key];
 }
 // Which persona signed: the source edition's when the byline came from it, else this claim's.
 const from=filled(prior.author)?(filled(prior.persona?.id)?{id:prior.persona.id}:null):signed?{id:signed.id}:null;
 if(from)metadata.persona=from;else delete metadata.persona;
 return {...edition,metadata};
}
