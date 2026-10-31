// Private editorial data. This contract never participates in public article payloads.
export const INTERNAL_NOTE_FIELDS=Object.freeze({
 supplement:'补充说明',writing:'写作说明',images:'配图说明',verification:'核对与待办',other:'其他备注',
});
export function internalNoteErrors(value){
 if(value===undefined)return [];
 if(!value||typeof value!=='object'||Array.isArray(value))return ['内部备注须为对象'];
 return Object.entries(value).flatMap(([key,text])=>!Object.hasOwn(INTERNAL_NOTE_FIELDS,key)||typeof text!=='string'||text.length>16000?['内部备注字段无效：'+key]:[]);
}
export function appendInternalNotes(previous={},patch){
 const errors=internalNoteErrors(patch);if(errors.length)throw Error(errors.join('；'));
 const next={...previous};
 for(const [key,value] of Object.entries(patch)){
  const text=value.trim(),old=next[key]||'';
  if(text&&!old.split('\n\n').includes(text))next[key]=[old,text].filter(Boolean).join('\n\n');
 }
 const invalid=internalNoteErrors(next);if(invalid.length)throw Error(invalid.join('；'));
 return next;
}
export function blockNoteErrors(value){
 if(value===undefined)return [];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>500)return ['行间备注须为内容行映射，最多 500 行'];
 return Object.entries(value).flatMap(([id,entry])=>!id||id.length>200||!entry||typeof entry!=='object'||Array.isArray(entry)||internalNoteErrors(entry.notes).length||!entry.notes||entry.anchor&&(!['heading','paragraph','image','markdown','annotation'].includes(entry.anchor.type)||typeof entry.anchor.text!=='string')?['行间备注格式无效：'+id]:[]);
}
export function privateEditorialData(notebook){
 const blockNotes=Object.fromEntries(Object.entries(notebook.blockNotes||{}).map(([id,entry])=>{
  const block=notebook.blocks?.find(b=>b.id===id);
  return [id,{...structuredClone(entry),...(block?{anchor:{type:block.type,text:block.text}}:{})}];
 }));
 return {internalNotes:{...notebook.internalNotes},...(Object.keys(blockNotes).length?{blockNotes}:{}),modelSignatures:structuredClone(notebook.modelSignatures||[])};
}
// Reconstructed Markdown has fresh row IDs. Only an unambiguous exact text
// match may relocate a note; unmatched notes remain available at the title.
export function restorePrivateEditorial(notebook,data){
 const result=privateEditorialData(data),used=new Set(),blockNotes=Object.create(null);
 for(const [id,entry] of Object.entries(result.blockNotes||{})){
  const direct=notebook.blocks.find(b=>b.id===id);
  const matches=direct?[direct]:notebook.blocks.filter(b=>entry.anchor&&b.text===entry.anchor.text&&(b.type===entry.anchor.type||['paragraph','markdown'].includes(b.type)&&['paragraph','markdown'].includes(entry.anchor.type)));
  const key=matches.length===1&&!used.has(matches[0].id)?matches[0].id:id;
  used.add(key);blockNotes[key]=entry;
 }
 return {...result,...(Object.keys(blockNotes).length?{blockNotes:{...blockNotes}}:{})};
}
export function validatePrivateEditorial(value){
 if(value?.version!==1||!value.bodySha||!/^[a-f0-9]{64}$/.test(value.bodySha)||internalNoteErrors(value.internalNotes).length||blockNoteErrors(value.blockNotes).length||!Array.isArray(value.modelSignatures)||value.modelSignatures.length>2000||JSON.stringify(value).length>1000000)throw Error('内部备注归档格式无效');
 for(const s of value.modelSignatures)if(!s||typeof s.runId!=='string'||typeof s.agentId!=='string'||typeof s.agentName!=='string'||typeof s.startedAt!=='string'||typeof s.action!=='string'||!['running','completed','interrupted'].includes(s.status)||(s.modelId!==null&&typeof s.modelId!=='string')||(s.modelName!==null&&typeof s.modelName!=='string')||(s.device!=null&&(typeof s.device!=='string'||s.device.length>120)))throw Error('模型记录格式无效');
 return {version:1,bodySha:value.bodySha,...privateEditorialData(value)};
}
