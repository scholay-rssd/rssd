import type {Notebook,NoteSource,Brand,MountedWritingSkill,TitleTemplate,NoteBlock,NoteGroup} from '../../scripts/agent/notebook.mjs';
import {DEFAULT_TITLE_TEMPLATE,type ContentTemplate} from '../../scripts/agent/notebook-templates.mjs';
import {starterTemplate,templateForArticle} from './notebookTemplates';
import type {SectionSite} from '../../../contracts/site-sections.mjs';
import {sectionWritingMode} from '../../../contracts/site-sections.mjs';
import type {TemplateMode} from './topicTemplates';
import type {TurnAttachment} from './notebookAttachments';

export type TurnContext={files?:TurnAttachment[];template?:ContentTemplate;titleTemplate?:TitleTemplate;skills:MountedWritingSkill[];brands:Brand[];sources:NoteSource[];webEnabled:boolean;endnotes?:NoteBlock[];defaultIds?:string[]};
export type NotebookTurn={id:string;text:string;createdAt:string;status:'running'|'ready'|'interrupted';context:TurnContext;candidate?:Notebook;sources?:NoteSource[];items:{id:string;kind:'title'|'blocks'|'fields'|'source'|'internal';field?:string;noteText?:string;blockId?:string;anchor?:{type:string;text:string};label:string;source?:NoteSource;after?:{kind:string;fields:Record<string,unknown>};blocks?:NoteBlock[];group?:NoteGroup;accepted?:boolean}[]};
export const emptyTurn=():TurnContext=>({skills:[],brands:[],sources:[],webEnabled:false});
const SKILL:Partial<Record<TemplateMode,string>>={xiwen:'scholay-xiwen',observation:'scholay-scholar-observation',opensource:'scholay-academic-opensource',calendar:'scholay-academic-calendar',history:'scholay-academic-history'};
export function sectionTurnDefaults(siteId:string|SectionSite,sectionId:string,skills:MountedWritingSkill[],brands:Brand[],first:boolean):TurnContext{
 const mode=sectionWritingMode(siteId,sectionId);
 if(!mode)return emptyTurn();
 const selected=skills.filter(s=>['site-writing',SKILL[mode]||'copy-editing'].includes(s.id));
 const defaults=selected.map(s=>'skill:'+s.id);
 if(brands[0])defaults.push('brand:'+brands[0].id);
 if(first)defaults.push('template','title-template');
 return {...emptyTurn(),...(first?{template:templateForArticle(starterTemplate(mode),mode),titleTemplate:DEFAULT_TITLE_TEMPLATE}:{}),skills:selected,brands:brands.slice(0,1),defaultIds:defaults};
}
export function mergeTurnDefaults(current:TurnContext,next:TurnContext):TurnContext{
 const old=new Set(current.defaultIds||[]);
 return {...current,template:old.has('template')||!current.template?next.template:current.template,titleTemplate:old.has('title-template')||!current.titleTemplate?next.titleTemplate:current.titleTemplate,
 skills:[...current.skills.filter(s=>!old.has('skill:'+s.id)),...next.skills.filter(s=>!current.skills.some(x=>x.id===s.id&&!old.has('skill:'+x.id)))],
 brands:[...current.brands.filter(s=>!old.has('brand:'+s.id)),...next.brands.filter(s=>!current.brands.some(x=>x.id===s.id&&!old.has('brand:'+x.id)))],defaultIds:next.defaultIds};
}
export const hasNotebookContent=(n?:Notebook)=>!!n&&(!!n.title.trim()||n.blocks.some(b=>!!b.text.trim()||!!b.requirement?.trim()));
