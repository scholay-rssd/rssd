import {taskType,type EngineModeId} from '../../scripts/agent/task-types.mjs';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import {WRITING_SKILLS} from '../../scripts/agent/notebook.mjs';
import {ACADEMIC,domainType,type DomainType} from '../../scripts/agent/domain-pack.mjs';
import {isGuoxueSite,GUOXUE_SKILL_MATERIALS,GUOXUE_ANGLES} from '../../scripts/agent/guoxue-domain.mjs';
/** Topic templates are kept per engine mode. */
export type TemplateMode=EngineModeId|'documentation'|'design'|'essay'|'encyclopedia';
/** Only mounted skills can select a notebook template library; execution mode is unrelated. */
export function mountedTemplateModes(skills:string[]):TemplateMode[]{return [...new Set(skills)].filter(id=>Object.hasOwn(WRITING_SKILLS,id)) as TemplateMode[];}
export function selectedTemplateMode(skills:string[],selected?:TemplateMode):TemplateMode|undefined{const modes=mountedTemplateModes(skills);return selected&&modes.includes(selected)?selected:modes[0];}
const SKILL_MATERIALS:Partial<Record<TemplateMode,[string,string][]>>={
 documentation:[['适用场景与前提','依据原始文档说明版本、平台、适用范围和必要前提。'],['操作步骤与示例','核对可复现步骤、配置或代码示例，区分原文说明与尚未实测的内容。'],['验证与排错','整理预期结果、已知限制、兼容性及排错入口，不把建议写成已完成验证。']],
 design:[['背景与设计目标','核对作品、设计者、时间、委托背景和设计目标。'],['视觉方案与过程','从原始材料分析版式、字体、色彩和设计过程，区分观察与作者陈述。'],['成果与归属','记录作品成果、出处、图片授权和可确认的影响，不编造商业成效。']],
 essay:[['主题与素材','整理作者的主题、已有记录和引用资料，缺少亲历内容时保留待补。'],['叙述与观点','围绕作者观点组织段落，引用材料明确归属，不编造个人经历。'],['补充与核验','补齐背景、链接和事实依据，保留作者表达与有依据的边界。']],
 encyclopedia:[['定义与识别','核对名称、基本特征、适用对象及可靠原始出处。'],['习性与照护','依据专业机构资料整理习性、环境和日常照护，区分物种差异与个体差异。'],['常见问题与边界','整理常见误区、来源分歧和求助条件；不把一般知识冒充个体诊断。']],
};
const GENERIC_ENCYCLOPEDIA_MATERIALS:[string,string][]=[['定义与出处','核对概念、对象、分类与原始出处。'],['特征与机制','说明核心特征、工作机制或应用条件，保留领域差异。'],['边界与辨析','辨析相近概念、适用边界与来源分歧，不把一般描述写成确定结论。']];
export type SectionMaterial={name:string;prompt:string};
/** A column template (kind 'section') is a title plus its own materials; `prompt` is only a short summary of them. */
export type TopicTemplate={id:string;name:string;prompt:string;kind?:'material'|'section'|'article';days?:number;count?:number;mode?:TemplateMode;enrichRecordId?:string;materials?:SectionMaterial[]};
export type TopicLibrary={version:2;templates:TopicTemplate[];notebookVersion?:1};
export const DEFAULT_TEMPLATE_DAYS=7;
export const ANGLE_NAMES=['重点事件','方法与细节','补充视角','风险与争议','可操作信息'];
/** Materials for a column made from a single prompt: the same direction seen from a different angle per card. */
export function angleMaterials(name:string,prompt:string,count=3):SectionMaterial[]{
 const {names,prompts}=isGuoxueSite(ACTIVE_SITE)?GUOXUE_ANGLES:{names:ANGLE_NAMES,prompts:SLOT_ANGLES};
 return Array.from({length:Math.min(5,Math.max(1,count))},(_,i)=>{const angle=prompts[i]||'';return {name:`${name} · ${names[i]||i+1}`.slice(0,80),prompt:angle&&prompt.length+angle.length+1<=1000?prompt+'\n'+angle:prompt};});
}
export const bundleSummary=(materials:SectionMaterial[])=>materials.map(m=>m.name).join('、').slice(0,1000)||'分栏';
/** The built-in templates of a mode, taken from the domain pack: each card as a single-material template, plus column
 *  templates — the pack's ready-made columns when it defines them, otherwise one column per card seen from several angles. */
