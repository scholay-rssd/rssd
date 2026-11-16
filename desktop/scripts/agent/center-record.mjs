import recordContract from '../../../contracts/rssd-record.cjs';
import {sectionWritingMode} from '../../../contracts/site-sections.mjs';
import {profiles} from '../../../scripts/site-config.mjs';
import {validate,day} from '../../../admin/model.mjs';
import {recordHeadings} from '../../../scripts/editorial-record.mjs';

// Calendar and history columns publish dated records, not ordinary articles.
// A Center order inherits its column's record kind, so every device that
// writes the column returns the same structured fields.
const KIND_BY_MODE={calendar:'year',history:'history'};
export const recordKindForMode=mode=>KIND_BY_MODE[mode]||null;

// The frozen baseline owns the task's mode; the section catalog is only the
// fallback for tasks claimed without an online baseline.
export function centerRecordKind({claim,source,writingSkills}){
 if(source||claim?.kind==='translate')return null;
 const site=profiles.find(p=>p.spaceId===claim?.workspaceId);
 const mode=writingSkills?.defaults?.baseline?.mode??(site?sectionWritingMode(site,claim.sectionId):undefined);
 return recordKindForMode(mode);
}

// The record id follows the Center demand, so a regenerated or recovered
// output for the same order keeps the same calendar identity.
export function centerRecordContext(input){
 const recordKind=centerRecordKind(input);
 return recordKind?{recordKind,...(input.claim?.id?{recordId:recordKind+':center:'+input.claim.id}:{})}:{};
}

// Headings come from the same definition notebookMarkdown uses, so a heading
// the model is told to write is never demoted to a subsection.
const headingList=kind=>recordHeadings(kind).map(label=>'“'+label+'”').join('');
export function centerRecordInstructions(kind,{workspaceId}={}){
 if(kind==='year'){
  const categories=profiles.find(p=>p.spaceId===workspaceId)?.yearCategories||[];
  return '本栏目交付 kind="year" 的年度日历记录，不是普通文章。fields 必须填写：category（只能是：'+categories.join('、')+'），start（YYYY-MM-DD，事项实际发生、开放或截止的日期，不能用公告发布日代替），end（有结束日填 YYYY-MM-DD，否则 null），dateBasis（一句话写明 start/end 各是什么日期及时区，例如“申请截止：北京时间 16:00”），sourceName（发布日期依据的机构或主办方），sourceUrl（实际已读、写明该日期的原文链接），tags（字符串数组）。正文 blocks 中必须且只能各有一个二级标题'+headingList('year')+'，按此顺序，第一个标题之前不放正文；摘要只写文字，图片、引用和参考文献放在最后一个章节内，参考文献用三级标题。原文无法确认日期时不要估算，停止交付并说明原因。';
 }
 if(kind==='history')return '本栏目交付 kind="history" 的历史事件记录，不是普通文章或近期新闻。只写一个能核实到具体日期的真实历史事件。fields 必须填写：year（发生年份，整数），dateKey（MM-DD，事件发生日，不是报道日或出版日以外的推测日期），domain（学科史领域，例如“统计学史”），eventType（事件类型，例如“论文发表”“人物诞生”“首次实现”），importance（S、A 或 B），preciseToDay（true）。sources 至少一条写明该日期的一手或权威来源。正文 blocks 中必须且只能各有一个二级标题'+headingList('history')+'，按此顺序，第一个标题之前不放正文；图片、引用和参考文献放在最后一个章节内，参考文献用三级标题。日期只能精确到年或月时不要交付，说明原因。';
 return '';
}

// Rewrite the example notebook kind so the model sees the column's record type.
export function outputForRecordKind(output,kind,context){
 if(!kind)return output;
 return output.replace('"kind":"article"','"kind":"'+kind+'"')+'\n'+centerRecordInstructions(kind,context);
}

const integer=value=>typeof value==='string'&&/^\d{1,4}$/.test(value.trim())?Number(value.trim()):value;
// Build the publishable record from the completed notebook and its generated
// Markdown. The publication contract re-derives prose sections from the same
// headings, so missing or reordered headings fail here instead of at the site.
export function centerRecord(kind,n,{bodyMarkdown,workspaceId,recordId}){
 if(n.kind!==kind)throw Error('本栏目需要 '+kind+' 结构化记录，智能体返回了 '+n.kind+'；输出已保留');
 const site=profiles.find(p=>p.spaceId===workspaceId);
 if(!site)throw Error('结构化记录缺少站点配置：'+workspaceId);
 const fields=n.fields&&typeof n.fields==='object'&&!Array.isArray(n.fields)?n.fields:{};
 const sources=n.sources.map(s=>({label:s.title,url:s.url}));
 const candidate={...fields,sectionId:n.sectionId,...(kind==='year'?{tags:Array.isArray(fields.tags)?fields.tags:[],provenance:'原文资料'}:{}),...(kind==='history'?{year:integer(fields.year),sources}:{})};
 if(kind==='history'&&candidate.preciseToDay!==true)throw Error('昔日学术只收录能核实到具体日期的事件（preciseToDay=true）；输出已保留');
 let sections;
 try{sections=recordContract.recordFields({kind,fields:candidate},{title:n.title,bodyMarkdown});}
 catch(error){throw Error('结构化记录：'+error.message+'；输出已保留');}
 let validated;
 try{validated=validate(kind,{...candidate,...sections,title:n.title},{id:recordId},site);if(kind==='history')day(String(validated.year).padStart(4,'0')+'-'+validated.dateKey);}
 catch(error){throw Error('结构化记录：'+error.message+'；输出已保留');}
 return recordContract.record({kind,fields:validated});
}
