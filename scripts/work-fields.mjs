// A work's type, the long article a note was rewritten from and the work's own #tags, as the writing tools keep
// them in a local manuscript's publication metadata and send them with a draft save. Shared by the desktop
// screens, the publishing scripts and the headless producer, so it uses no Node or browser API.
//
// Metadata states a field only when the writer chose it or a Center read returned it. A stated empty tag list
// means the writer removed every tag. A Center that takes these fields keeps a field a save leaves out, so a save
// sends only what the metadata states; a Center that does not take them gets none of them.
import {SITE_SECTIONS,sectionsForSite} from '../contracts/site-sections.mjs';
import {CHOSEN_WORK_TYPES,MAX_TAG_LENGTH,MAX_WORK_TAGS,sectionWorkPolicy,validateAdaptedFrom,validateWorkTags,workTypeLabel} from '../contracts/work-types.mjs';

/** What a Center lists in its `/site` capabilities when its draft saves take these fields. */
export const WORK_TYPES_CAPABILITY='work-types-v1';
export const WORK_FIELD_KEYS=Object.freeze(['workType','adaptedFrom','tags']);

const bad=message=>{throw Object.assign(Error(message),{statusCode:400});};

function checkTags(tags){
  if(!Array.isArray(tags))bad('标签须为文字列表');
  if(tags.length>MAX_WORK_TAGS)bad('一个作品最多 '+MAX_WORK_TAGS+' 个标签');
  for(const tag of tags){
    if(typeof tag!=='string')bad('标签须为文字');
    if(tag.length>MAX_TAG_LENGTH)bad('每个标签最多 '+MAX_TAG_LENGTH+' 个字：'+tag.slice(0,12)+'…');
    if(/[\x00-\x1f]/.test(tag))bad('标签不能包含控制字符');
  }
  try{validateWorkTags(tags);}catch{bad('标签不能为空、带首尾空格、以 # 开头或重复');}
  return tags;
}

/**
 * Tags as a writer types them, in order: each trimmed, without its leading #, empties and repeats dropped. Text is
 * split at commas, 顿号, semicolons, line breaks and before a #, so "#AI #教育" gives two tags. Refuses what is
 * still too many or too long.
 */
export function normalizeTags(value){
  if(value===undefined||value===null||value==='')return [];
  const items=typeof value==='string'?value.split(/[,，、;；\n]|\s+(?=#)/):Array.isArray(value)?value:bad('标签须为文字列表');
  return checkTags([...new Set(items.map(tag=>typeof tag==='string'?tag.trim().replace(/^#+/,'').trim():bad('标签须为文字')).filter(Boolean))]);
}

/** The work fields metadata states. A malformed value is left out, so an odd file never stops a list from loading. */
export function workFieldsOf(data){
  const workType=CHOSEN_WORK_TYPES.includes(data?.workType)?data.workType:undefined;
  let adaptedFrom,tags;
  try{adaptedFrom=validateAdaptedFrom(data?.adaptedFrom,{type:workType});}catch{/* only a note keeps its source */}
  try{tags=Array.isArray(data?.tags)&&!data.tags.length?[]:validateWorkTags(data?.tags);}catch{/* left out */}
  return {...(workType?{workType}:{}),...(adaptedFrom?{adaptedFrom}:{}),...(tags?{tags}:{})};
}

/**
 * What a section takes, from what the site declares. A Center leaves `workTypes` out of the sections it lists, so a
 * catalog section that declares nothing falls back to the site's own section list before taking the default.
 */
export function declaredWorkSection(site,sectionId){
  if(!sectionId)return undefined;
  const lists=[site?.sectionCatalog?.sections,site?.sections,SITE_SECTIONS[site?.id]];
  return lists.map(list=>Array.isArray(list)?list.find(section=>section?.id===sectionId):undefined).find(section=>section&&(section.workTypes!==undefined||section.articleCards!==undefined));
}
export const sectionPolicyFor=(site,sectionId)=>sectionWorkPolicy(declaredWorkSection(site,sectionId));

/**
 * A writer's change to the work fields. A key the change leaves out keeps what the metadata has, null clears it,
 * tags are normalized, and choosing a type other than note drops the source article unless the change names one.
 * Check the result with checkWorkFields before keeping it.
 */
export function applyWorkFields(before,change){
  const next=workFieldsOf(before);
  if(Object.hasOwn(change,'workType')){
    if(change.workType===null||change.workType===undefined||change.workType==='')delete next.workType;else next.workType=change.workType;
    if(next.workType!=='note'&&!Object.hasOwn(change,'adaptedFrom'))delete next.adaptedFrom;
  }
  if(Object.hasOwn(change,'adaptedFrom')){if(change.adaptedFrom===null||change.adaptedFrom===undefined)delete next.adaptedFrom;else next.adaptedFrom=change.adaptedFrom;}
  if(Object.hasOwn(change,'tags'))next.tags=normalizeTags(change.tags);
  return Object.fromEntries(WORK_FIELD_KEYS.filter(key=>next[key]!==undefined).map(key=>[key,next[key]]));
}

/**
 * Refuses work fields a work cannot keep: a type its section does not take, a type on a structured record (its
 * record kind fixes the type), a source article on anything but a note, and malformed tags.
 */
export function checkWorkFields(fields={},{site,sectionId,articleId,record=false}={}){
  const {workType,adaptedFrom,tags}=fields;
  if(workType!==undefined&&workType!==null){
    if(!CHOSEN_WORK_TYPES.includes(workType))bad('作品类型只能是长文或笔记');
    if(record)bad('结构化记录的类型由记录种类决定，不能另选作品类型');
    const policy=sectionPolicyFor(site,sectionId);
    if(!policy.workTypes.includes(workType)){
      const name=sectionId?sectionsForSite(site||{}).find(section=>section.id===sectionId)?.name||sectionId:'未归栏';
      bad('「'+name+'」不收'+workTypeLabel(workType)+'，可选：'+policy.workTypes.map(type=>workTypeLabel(type)).join('、'));
    }
  }
  if(adaptedFrom!==undefined&&adaptedFrom!==null){
    if(workType!=='note')bad('只有笔记可以注明改写自哪篇长文');
    if(articleId!==undefined&&adaptedFrom?.articleId===articleId)bad('笔记不能注明改写自自身');
    try{validateAdaptedFrom(adaptedFrom,{type:'note'});}catch{bad('改写来源须写明长文编号和版本');}
  }
  if(tags!==undefined&&tags!==null)checkTags(tags);
  return fields;
}

/** The fields a draft save sends to a Center that takes them: what the metadata states, never a type or source for a structured record. */
export function workFieldsForCenter(meta,{record=false}={}){
  const {workType,adaptedFrom,tags}=workFieldsOf(meta);
  return {...(!record&&workType?{workType}:{}),...(!record&&workType==='note'&&adaptedFrom?{adaptedFrom}:{}),...(tags?{tags}:{})};
}
