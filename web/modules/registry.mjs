import {calendarModule} from './calendar/index.mjs';
import {galleryModule} from './gallery/index.mjs';
import {graphModule} from './graph/index.mjs';
import {showcaseModule} from './showcase/index.mjs';
import {roadmapModule} from './roadmap/index.mjs';
import {bindKnowledgeGraph} from '../engine/knowledge-graph.mjs';
import {validateDisplay} from '../../contracts/display-modules.mjs';
// Trusted, repository-owned modules only. Themes choose styling, sites choose
// enabled views; no module receives databases, credentials or private RSS.
export const DISPLAY_MODULES=Object.freeze({calendar:calendarModule,gallery:galleryModule,graph:graphModule,showcase:showcaseModule,roadmap:roadmapModule});
export function resolveDisplay(site){
  // A profile without display settings gets the calendar only. Which modules
  // a site shows is the profile's decision, never inferred from its name.
  const config=validateDisplay(site.display||{version:1,modules:{calendar:{enabled:true}}});
  return {...config,modules:Object.fromEntries(Object.keys(DISPLAY_MODULES).map(id=>[id,config.modules[id]||{enabled:false}]))};
}
export function createDisplayHost(content){
  // Own a frozen copy so even an accidental module mutation cannot alter an
  // article or another module's view of the publication.
  const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
  const document=freeze(structuredClone(content)),byId=new Map(document.records.map(x=>[x.id,x]));
  const graph=document.knowledge?freeze(bindKnowledgeGraph(document,document.knowledge).graph):freeze({version:1,siteId:document.siteId,nodes:[],relations:[]});
  const match=(x,options)=>!options.collections?.length||options.collections.includes(x.collectionId);
  return Object.freeze({siteId:document.siteId,timezone:document.timezone,
    records:(options={})=>document.records.filter(x=>match(x,options)),
    knowledge:(options={})=>{
      const selected=new Set(document.records.filter(x=>match(x,options)).map(x=>x.id));
      const nodes=graph.nodes.filter(n=>n.evidence.every(e=>selected.has(e.recordId))),ids=new Set(nodes.map(n=>n.id));
      return {version:1,siteId:graph.siteId,nodes,relations:graph.relations.filter(r=>ids.has(r.from)&&ids.has(r.to)&&r.evidence.every(e=>selected.has(e.recordId)))};
    },
    permalink:record=>{const found=byId.get(record.id);if(!found)throw Error('Unknown public record');return found.route;},
    media:(options={})=>[...(document.media||[]),...document.records.flatMap(r=>(r.media||[]).map(m=>({...m,recordId:r.id,href:r.route,collectionId:r.collectionId,group:document.collections.find(c=>c.id===r.collectionId)?.name})))].filter(x=>match(x,options)),
  });
}
export async function renderDisplayModules({site,content,now=new Date()}){
  if(content.siteId!==site.id)throw Error('Display content belongs to another site');
  const config=resolveDisplay(site),host=createDisplayHost(content),pages=[];
  const reserved=new Set(Object.values(DISPLAY_MODULES).map(m=>m.route));
  for(const record of content.records)if(reserved.has(record.route))throw Error('Content route conflicts with display module: '+record.route);
  for(const [id,options] of Object.entries(config.modules)){
    if(!options.enabled)continue;
    const module=DISPLAY_MODULES[id];
    if(module.contentVersion!==content.version)throw Error('Unsupported module content version');
    const collections=new Set([...content.collections.map(c=>c.id),...(content.media||[]).map(m=>m.collectionId)]);
    for(const key of options.collections||[])if(!collections.has(key))throw Error('Unknown module collection: '+key);
    pages.push({id,version:module.version,route:module.route,label:module.label,...await module.render({host,options,now:new Date(now)})});
  }
  return {config,pages};
}
