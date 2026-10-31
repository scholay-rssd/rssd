import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import {domainType} from '../../scripts/agent/domain-pack.mjs';
import {WRITING_SKILLS} from '../../scripts/agent/notebook.mjs';
import {TEMPLATE_MODES,type ContentTemplate} from '../../scripts/agent/notebook-templates.mjs';
import {readLibrary,defaultTemplates,templatePrompt,type TemplateMode,type TopicTemplate} from './topicTemplates';
import {TEMPLATE_SETTING} from './topicSources';
const SINGLE_DIRECTIONS:Partial<Record<TemplateMode,[string,string][]>>={
 observation:[['事件或问题','围绕同一个核心主题交代背景与待回答的问题。'],['事实与证据','整理该主题的事实、原始来源与不同观点，区分事实和评论。'],['分析与影响','分析同一主题的影响与边界，不另起一个事件。']],
 opensource:[['资源资料','核对同一个资源的身份、版本、作者或维护方及正式入口。'],['用途与价值','说明该资源的实际用途与适用范围，区分资料描述和已完成实测。'],['来源与使用条件','核对授权、获取条件、引用要求和局限；只有代码项目才要求代码仓库。']],
 calendar:[['事项信息','围绕同一事项交代对象、组织方和活动内容。'],['日期与参与条件','区分公告日期、活动区间和申请窗口，缺失日期保留待填。'],['官方来源与入口','核对同一事项的官方公告、参与入口及适用条件。']],
 history:[['史实与时间','围绕同一历史事件核对事实与实际发生日期，缺少精度时保留待填。'],['意义与影响','根据史料分析该事件的影响，区分事实、后世评价和作者解释。'],['史料与分歧','列明同一事件的史料出处、版本和来源分歧。']],
};

export const notebookTemplateModes=TEMPLATE_MODES as TemplateMode[];
export const templateSetting=(mode:TemplateMode)=>TEMPLATE_SETTING+(mode==='xiwen'?'':'.'+mode);
export function starterTemplate(mode:TemplateMode):TopicTemplate{
 const domain=domainType(mode),sections=defaultTemplates(mode).filter(t=>t.kind==='section');
 const materials=SINGLE_DIRECTIONS[mode]?.map(([name,prompt])=>({name,prompt:[domain?.subject,prompt].filter(Boolean).join('\n')}))||sections.flatMap(s=>(s.materials||[]).map(m=>({...m,name:sections.length>1?s.name+' · '+m.name:m.name})));
 return {id:'notebook-start-'+mode,kind:'article',mode,name:WRITING_SKILLS[mode].name,prompt:domain?.subject||WRITING_SKILLS[mode].hint,materials:materials.length?materials:[{name:WRITING_SKILLS[mode].name,prompt:WRITING_SKILLS[mode].hint}],...(domain?.cardDays?{days:domain.cardDays}:{})};
}
export function isStarter(t:{id:string;kind?:string}){return t.kind==='article'||/^(?:guoxue-v1-[\w]+-)?builtin-(essay|documentation|design|encyclopedia)-outline$/.test(t.id);}
// Keep the existing per-space settings and their edited/deleted entries. Only
// the five previously separate start choices are added, once, as new entries.
export function readNotebookTemplateLibrary(raw:string|null,mode:TemplateMode){
 const result=readLibrary(raw,mode);
 if(result.library.notebookVersion!==1){
  if(['xiwen','observation','opensource','calendar','history'].includes(mode)){
   const starter=starterTemplate(mode);
   if(!result.library.templates.some(t=>t.id===starter.id))result.library.templates.unshift(starter);
  }
  result.library.notebookVersion=1;result.migrated=true;
 }
 return result;
}
export function templateForArticle(t:TopicTemplate,mode:TemplateMode):ContentTemplate{
 const materials=t.materials?.length?t.materials:[{name:t.name,prompt:t.prompt}];
 return {...t,mode,materials:materials.map((m,i)=>({...m,prompt:templatePrompt({...t,name:m.name,prompt:m.prompt,mode},i,materials.length,'article')}))};
}
export const activeTemplateSpace=()=>ACTIVE_SITE.spaceId;