export function defaultTemplates(mode:TemplateMode='xiwen'):TopicTemplate[]{
 const scoped=(templates:TopicTemplate[])=>isGuoxueSite(ACTIVE_SITE)?templates.map(t=>({...t,id:`guoxue-v1-${mode}-${t.id}`})):templates;
 const skillMaterials=isGuoxueSite(ACTIVE_SITE)?GUOXUE_SKILL_MATERIALS[mode]:mode==='encyclopedia'&&ACTIVE_SITE.spaceId!=='pets'?GENERIC_ENCYCLOPEDIA_MATERIALS:SKILL_MATERIALS[mode];
 if(skillMaterials){const materials=skillMaterials.map(([name,prompt])=>({name,prompt:`${ACTIVE_SITE.domain}：${prompt}`}));return scoped([...materials.map((m,i)=>({id:`builtin-${mode}-${i}`,kind:'material' as const,...m,mode})),{id:`builtin-${mode}-outline`,kind:'section' as const,name:WRITING_SKILLS[mode].name+'提纲',prompt:bundleSummary(materials),materials,mode}]);}
 return scoped(domainTemplates(mode,domainType(mode),angleMaterials));
}
function domainTemplates(mode:TemplateMode,domain:DomainType|null,angles:typeof angleMaterials):TopicTemplate[]{
 if(!domain)return [];
 const list=domain.cards,base={...(mode!=='xiwen'?{mode}:{}),...(domain.cardDays?{days:domain.cardDays}:{})};
 const materials=list.map(([name,,prompt],i)=>({id:'builtin-material-'+i,kind:'material' as const,name,prompt,...base}));
 const columns=(domain.columns?domain.columns.map(([name,idx])=>[name,idx.map(i=>({name:list[i][0],prompt:list[i][2]}))] as [string,SectionMaterial[]]):list.map(([name,section,prompt])=>[section,angles(name,prompt)] as [string,SectionMaterial[]]))
  .map(([name,items],k)=>({id:'builtin-section-'+k,kind:'section' as const,name,prompt:bundleSummary(items),materials:items,...base}));
 return [...materials,...columns];
}
// Only exact shipped defaults are replaceable. Edits, deletions, custom entries
// and templates already frozen into a notebook are never rewritten.
function refreshGuoxueDefaults(library:TopicLibrary,mode:TemplateMode){
 if(!isGuoxueSite(ACTIVE_SITE))return false;
 const oldAngles=(name:string,prompt:string)=>Array.from({length:3},(_,i)=>({name:`${name} · ${ANGLE_NAMES[i]}`.slice(0,80),prompt:prompt+'\n'+SLOT_ANGLES[i]}));
 const skill=SKILL_MATERIALS[mode];let old:TopicTemplate[]=[];
 if(skill){
  const materials=skill.map(([name,prompt])=>({name,prompt:`${ACTIVE_SITE.domain}：${prompt}`}));
  const names:Partial<Record<TemplateMode,string>>={documentation:'技术文档',design:'设计案例',essay:'个人写作',encyclopedia:'百科条目'};
  old=[...materials.map((m,i)=>({id:`builtin-${mode}-${i}`,kind:'material' as const,...m,mode})),{id:`builtin-${mode}-outline`,kind:'section',name:names[mode]+'提纲',prompt:bundleSummary(materials),materials,mode}];
  if(mode==='encyclopedia'){
   const general=GENERIC_ENCYCLOPEDIA_MATERIALS.map(([name,prompt])=>({name,prompt:`${ACTIVE_SITE.domain}：${prompt}`}));
   old.push(...general.map((m,i)=>({id:`builtin-${mode}-${i}`,kind:'material' as const,...m,mode})),{id:`builtin-${mode}-outline`,kind:'section',name:names[mode]+'提纲',prompt:bundleSummary(general),materials:general,mode});
  }
 }else{
  const academic=domainType(mode,ACADEMIC);
  old=domainTemplates(mode,academic,oldAngles);
  if(academic){
   const generic:DomainType={...academic,columns:undefined,cards:mode==='rss'?[['来源发现',ACTIVE_SITE.domain,'核验订阅地址、来源身份与真实条目，不将普通网页当作 RSS。']]:[[ACTIVE_SITE.domain,ACTIVE_SITE.columns[['xiwen','observation','opensource','calendar','history'].indexOf(mode)],'查找与'+ACTIVE_SITE.domain+'有关的原始来源。核实事实、事件日期与出处，不编造信息；历史事件不限近期发布。']]};
   old.push(...domainTemplates(mode,generic,oldAngles));
  }
 }
 const stable=(value:unknown)=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
 const defaults=new Set(old.map(stable)),unchanged=library.templates.filter(t=>defaults.has(stable(t)));
 if(!unchanged.length)return false;
 const replaced=new Set(unchanged.map(t=>t.id)),kept=library.templates.filter(t=>!replaced.has(t.id));
 library.templates=[...kept,...defaultTemplates(mode).filter(t=>!kept.some(existing=>existing.id===t.id))];
 return true;
}
export function readLibrary(raw:string|null,mode:TemplateMode='xiwen'):{library:TopicLibrary;migrated:boolean;bundled:boolean;domainUpdated:boolean}{
 const value=raw===null?null:JSON.parse(raw);const migrated=value===null||Array.isArray(value);
 const stored=migrated?{version:2,templates:[...(value||[]),...defaultTemplates(mode)]}:value;
 if(!stored||stored.version!==2||!Array.isArray(stored.templates))throw Error('模板格式异常，请重试读取');
 // Column templates saved before bundles (a title plus one prompt) become a bundle of the same direction seen from three angles, so nothing changes in practice.
 let bundled=false;
 const templates=stored.templates.map((t:TopicTemplate)=>{
  if(!t||t.kind!=='section'||Array.isArray(t.materials)||typeof t.name!=='string'||typeof t.prompt!=='string'||!t.prompt.trim())return t;
  bundled=true;const {count,...rest}=t,materials=angleMaterials(t.name,t.prompt.trim(),typeof count==='number'&&count>1?count:3);
  return {...rest,materials,prompt:bundleSummary(materials)};
 });
 // Retain the exact saved template list; obsolete preference fields are ignored.
 const library:TopicLibrary={version:2,templates,...(stored.notebookVersion===1?{notebookVersion:1}:{})};
 const ids=new Set();
 for(const t of library.templates){if(!t||typeof t.id!=='string'||!t.id||ids.has(t.id)||typeof t.name!=='string'||!t.name.trim()||typeof t.prompt!=='string'||!t.prompt.trim()||t.prompt.length>1000||t.kind!==undefined&&!['material','section','article'].includes(t.kind)||t.days!==undefined&&(!Number.isInteger(t.days)||t.days<1||t.days>365)||t.count!==undefined&&(!Number.isInteger(t.count)||t.count<1||t.count>5)||t.enrichRecordId!==undefined&&(typeof t.enrichRecordId!=='string'||!t.enrichRecordId||t.enrichRecordId.length>200)||(t.kind==='section'||t.kind==='article')&&(!Array.isArray(t.materials)||t.materials.length<1||t.materials.length>(t.kind==='article'?36:5)||t.materials.some(m=>!m||typeof m.name!=='string'||!m.name.trim()||m.name.length>80||typeof m.prompt!=='string'||!m.prompt.trim()||m.prompt.length>1000)))throw Error('模板数据格式异常，请重试读取');ids.add(t.id);}
 const domainUpdated=refreshGuoxueDefaults(library,mode);
 return {library,migrated:migrated||bundled||domainUpdated,bundled,domainUpdated};
}
export function templatePrompt(t:TopicTemplate,index=0,count=1,scope:'board'|'article'='board'){
 if(isGuoxueSite(ACTIVE_SITE)){
  const range=t.mode==='rss'?'核验国学订阅源当前可用性。':t.mode==='calendar'?'核对公告、活动与报名日期；明确历法与地域。':'按国学主题核对原典、篇章、版本与注疏，不限制资料的近期发布日期，不编造精确历史日期。';
  const text=[range,t.prompt,'优先经典原文、历代注疏、可靠整理本及馆藏资料；区分经文、注释和作者解读，保留分歧与出处，无可靠资料时保留缺口。',count>1?`本分栏第 ${index+1}/${count} 个素材槽位，从不同篇章、注疏或问题补充材料，避免重复；同一经典可用于不同角度的有据解读。`:''].filter(Boolean).join('\n');
  if(text.length>(scope==='article'?4000:1000))throw Error('模板检索要求合计过长，请缩短检索方向后再放入');return text;
 }
 const rule=taskType(t.mode)?.dateRule,range=t.mode&&SKILL_MATERIALS[t.mode]?'核对资料版本、适用范围和原始出处，不限定为最近七天的新闻。':rule==='event'?'按历史事件日期核对原始史料，不限制史料的近期发布日期。':rule==='none'?'核验订阅源当前可用性，不以近期网页发布日期限制订阅入口。':t.days===undefined&&t.kind===undefined?'':`检索时间：最近 ${t.days??DEFAULT_TEMPLATE_DAYS} 天，按执行当天向前计算；核对原始发布日期，不以抓取或转载日期冒充。`;
 const prose=scope==='article'&&t.mode!=='xiwen';
 const text=[range,t.prompt,prose?'优先当前文章已选资料，缺口补充可核对的原始来源；无可靠材料时保留缺口，不编造。':'优先本地 RSS，缺口联网补机构原文；同一事件去重，无可靠材料时保留缺口，不编造。',count>1?(prose?`本篇第 ${index+1}/${count} 个内容方向，围绕同一个主题补充材料，避免重复。`:`本分栏第 ${index+1}/${count} 个素材槽位，寻找与其他槽位及已有素材不同的事件。`):''].filter(Boolean).join('\n');
 if(text.length>(scope==='article'?4000:1000))throw Error('模板检索要求合计过长，请缩短检索方向后再放入');return text;
}

