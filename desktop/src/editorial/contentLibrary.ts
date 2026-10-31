import {sectionsForSite} from '../../../contracts/site-sections.mjs';
import {ACTIVE_SITE,onActiveSiteChange} from '../../../scripts/site-profile.mjs';
import type {Publication,Snapshot,WebsiteItem} from '../publications/model';
import type {WebsiteDraft} from '../publications/websitePublishing';
import {WRITING_TYPES,writingTypes} from '../../scripts/agent/notebook.mjs';
import {typeOfColumn} from '../../scripts/agent/destinations.mjs';
import { trKey } from "../trKey";

const buildCategories=()=>sectionsForSite(ACTIVE_SITE).map(s=>s.name);
export let CATEGORIES=buildCategories();
export type Category=typeof CATEGORIES[number];
// Where a work can be edited or published. Third-party releases are not a location: they are read-only records attached to a work.
export type Location='local'|'cloud';
export type PublicationState='public'|'unpublished'|'withdrawn';
/** `type` is how the work was produced; `category` is the column it is used in at the destination. */
export type Work={id:string;title:string;type:string;types?:string[];category:Category;sectionId?:string;locations:Location[];status:PublicationState|null;local?:WebsiteDraft;cloud?:WebsiteItem;external:Publication[];date:string};
export type Filters={query:string;status:PublicationState[];location:Location[];type:string[];category:Category[];english?:'missing'};
export const EMPTY_FILTERS:Filters={query:'',status:[],location:[],type:[],category:[]};
const buildGroups=()=>([
  {key:'publication',label:'发布状态',sections:[
    {key:'location',tags:[['local','本地'],['cloud','云端']]},
  ]},
  {key:'category',label:'用途',sections:[{key:'category',tags:CATEGORIES.map(x=>[x,x])}]},
] as const);
export let GROUPS=buildGroups();
export const PUBLICATION_LABELS={public:trKey('已公开'),unpublished:trKey('未公开'),withdrawn:trKey('未公开')} as const;
export const LOCATION_LABELS:Record<Location,string>={local:trKey('本地'),cloud:trKey('云端')};
export const normalizeCategory=(name?:string):Category|undefined=>ACTIVE_SITE.id==='scholay-today'&&name==='学术情报'?'今日学术':name==='新闻聚合'||name==='学术新闻'?'学界犀闻':(CATEGORIES.includes(name as Category)||ACTIVE_SITE.columns.includes(name||'')||ACTIVE_SITE.legacy&&['学界犀闻','学者观察','昔日学术','学术情报','学术开源'].includes(name||''))?name as Category:undefined;
const sectionName=(id?:string)=>sectionsForSite(ACTIVE_SITE).find(s=>s.id===id)?.name;
// Match the academic site's read-only projection of legacy calendar records.
const academicCalendarCategory=(kind?:string|null)=>ACTIVE_SITE.id==='scholay-today'?(kind==='year'||kind==='calendar'?sectionName('calendar'):kind==='history'?sectionName('history'):undefined):undefined;
const localCategory=(d:WebsiteDraft)=>d.archiveCategory==='未归栏'||d.canonicalPath.includes('/未归栏/')?'未归栏':sectionName(d.sectionId||d.metadata?.sectionId)||academicCalendarCategory(d.recordKind)||normalizeCategory(d.archiveCategory);
export function websiteCategory(x:WebsiteItem):Category{return sectionName(x.sectionId)||academicCalendarCategory(x.kind)||(x.kind==='year'?ACTIVE_SITE.columns[3]:x.kind==='history'?ACTIVE_SITE.columns[4]:x.kind==='openSource'?ACTIVE_SITE.columns[2]:normalizeCategory(x.category)||ACTIVE_SITE.columns[1]);}
export const cloudIsPublic=(x:WebsiteItem)=>x.publishedVersion===undefined?true:x.publishedVersion!==null;
export const localDraftDate=(draft?:WebsiteDraft)=>draft?.metadata?.date?.trim()||draft?.batchDate||'';
export const missingEnglish=(w:Work)=>w.cloud?.english==='missing';
export const workSummary=(work:Work)=>work.local?.metadata?.summary?.trim()||work.cloud?.summary||'';

