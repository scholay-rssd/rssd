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
 *
 * `voice` is the claim's frozen voice decision (`decideVoice` in persona-voice.mjs), for a section that has
 * a voice instead of a persona byline. A chosen voice is recorded in the private `metadata.voice`
 * ({id,revision,snapshotHash} of the preset that wrote), which no public packet carries either. When the
 * section signs with the persona, the founder the preset came from signs, as `persona` does above; when it
 * signs with the site, the site's byline stays and `metadata.persona` is left out. An edition that has a
 * source keeps the source's byline, persona and voice, whatever the claim decided.
 */
export function withEditionByline(edition,{source,site,persona,voice,presetRecord=false}={}){
 const prior=source?.payload?.metadata||{},metadata={...(edition?.metadata||{})};
 const wrote=voice?.state==='chosen'&&filled(voice.persona?.id)&&filled(voice.persona?.revision)&&filled(voice.persona?.snapshotHash)?voice.persona:null;
 if(wrote&&voice.byline==='persona'&&filled(wrote.founder?.id)&&filled(wrote.founder?.name))persona=wrote.founder;
 else if(voice)persona=null;
 const signed=filled(persona?.name)&&filled(persona?.id)?persona:null;
 for(const key of ['author','category']){
  const value=filled(prior[key])||(key==='author'&&signed?signed.name:'')||filled(site?.[key]);
  if(value)metadata[key]=value;else delete metadata[key];
 }
 // Which persona signed: the source edition's when the byline came from it, else this claim's.
 const from=filled(prior.author)?(filled(prior.persona?.id)?{id:prior.persona.id}:null):signed?{id:signed.id}:null;
 if(from)metadata.persona=from;else delete metadata.persona;
 // Which preset wrote: the source edition's when there is a source, else this claim's.
 const kept=prior.voice;
 let by=source?.payload?(filled(kept?.id)&&filled(kept?.revision)&&filled(kept?.snapshotHash)?kept:null):wrote;
 if(presetRecord && by && wrote && voice.method==='kept' && by.id===wrote.id && by.revision===wrote.revision)by=wrote;
 if(by)metadata.voice={id:by.id,revision:by.revision,snapshotHash:by.snapshotHash};else delete metadata.voice;
 // Current Centers use the preset as the private signing reference as well. Older Centers still validate
 // the founder ID. English attribution comes from the same author field for both record formats.
 if(presetRecord && from && by)metadata.persona={id:by.id};
 return {...edition,metadata};
}
