import {internalNoteErrors,blockNoteErrors} from '../../../contracts/article-internal-notes.mjs';
import {completionTargets,notebookPreparation} from './notebook-completion.mjs';
// Editing identity is independent of Markdown and of a site's component fields.
// A flat ordered leaf list with contiguous groups is sufficient for this editor;
// group membership never creates a second copy of the text or its order.
export const NOTEBOOK_VERSION=2;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const isRecord=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
export const publicUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
export function upgradeNotebook(input){
 if(!input)return input;
 if(input.version!==1)return structuredClone(input);
 const n=structuredClone(input),used=new Set(n.blocks.map(b=>b.id));
 const suffix=(id,label)=>{let key=id+':'+label;while(used.has(key))key+='-';used.add(key);return key;};
 n.version=NOTEBOOK_VERSION;n.groups=n.groups||[];n.mounts=n.mounts||{templates:[],brands:[]};n.assets=n.assets||{};
 n.blocks=n.blocks.flatMap(b=>{
  const next={...b,requirement:b.requirement||(b.state==='placeholder'?(b.type==='image'?b.caption||'':b.text):'')};
  if(b.state==='placeholder'&&b.type!=='image')next.text='';
  delete next.caption;
  if(b.type!=='image'||!b.caption||b.state==='placeholder')return [next];
  const groupId=suffix(b.id,'figure');n.groups.push({id:groupId,kind:'figure'});
  return [{...next,groupId},{id:suffix(b.id,'caption'),type:'annotation',role:'caption',targetId:b.id,groupId,text:b.caption,requirement:'',state:'ready',locked:b.locked,sourceIds:[...b.sourceIds]}];
 });
 return n;
}
export function stampNotebook(input,previous,{documentId,at=new Date().toISOString(),actor='author',imported=false}={}){
 const n=upgradeNotebook(input),old=upgradeNotebook(previous),meta=old?.meta;
 const clean=b=>Object.fromEntries(Object.entries(b).filter(([k])=>!['createdAt','updatedAt','revision','updatedBy'].includes(k)));
 n.meta={documentId:meta?.documentId||documentId,createdAt:meta?meta.createdAt:imported?undefined:at,...(meta?.importedAt||imported?{importedAt:meta?.importedAt||at}:{}),updatedAt:at,revision:(meta?.revision||0)+1};
 n.blocks=n.blocks.map(b=>{const prior=old?.blocks.find(x=>x.id===b.id),changed=!prior||!equal(clean(b),clean(prior));return {...b,createdAt:prior?prior.createdAt:imported?undefined:at,updatedAt:changed?at:prior.updatedAt||at,revision:(prior?.revision||0)+(changed?1:0),updatedBy:changed?actor:prior.updatedBy||actor};});
 return n;
}
export function notebookGroups(n){
 const result=[];
 for(const b of n.blocks){const last=result.at(-1);if(b.groupId&&last?.id===b.groupId)last.blocks.push(b);else result.push({id:b.groupId||b.id,group:n.groups?.find(g=>g.id===b.groupId),blocks:[b]});}
 return result;
}
export function formatErrors(n,{imageReference=value=>/^assets\/notebook\/[a-f0-9]{64}\.webp$/.test(value)}={}){
 const errors=[],add=(path,message)=>errors.push({path,message});
 if(!n||![1,2].includes(n.version)){add('version','不支持的文章板格式版本');return errors;}
 if(typeof n.title!=='string'||n.title.length>120)add('title','标题字段须为不超过 120 字的文字');
 if(n.titleTemplate!==undefined&&(!isRecord(n.titleTemplate)||typeof n.titleTemplate.id!=='string'||!n.titleTemplate.id||n.titleTemplate.id.length>200||typeof n.titleTemplate.name!=='string'||!n.titleTemplate.name.trim()||n.titleTemplate.name.length>120||typeof n.titleTemplate.requirement!=='string'||!n.titleTemplate.requirement.trim()||n.titleTemplate.requirement.length>4000))add('titleTemplate','标题模板格式无效');
 if(!['article','year','history','openSource'].includes(n.kind))add('kind','记录类型无效');
 if(!Array.isArray(n.blocks)||n.blocks.length>500){add('blocks','内容行须为数组，最多 500 行');return errors;}
 if(!Array.isArray(n.sources)||n.sources.length>200){add('sources','素材须为数组，最多 200 条');return errors;}
 if(n.groups!==undefined&&!Array.isArray(n.groups)){add('groups','分组须为数组');return errors;}
 if(!Array.isArray(n.skills)||n.skills.some(x=>typeof x!=='string'))add('skills','写作技能须为标识数组');
 if(n.assets!==undefined&&!isRecord(n.assets))add('assets','图片资源须为对象');
 if(n.sectionId!==undefined&&(typeof n.sectionId!=='string'||!/^([a-z][a-z0-9-]{0,79})?$/.test(n.sectionId)))add('sectionId','栏目标识格式无效');
 if(n.context!==undefined&&(!isRecord(n.context)||typeof n.context.webEnabled!=='boolean'||!Array.isArray(n.context.excludedSourceIds)||n.context.excludedSourceIds.some(id=>typeof id!=='string')||n.context.excludedSourceIds.length>200))add('context','写作上下文格式无效');
 for(const message of internalNoteErrors(n.internalNotes))add('internalNotes',message);
 for(const message of blockNoteErrors(n.blockNotes))add('blockNotes',message);
 if(!isRecord(n.fields))add('fields','发布字段须为对象');
 if(JSON.stringify(n).length>1000000)add('document','文章板超过 1 MB');
 const ids=new Set(),sources=new Set(),groups=new Set();
 for(const [i,g] of (n.groups||[]).entries()){if(!g||typeof g.id!=='string'||!g.id||groups.has(g.id)||!['section','figure'].includes(g.kind))add(`groups.${i}`,'分组 ID 或类型无效');groups.add(g?.id);}
 const closedGroups=new Set();let activeGroup;
 for(const [i,b] of n.blocks.entries()){
  const path=`blocks.${i}`;
  if(!b||typeof b.id!=='string'||!b.id||ids.has(b.id)){add(path,'内容行 ID 缺失或重复');continue;}ids.add(b.id);
  if(!['heading','paragraph','image','markdown','annotation'].includes(b.type)||!['placeholder','ready'].includes(b.state)||typeof b.text!=='string'||!Array.isArray(b.sourceIds)||b.sourceIds.some(x=>typeof x!=='string'))add(path,'内容行类型、状态或字段格式无效');
  if(b.requirement!==undefined&&typeof b.requirement!=='string')add(path+'.requirement','占位要求须为文字');
  if(b.locked!==undefined&&typeof b.locked!=='boolean')add(path+'.locked','人工保护须为布尔值');
  if(b.type==='heading'&&(!Number.isInteger(b.level)||b.level<1||b.level>6))add(path+'.level','标题级数须为 1–6');
  if(b.type==='image'&&b.text&&!imageReference(b.text))add(path+'.text','请先导入图片，再使用登记的图片路径');
  if(b.type==='annotation'&&!['caption','endnote'].includes(b.role))add(path+'.role','注释用途须为图注或尾注');
  if(b.purpose!==undefined&&!['explanation','reference','marketing'].includes(b.purpose))add(path+'.purpose','尾注用途无效');
  if(b.groupId&&!groups.has(b.groupId))add(path+'.groupId','内容行引用了不存在的分组');
  if(activeGroup!==b.groupId){if(activeGroup)closedGroups.add(activeGroup);if(b.groupId&&closedGroups.has(b.groupId))add(path+'.groupId','同组内容必须连续排列');activeGroup=b.groupId;}
  if(b.presentation){const v=b.presentation;if(!isRecord(v)||Object.keys(v).some(k=>!['widthMode','fit','focalPoint'].includes(k))||(v.widthMode&&!['content','wide'].includes(v.widthMode))||(v.fit&&!['contain','cover'].includes(v.fit))||(v.focalPoint&&(!Array.isArray(v.focalPoint)||v.focalPoint.length!==2||v.focalPoint.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>1))))add(path+'.presentation','图片显示参数格式无效');}
 }
 for(const [i,s] of n.sources.entries()){
  const issues=[];
  if(!s||typeof s.id!=='string'||!s.id||sources.has(s.id))issues.push('id 须为非空且不重复的文字');
  if(typeof s?.title!=='string')issues.push('缺少文字字段 title');
  if(typeof s?.summary!=='string')issues.push('缺少文字字段 summary（不能用 note 代替）');
  if(typeof s?.reviewed!=='boolean')issues.push('reviewed 须为布尔值，AI 新增来源填 false');
  if(!['rss','web','record'].includes(s?.acquiredVia))issues.push('acquiredVia 只取 rss/web/record，网页来源填 web');
  if(!publicUrl(s?.url))issues.push('url 须为不含凭证的 HTTP(S) 原文链接');
  if(issues.length)add(`sources.${i}`,'素材格式或原文链接无效：'+issues.join('；'));
  sources.add(s?.id);
 }
 for(const [i,b] of n.blocks.entries()){
  if(!b)continue;
  if(Array.isArray(b.sourceIds)&&b.sourceIds.some(id=>!sources.has(id)))add(`blocks.${i}.sourceIds`,'内容行引用了不存在的素材');
  if(b.type==='annotation'&&b.role==='caption'&&!n.blocks.some(x=>x?.id===b.targetId&&x.type==='image'))add(`blocks.${i}.targetId`,'图注需要关联存在的图片');
  if(b.targetId&&!ids.has(b.targetId))add(`blocks.${i}.targetId`,'关联内容行不存在');
 }
 if(n.mounts&&(!isRecord(n.mounts)||!Array.isArray(n.mounts.templates)||!Array.isArray(n.mounts.brands)))add('mounts','挂载信息格式无效');
 if(n.mounts?.skills!==undefined){const skills=n.mounts.skills;if(!Array.isArray(skills)||skills.length>32||new Set(skills.map(s=>s?.id)).size!==skills.length||skills.some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string'||typeof s.version!=='string'||typeof s.description!=='string'||typeof s.content!=='string'||s.content.length>60000||!/^[a-f0-9]{64}$/.test(s.contentHash)))add('mounts.skills','技能快照格式无效');}
 return errors;
}
export function assertAgentScope(n,previous,scope){
 if(!scope)return; // Legacy callers retain their existing lock/version checks.
 const targets=new Set(scope.targetIds||[]),oldIds=new Set(previous.blocks.map(b=>b.id));
 for(const b of previous.blocks){if(!targets.has(b.id)&&!equal(n.blocks.find(x=>x.id===b.id),b))throw Error('只允许修改本次委派的内容行：'+b.id);}
 if(scope.action!=='organize'&&(n.blocks.some(b=>!oldIds.has(b.id))||!equal(n.blocks.map(b=>b.id),previous.blocks.map(b=>b.id))||!equal(n.groups,previous.groups)))throw Error('本次委派不允许新增或重排其他内容');
 if(scope.action==='research'&&(!equal(n.blocks,previous.blocks)||n.title!==previous.title||!equal(n.fields,previous.fields)))throw Error('检索只向素材区添加结果');
 if(scope.action==='research'&&previous.sources.some(s=>!equal(n.sources.find(x=>x.id===s.id),s)))throw Error('检索只能追加素材，不能改动已经选入的素材');
 if(!equal(n.titleTemplate,previous.titleTemplate))throw Error('标题模板由作者选择');
 if(scope.action==='title'&&!equal(n.sources,previous.sources))throw Error('标题生成不修改素材');
 if(!scope.allowTitle&&n.title!==previous.title)throw Error('文章标题不在本次委派范围');
 if(!scope.allowFields&&!equal(n.fields,previous.fields))throw Error('发布字段不在本次委派范围');
 if(!equal(n.mounts,previous.mounts))throw Error('模板和品牌由作者挂载');
 if(!equal(n.assets,previous.assets))throw Error('图片信息由导入服务维护');
}
export function notebookPromptScope(n,{targetIds,action='fill',imageMethod}={}){
 n=upgradeNotebook(n);
 if(!['fill','revise','organize','research','image','complete','title'].includes(action))throw Error('写作操作无效');
 if(action==='complete'){const failed=notebookPreparation(n).filter(c=>!c.ok);if(failed.length)throw Error(failed.map(c=>c.label).join('；'));}
 if(action==='title'&&n.title.trim())throw Error('已有标题已保留；仅可补全空标题');
 const ids=action==='title'?[]:action==='complete'?completionTargets(n):targetIds||n.blocks.filter(b=>b.state==='placeholder'&&!b.locked).map(b=>b.id);
 if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!n.blocks.some(b=>b.id===id)))throw Error('委派内容行已变化，请重新选择');
 for(const b of n.blocks.filter(b=>ids.includes(b.id))){if(b.locked&&(!targetIds||!['fill','revise','image'].includes(action)))throw Error('请明确选择本次要修改的受保护内容');if(action==='fill'&&b.state!=='placeholder')throw Error('正式内容请使用“交给 AI 改写”');}
 if(action==='image'&&(ids.length!==1||!n.blocks.some(b=>b.id===ids[0]&&b.type==='image')||!['local','online','generate'].includes(imageMethod)))throw Error('请选择一个图片位置和补全方式');
 return {action,targetIds:action==='research'?[]:ids,authorizedLockedIds:targetIds&&['fill','revise','image'].includes(action)?n.blocks.filter(b=>b.locked&&ids.includes(b.id)).map(b=>b.id):[],imageMethod:action==='complete'?(imageMethod||'online'):imageMethod,allowTitle:['title','complete','organize'].includes(action)&&!n.title.trim(),allowFields:action==='organize'};
}