// Each slot in a column looks from a different angle, so nine empty cards do not all chase the same story.
export const SLOT_ANGLES=['本槽位侧重：近期最具影响力或最受关注的一项。','本槽位侧重：方法、工具或制度细节层面的新进展。','本槽位侧重：不同领域、地区或机构的补充视角，避开前两槽已用的角度。','本槽位侧重：争议、风险或需谨慎看待的一面，区分事实与评论。','本槽位侧重：可操作信息，如申请入口、截止时间或使用方法。'];
/** The cards a column template creates: one AI slot per material, each with its own direction. */
export function bundleSlots(t:TopicTemplate):{templateName:string;prompt:string}[]{
 const materials=t.materials?.length?t.materials:angleMaterials(t.name,t.prompt,t.count&&t.count>1?t.count:3);
 return materials.map((m,i)=>({templateName:m.name,prompt:templatePrompt({...t,kind:'section',name:m.name,prompt:m.prompt},i,materials.length)}));
}
/** The board a new topic task opens with. A matrix type gets three columns, each a column template's own materials as AI
 *  slots. A single-material type gets one column holding one empty card, ready for the one material the post is about. */
export function defaultTopicBoard(mode:TemplateMode):{titles:string[];sections:{id:string;title:string;slots:{id:string;mode?:'smart';templateName?:string;prompt?:string}[];items:never[];slotCount:number}[];targetSections:number;targetPerSection:number}|null{
 const type=taskType(mode);
 if(type?.topic==='single')return {titles:[],sections:[{id:crypto.randomUUID(),title:type.name,slots:[{id:crypto.randomUUID()}],items:[] as never[],slotCount:1}],targetSections:1,targetPerSection:1};
 const picks=defaultTemplates(mode).filter(t=>t.kind==='section').slice(0,3);
 if(!picks.length)return null;
 const sections=picks.map(t=>{const slots=bundleSlots(t).map(x=>({id:crypto.randomUUID(),mode:'smart' as const,...x}));return {id:crypto.randomUUID(),title:t.name,slots,items:[] as never[],slotCount:slots.length};});
 return {titles:[],sections,targetSections:sections.length,targetPerSection:1};
}
