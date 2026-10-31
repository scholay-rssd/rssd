import {INTERNAL_NOTE_FIELDS} from '../../../contracts/article-internal-notes.mjs';
// Interactive writing keeps AI work outside the author's document until accepted.
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {withFileLock} from '../../../scripts/editorial-lock.mjs';
import {recordHeadings} from '../../../scripts/editorial-record.mjs';
import {siteForWorkspace} from '../../../scripts/site-config.mjs';
import {upgradeNotebook,stampNotebook,validateNotebook} from './notebook.mjs';
import {templateTaskMode,templateKey,selectTemplate} from './notebook-templates.mjs';
import {resolveSkillMounts} from './writing-skill-catalog.mjs';
import {attachmentBlocks} from './session-state.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const body=b=>b&&Object.fromEntries(Object.entries(b).filter(([k])=>!['createdAt','updatedAt','revision','updatedBy'].includes(k)));
export const activeNotebookTurn=t=>(t.notebookTurns||[]).find(x=>x.id===t.runtime?.notebookAction?.turnId&&x.status==='running');
export function notebookAgentTask(t){const turn=activeNotebookTurn(t);return turn?{...t,notebook:turn.candidate,notebookTurns:undefined}:t;}
export function writeAgentNotebook(t,n){const turn=activeNotebookTurn(t);if(turn){turn.candidate=n;turn.generated=true;}else t.notebook=n;}
export async function prepareNotebookTurn(store,t,p){
 if(!p.turnContext||typeof p.turnContext!=='object'||JSON.stringify(p.turnContext).length>1000000)throw Error('本轮挂载格式无效');
 attachmentBlocks(p.attachments||[],{promptCapabilities:{image:true}});
 const context={...p.turnContext,files:(p.attachments||[]).map(({id,name,type,mimeType,size})=>({id,name,type,mimeType,size}))};
 if(['skills','brands','sources','endnotes'].some(k=>context[k]!==undefined&&!Array.isArray(context[k])))throw Error('本轮挂载须为列表');
 const base=upgradeNotebook(t.notebook),space=siteForWorkspace(store.root);
 let candidate=structuredClone(base);
 // Prior article provenance remains stored in base, but is not a new grant.
 candidate.mounts={templates:(base.mounts?.templates||[]).filter(m=>base.templateSelection&&m.instanceId===base.templateSelection.instanceId),brands:context.brands||[],skills:await resolveSkillMounts(store.root,context.skills||[],base.mounts?.skills||[])};
 candidate.titleTemplate=context.titleTemplate;
 candidate.context={webEnabled:context.webEnabled===true,excludedSourceIds:[]};
 if(context.template&&(!p.action||p.action==='organize')){
  const bound=!!base.baseSha||!!t.notebookExport||t.workIds.includes(t.articleId);
  const spaceId=space.spaceId||space.id;
  // Reusing an article's current template must preserve authored blocks and IDs.
  // A different template still needs the old selection to release untouched presets.
  if(base.templateSelection?.key!==templateKey(spaceId,context.template)||!same(base.templateSelection.template,context.template))candidate=selectTemplate(candidate,context.template,{spaceId,makeId:randomUUID,headings:recordHeadings(({opensource:'openSource',calendar:'year',history:'history'})[context.template.mode]||'article')}).note;
  if(bound&&candidate.kind!==base.kind)throw Error('已有稿件不能更改内容类型，请选择同类型模板');
 }else {delete candidate.templateSelection;candidate.mounts.templates=[];}
 candidate.titleTemplate=context.titleTemplate;
 if(p.action!=='research')for(const b of context.endnotes||[])if(!candidate.blocks.some(x=>x.preset?.brandId===b.preset?.brandId&&x.preset?.id===b.preset?.id))candidate.blocks.push(b);
 for(const source of context.sources||[]){if(!candidate.sources.some(x=>x.id===source.id||(source.recordId?x.recordId===source.recordId:x.url===source.url)))candidate.sources.push({...source,reviewed:false});}
 candidate=validateNotebook(candidate,undefined,{agent:false});
 const turn={id:randomUUID(),createdAt:new Date().toISOString(),text:p.text,status:'running',context:structuredClone(context),base,candidate,items:[]};
 t.notebookTurns=[...(t.notebookTurns||[]),turn];
 return turn;
}
export function settleNotebookTurn(t,status){
 const turn=activeNotebookTurn(t);if(!turn)return;
 const {base,candidate:n}=turn,items=[];
 if(n.title.trim()&&n.title!==base.title)items.push({id:'title',kind:'title',label:n.title,before:base.title,after:n.title});
 for(const [key,label] of Object.entries(INTERNAL_NOTE_FIELDS))if((n.internalNotes?.[key]||'')!==(base.internalNotes?.[key]||''))items.push({id:'internal:'+key,kind:'internal',label,field:key,before:base.internalNotes?.[key]||'',after:n.internalNotes?.[key]||'',noteText:n.internalNotes?.[key]||''});
 for(const [blockId,entry] of Object.entries(n.blockNotes||{}))for(const [key,label] of Object.entries(INTERNAL_NOTE_FIELDS))if((entry.notes[key]||'')!==(base.blockNotes?.[blockId]?.notes[key]||'')){
  const block=n.blocks.find(b=>b.id===blockId);
  items.push({id:'internal:'+blockId+':'+key,kind:'internal',blockId,label,field:key,before:base.blockNotes?.[blockId]?.notes[key]||'',after:entry.notes[key]||'',noteText:entry.notes[key]||'',anchor:block?{type:block.type,text:block.text}:entry.anchor});
 }
 const changed=n.blocks.filter(b=>b.state==='ready'&&b.text.trim()&&!same(body(b),body(base.blocks.find(x=>x.id===b.id))));
 const grouped=new Set();
 for(const block of changed){const key=block.groupId||block.id;if(grouped.has(key))continue;grouped.add(key);const blocks=changed.filter(b=>(b.groupId||b.id)===key);items.push({id:'block:'+key,kind:'blocks',label:n.groups?.find(g=>g.id===block.groupId)?.label||blocks.find(b=>b.type==='heading')?.text||'正文',blocks,before:blocks.map(b=>base.blocks.find(x=>x.id===b.id)||null),group:n.groups?.find(g=>g.id===block.groupId),order:n.blocks.map(b=>b.id)});}
 if(n.kind!==base.kind||!same(n.fields,base.fields)||!same(n.skills,base.skills))items.push({id:'fields',kind:'fields',label:'内容设置',before:{kind:base.kind,fields:base.fields,skills:base.skills},after:{kind:n.kind,fields:n.fields,skills:n.skills}});
 if(t.runtime.notebookAction.action==='research')for(const source of n.sources.filter(s=>!base.sources.some(x=>x.id===s.id)&&!(turn.context.sources||[]).some(x=>x.id===s.id)))items.push({id:'source:'+source.id,kind:'source',label:source.title,source});
 turn.items=turn.generated?items:[];turn.sources=n.sources;turn.assets=n.assets;turn.status=status==='已完成'?'ready':'interrupted';turn.finishedAt=new Date().toISOString();
 // Finished history stores a change set, not repeated full manuscript copies.
 delete turn.base;delete turn.candidate;delete turn.generated;
}
export async function acceptNotebookTurn(store,id,p){return withFileLock(join(store.dir(id),'task.lock'),async()=>{
 const t=await store.get(id),turn=t.notebookTurns?.find(x=>x.id===p.turnId);
 if(!turn||turn.status==='running'||t.completedAt||t.runtime?.busy||t.runtime?.queued)throw Error('请等待本轮结束后接受结果');
 const chosen=turn.items.filter(x=>(!p.itemIds||p.itemIds.includes(x.id))&&!x.accepted);
 if(!chosen.length)return t; // Safe to retry after an uncertain response.
 if(t.revision!==p.expectedRevision)throw Error('CONFLICT: 文章已有新版，请刷新后接受');
 let n=upgradeNotebook(t.notebook);
 for(const item of chosen){
  if(item.kind==='internal'){
   const current=item.blockId?n.blockNotes?.[item.blockId]?.notes:n.internalNotes;
   if((current?.[item.field]||'')!==item.before)throw Error('CONFLICT: 内部备注已修改，未覆盖');
   if(item.blockId){
    if(!n.blocks.some(b=>b.id===item.blockId)&&!chosen.some(i=>i.kind==='blocks'&&i.blocks.some(b=>b.id===item.blockId)))throw Error('请先接受对应的正文，再接受行间备注');
    n.blockNotes={...n.blockNotes,[item.blockId]:{...n.blockNotes?.[item.blockId],anchor:item.anchor,notes:{...current,[item.field]:item.after}}};
   }else n.internalNotes={...current,[item.field]:item.after};
  }
  if(item.kind==='title'){if(n.title!==item.before)throw Error('CONFLICT: 标题已修改，未覆盖');n.title=item.after;}
  if(item.kind==='fields'){if(!same({kind:n.kind,fields:n.fields,skills:n.skills},item.before))throw Error('CONFLICT: 内容设置已修改，未覆盖');n={...n,...item.after};}
  if(item.kind==='source'){const source=item.source;n.blocks.push({id:randomUUID(),type:'paragraph',state:'ready',locked:true,text:source.summary||source.title,sourceIds:[source.id]});}
  if(item.kind==='blocks'){
   for(const [index,b] of item.blocks.entries()){
    const existing=n.blocks.find(x=>x.id===b.id),before=item.before[index];
    if(!same(body(existing)||null,body(before)||null)||(existing?.revision||0)!==(before?.revision||0))throw Error('CONFLICT: 候选对应的正文已修改，未覆盖');
    const accepted={...b,locked:true};
    if(existing)n.blocks=n.blocks.map(x=>x.id===b.id?accepted:x);
    else {const following=item.order.slice(item.order.indexOf(b.id)+1).find(id=>n.blocks.some(x=>x.id===id));const at=following?n.blocks.findIndex(x=>x.id===following):n.blocks.length;n.blocks.splice(at,0,accepted);}
   }
   if(item.group&&!n.groups.some(g=>g.id===item.group.id))n.groups.push(item.group);
  }
 }
 const referenced=new Set(n.blocks.flatMap(b=>b.sourceIds||[]));
 n.sources=[...n.sources,...turn.sources.filter(s=>referenced.has(s.id)&&!n.sources.some(x=>x.id===s.id))];
 n.assets={...n.assets,...turn.assets};
 n=validateNotebook(n,undefined,{agent:false});
 if(n.kind!==t.notebook.kind){if(t.notebook.baseSha||t.notebookExport||t.workIds.includes(t.articleId))throw Error('已有稿件不能更改内容类型');t.articleId=(n.kind==='article'?'draft-':'record-')+t.articleId.replace(/^(draft-|record-)/,'');}
 if(chosen.some(i=>i.kind==='fields')&&turn.context.template){t.mode=templateTaskMode(turn.context.template.mode);t.writingSkill=turn.context.template.mode;}
 t.notebook=stampNotebook(n,t.notebook,{documentId:t.articleId,actor:'author'});
 for(const item of chosen)item.accepted=true;
 t.revision++;t.updatedAt=new Date().toISOString();return store.save(t);
 });}
