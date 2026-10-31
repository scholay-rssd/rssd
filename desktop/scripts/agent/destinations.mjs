import {ACTIVE_SITE,onActiveSiteChange} from '../../../scripts/site-profile.mjs';
// Where finished posts go. The production engine produces a post by task type and never names a
// column or a site record; this profile is the only place that maps a type to the destination's
// column, record kind, field list and acceptance checks. Another site is another profile.
//
// Scholay Today files drafts under a column folder and, for structured types, binds them to one of
// its record kinds (year, history, openSource). Those names must match the website's own definitions
// in scripts/editorial-record.mjs and scripts/archive-taxonomy.mjs; a test keeps them in step.
import {taskType} from './task-types.mjs';

export const SCHOLAY_TODAY={id:'scholay-today',name:'Scholay Today',uses:{
 xiwen:{column:'学界犀闻'},
 observation:{column:'学者观察'},
 opensource:{column:'学术开源',record:{kind:'openSource',fields:'title/date/category/summary/value/url/relatedUrl/status',placement:'引用、流程与占位图放入学术价值'}},
 calendar:{column:'学术情报',record:{kind:'year',fields:'start/end/category/tags/dateBasis/sourceName/sourceUrl/provenance/reviewedAt',placement:'摘要不放图片，解释、引用与占位图放入正文',
  verify(fields){if(!['已核验官网','已核验'].includes(fields.provenance))throw Error('事项来源尚未核验');}}},
 history:{column:'昔日学术',record:{kind:'history',fields:'year/dateKey/domain/eventType/importance/factSummary/historicalSignificance/sources/preciseToDay',placement:'解释、引用和占位图放入学术意义',
  verify(fields){const date=String(fields.year).padStart(4,'0')+'-'+fields.dateKey;if(!fields.preciseToDay||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('历史事件需要实际年份下有效的完整发生日期');}}},
}};
const buildCurrentDestination=()=>(ACTIVE_SITE.legacy?SCHOLAY_TODAY:{...SCHOLAY_TODAY,id:ACTIVE_SITE.id,name:ACTIVE_SITE.name,uses:Object.fromEntries(['xiwen','observation','opensource','calendar','history'].map((mode,i)=>[mode,{...SCHOLAY_TODAY.uses[mode],column:ACTIVE_SITE.columns[i],...(SCHOLAY_TODAY.uses[mode].record?{record:{...SCHOLAY_TODAY.uses[mode].record,fields:SCHOLAY_TODAY.uses[mode].record.fields+(mode==='calendar'?'/recurrence（年度惯例填 frequency=yearly、monthDay、leapDay）':''),placement:mode==='history'?'解释、引用和配图放入历史意义':mode==='opensource'?'引用、说明和配图放入使用价值':SCHOLAY_TODAY.uses[mode].record.placement}}:{})}]))});
export let CURRENT_DESTINATION=buildCurrentDestination();
/** How the destination uses posts of this task type, or null when it has no place for them. */
export const destinationUse=(mode,profile=CURRENT_DESTINATION)=>Object.hasOwn(profile.uses,mode)?profile.uses[mode]:null;
/** The destination's record for a structured type; null for free-form posts. */
export const destinationRecord=(mode,profile=CURRENT_DESTINATION)=>taskType(mode)?.structured?destinationUse(mode,profile)?.record||null:null;
/** What the workspace needs to file a new draft of this type: placement comes from the profile, never from the agent. */
export function draftPlacement(mode,fields,profile=CURRENT_DESTINATION){
 const use=destinationUse(mode,profile);if(!use)throw Error('当前发布目标没有这一类内容的位置');
 const record=destinationRecord(mode,profile);
 if(record&&(!fields||typeof fields!=='object'||Array.isArray(fields)))throw Error('结构化稿件需要在 fields 中提供已核实的日期与来源字段');
 return {column:use.column,archiveCategory:use.column,type:mode,...(record?{record:{kind:record.kind,fields}}:{})};
}
/** Columns a finished post of this type may be used in. A structured post is bound to its record's column;
 *  a free-form post is proposed its type's column and may be placed in any other. The proposal comes first. */
export function useOptions(mode,profile=CURRENT_DESTINATION){
 const use=destinationUse(mode,profile);if(!use)return [];
 if(destinationRecord(mode,profile))return [use.column];
 return [use.column,...Object.values(profile.uses).map(x=>x.column).filter(column=>column!==use.column)];
}
/** The task type whose posts this column receives by default; null for a column the profile does not know. */
export const typeOfColumn=(column,profile=CURRENT_DESTINATION)=>Object.keys(profile.uses).find(mode=>profile.uses[mode].column===column)||null;

onActiveSiteChange(()=>{CURRENT_DESTINATION=buildCurrentDestination();});
