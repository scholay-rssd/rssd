// A template selection owns only the presets inserted by this application.
// Old mounts and authored content are never inferred to be disposable presets.
import {upgradeNotebook} from './notebook-model.mjs';
import {templateSection} from './notebook-authoring.mjs';
export const DEFAULT_TITLE_TEMPLATE={id:'title-summary',name:'概括全文',requirement:'完成正文后，用一个简洁、准确的标题概括文章核心内容，不夸大事实，不编造信息。'};

export const TEMPLATE_MODES=['essay','documentation','design','encyclopedia','xiwen','observation','opensource','calendar','history'];
export const templateKind=mode=>({opensource:'openSource',calendar:'year',history:'history'}[mode]||'article');
export const templateTaskMode=mode=>['xiwen','observation','opensource','calendar','history'].includes(mode)?mode:'observation';
export const templateKey=(spaceId,t)=>[spaceId,t.mode||'xiwen',t.id].join('/');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const content=b=>Object.fromEntries(Object.entries(b).filter(([k])=>!['createdAt','updatedAt','revision','updatedBy'].includes(k)));
export function validateTemplate(t){
 if(!t||typeof t.id!=='string'||!t.id||t.id.length>200||!TEMPLATE_MODES.includes(t.mode)||typeof t.name!=='string'||!t.name.trim()||t.name.length>120||typeof t.prompt!=='string'||t.prompt.length>4000||!['article','section','material',undefined].includes(t.kind))throw Error('内容模板格式无效');
 if(t.days!==undefined&&(!Number.isInteger(t.days)||t.days<1||t.days>365))throw Error('模板时间范围无效');
 if(t.materials!==undefined&&(!Array.isArray(t.materials)||!t.materials.length||t.materials.length>36||t.materials.some(m=>!m||typeof m.name!=='string'||!m.name.trim()||m.name.length>120||typeof m.prompt!=='string'||m.prompt.length>4000)))throw Error('模板内容方向无效');
 return structuredClone(t);
}
export function releaseTemplate(input){
 const n=upgradeNotebook(input),s=n.templateSelection;
 if(!s)return {note:n,removed:0,retained:0};
 const owned=new Map(s.baseline.blocks.map(b=>[b.id,b])),original=s.baseline.order;
 const currentOrder=n.blocks.map(b=>b.id),remainingOriginal=original.filter(id=>currentOrder.includes(id));
 const survivingOrder=currentOrder.filter(id=>original.includes(id));
 const kept=new Set();
 for(const b of n.blocks){
  const base=owned.get(b.id);if(!base)continue;
  // Revision also protects edits which were later reverted to their old text.
  if(!equal(content(b),content(base))||(b.revision||0)>(base.revision||0)||remainingOriginal.indexOf(b.id)!==survivingOrder.indexOf(b.id)||b.groupId&&!equal(n.groups?.find(g=>g.id===b.groupId),s.baseline.groups.find(g=>g.id===b.groupId)))kept.add(b.id);
 }
 // Retain the headings around real content and referenced image/annotation targets.
 for(const b of n.blocks){
  if(!owned.has(b.id)||kept.has(b.id)){
   if(b.targetId)kept.add(b.targetId);
   if(b.groupId)for(const h of n.blocks.filter(h=>h.groupId===b.groupId&&h.type==='heading'))kept.add(h.id);
  }
 }
 if(kept.size)for(const id of s.structuralIds||[])kept.add(id);
 const remove=new Set([...owned.keys()].filter(id=>!kept.has(id)));
 n.blocks=n.blocks.filter(b=>!remove.has(b.id));
 const usedGroups=new Set(n.blocks.map(b=>b.groupId));
 n.groups=(n.groups||[]).filter(g=>!s.baseline.groups.some(x=>x.id===g.id)||usedGroups.has(g.id));
 n.mounts.templates=n.mounts.templates.filter(t=>t.instanceId!==s.instanceId);
 n.kind=s.before.kind;
 // Do not erase older compound writing types or independent skill mounts.
 n.skills=n.skills.filter(id=>!s.addedSkills.includes(id));
 for(const id of s.before.skills)if(!n.skills.includes(id))n.skills.push(id);
 for(const [key,v] of Object.entries(s.fields||{}))if(equal(n.fields[key],v.applied)){if(v.before===undefined)delete n.fields[key];else n.fields[key]=v.before;}
 if(s.titlePreset&&!n.title.trim()&&equal(n.titleTemplate,s.titlePreset))delete n.titleTemplate;
 delete n.templateSelection;
 return {note:n,removed:input.blocks.length-n.blocks.length,retained:n.blocks.filter(b=>owned.has(b.id)).length};
}
export function selectTemplate(input,template,{spaceId,makeId,headings=[]}={}){
 const released=releaseTemplate(input),n=released.note;
 if(!template)return released;
 const t=validateTemplate(template),before={kind:n.kind,skills:[...n.skills]},kind=templateKind(t.mode),instanceId=makeId();
 n.kind=kind;
 const addedSkills=n.skills.includes(t.mode)?[]:[t.mode];n.skills=[...n.skills,...addedSkills];
 const materials=t.materials?.length?t.materials:[{name:t.name,prompt:t.prompt}];
 const sections=materials.map(m=>templateSection(m,makeId)),blocks=sections.flatMap(s=>s.blocks),groups=sections.map(s=>s.group);
 // Structured records retain the existing server contract. Detailed directions
 // live below its second section, and never replace an author's existing prose.
 const structural=[];
 if(kind!=='article'){
  for(const b of blocks)if(b.type==='heading')b.level=3;
  for(const [i,label] of headings.entries())if(!n.blocks.some(b=>b.type==='heading'&&b.level===2&&b.text===label)){
   structural.push({id:makeId(),type:'heading',level:2,text:label,state:'ready',locked:true,sourceIds:[]});
   if(i===0)structural.push({id:makeId(),type:'paragraph',text:'',state:'placeholder',sourceIds:[],requirement:'根据已核实资料概括'+t.name+'，缺失事实保留待补。'});
  }
 }
 // Only replace the initial, completely untouched empty editor row.
 if(n.blocks.length===1){const b=n.blocks[0];if(b.type==='paragraph'&&b.state==='placeholder'&&!b.text&&!b.requirement&&!b.locked&&!b.groupId&&!b.sourceIds.length)n.blocks=[];}
 n.blocks=[...structural,...n.blocks,...blocks];n.groups=[...(n.groups||[]),...groups];
 n.mounts=n.mounts||{templates:[],brands:[]};
 n.mounts.templates=[...n.mounts.templates,{id:t.id,name:t.name,version:JSON.stringify(t),instanceId,blockIds:[...structural,...blocks].map(b=>b.id)}];
 n.templateSelection={key:templateKey(spaceId,t),spaceId,instanceId,template:t,before,addedSkills,fields:{},structuralIds:structural.filter(b=>b.type==='heading').map(b=>b.id),baseline:{blocks:structuredClone([...structural,...blocks]),groups:structuredClone(groups),order:n.blocks.map(b=>b.id)}};
 if(!n.title.trim()&&!n.titleTemplate){n.titleTemplate=structuredClone(DEFAULT_TITLE_TEMPLATE);n.templateSelection.titlePreset=structuredClone(n.titleTemplate);}
 return {...released,note:n};
}
// Capture server revisions after stamping so later edits can be distinguished
// from the original insert, even after an edit returns to the same characters.
export function stampTemplateBaseline(n){
 const s=n.templateSelection;if(s)s.baseline.blocks=s.baseline.blocks.map(b=>structuredClone(n.blocks.find(x=>x.id===b.id)||b));
 return n;
}