// IDs and explicit publishing-package aliases identify a work. Similar titles
// never merge unrelated manuscripts or third-party records.
export function collectWorks(local:WebsiteDraft[],snapshot:Snapshot,tasks:{articleId:string;completedAt?:string;workIds:string[];notebook?:{skills:string[]}}[]=[]):Work[]{
  const aliases=new Map<string,string>();
  for(const x of snapshot.bindings||snapshot.drafts){for(const key of [x.id,...x.sourceIds||[]]){
    const prior=aliases.get(key);if(prior&&prior!==x.id)throw Error('作品编号映射冲突，请检查发布索引');aliases.set(key,x.id);
  }}
  const works=new Map<string,Work>();
  const obtain=(id:string,title:string)=>{let work=works.get(id);if(!work){work={id,title,type:'observation',category:'学者观察',locations:[],status:null,external:[],date:''};works.set(id,work);}return work;};
  for(const d of local){const w=obtain(d.id,d.shortTitle);w.local=d;w.category=localCategory(d)||(/\/新闻聚合\//.test(d.canonicalPath)?'学界犀闻':/\/学术开源\//.test(d.canonicalPath)?'学术开源':'学者观察');w.date=localDraftDate(d);w.locations.push('local');}
  for(const c of snapshot.website.items){const id=c.articleId||'cloud:'+c.key,w=obtain(id,c.title);w.cloud=c;w.category=w.local?localCategory(w.local)||websiteCategory(c):websiteCategory(c);if(!w.local)w.title=c.title;w.date=w.date||c.lastmod||c.dateLabel;w.locations.push('cloud');w.status=cloudIsPublic(c)?'public':c.publicationState==='withdrawn'?'withdrawn':'unpublished';}
  // A draft made by the workbench records its task type. Older and cloud-only works take the type whose posts their column receives.
  for(const w of works.values()){
    w.sectionId=w.local?.sectionId||w.local?.metadata?.sectionId||w.cloud?.sectionId||(w.category==='未归栏'?undefined:sectionsForSite(ACTIVE_SITE).find(s=>s.name===w.category||s.aliases?.includes(w.category))?.id);
    if(w.sectionId)w.category=sectionName(w.sectionId)||w.category;
    else if(w.local?.archiveCategory==='未归栏'||w.local?.canonicalPath.includes('/未归栏/'))w.category='未归栏';
    // Explicit skill snapshots survive saving; completed notebook tasks recover
    // pre-snapshot drafts by stable ID without rewriting their files or index.
    const prior=tasks.filter(t=>t.completedAt&&t.articleId===w.id&&t.workIds.includes(w.id)&&t.notebook).sort((a,b)=>b.completedAt!.localeCompare(a.completedAt!))[0];
    const skills=w.local?.writingSkills??prior?.notebook?.skills;
    w.types=skills!==undefined?writingTypes(skills):[w.local?.type&&Object.hasOwn(WRITING_TYPES,w.local.type)?w.local.type:w.cloud?.kind==='year'?'calendar':w.cloud?.kind==='history'?'history':typeOfColumn(w.category)||(ACTIVE_SITE.id==='scholay-today'&&w.category===sectionName('calendar')?'calendar':'observation')];
    w.type=w.types[0];
  }
  // Ledger records only decorate a work that exists here, matched by stable ID or explicit alias. Records with no link, or whose work is not local or cloud, stay in the publication center.
  for(const r of snapshot.feishu.records){const w=r.sourceId?works.get(aliases.get(r.sourceId)||r.sourceId):undefined;if(!w)continue;w.external.push(r);w.date=w.date||r.publishedAt||r.submittedAt||'';}
  // Publication state comes from the authoritative cloud snapshot. Historic
  // unpublished drafts remain pending; they are never silently published.
  return [...works.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title,'zh'));
}
const matchesSection=(w:Work,tag:string)=>tag==='__unassigned__'?!w.sectionId&&!sectionsForSite(ACTIVE_SITE).some(s=>s.name===w.category||s.aliases?.includes(w.category)):w.sectionId===tag||w.category===tag||sectionsForSite(ACTIVE_SITE).some(s=>s.id===tag&&(s.name===w.category||s.aliases?.includes(w.category)));
export function matchesWork(w:Work,f:Filters,skip?:'status'|'location'|'type'|'category'){
  return (skip==='status'||!f.status.length||(w.status!==null&&f.status.includes(w.status)))&&
    (skip==='location'||!f.location.length||f.location.some(x=>w.locations.includes(x)))&&
    (skip==='type'||!f.type.length||f.type.some(type=>(w.types||[w.type]).includes(type)))&&
    (skip==='category'||!f.category.length||f.category.some(tag=>matchesSection(w,tag)))&&
    (!f.english||w.cloud?.english===f.english)&&
    [w.title,w.local?.canonicalPath,workSummary(w),...w.external.map(x=>x.platform+' '+x.title)].join(' ').toLocaleLowerCase().includes(f.query.trim().toLocaleLowerCase());
}
export function tagCount(works:Work[],f:Filters,group:'status'|'location'|'type'|'category',tag:string){return works.filter(w=>matchesWork(w,f,group)&&(group==='status'?w.status===tag:group==='type'?(w.types||[w.type]).includes(tag):group==='category'?matchesSection(w,tag):w.locations.includes(tag as Location))).length;}
export function workActions(w:Work){return {local:!!w.local,cloud:!!w.cloud,canPublish:!!w.cloud&&(!cloudIsPublic(w.cloud)||w.cloud.version!==undefined&&w.cloud.version!==w.cloud.publishedVersion),canWithdraw:!!w.cloud&&cloudIsPublic(w.cloud),externalReadOnly:w.external.length>0};}

onActiveSiteChange(()=>{CATEGORIES=buildCategories();GROUPS=buildGroups();});
