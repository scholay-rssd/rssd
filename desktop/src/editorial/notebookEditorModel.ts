import {Extension, Node, getSchema, type Editor, type JSONContent} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {MarkdownManager} from '@tiptap/markdown';
import {marked} from 'marked';
import {Fragment, type Node as PMNode} from '@tiptap/pm/model';
import {Plugin, TextSelection} from '@tiptap/pm/state';
import {closeHistory} from '@tiptap/pm/history';
import type {NoteBlock, NoteGroup} from '../../scripts/agent/notebook.mjs';

export const notebookStarter = () => StarterKit.configure({document:false, underline:false, trailingNode:false, link:{openOnClick:false, autolink:false}});
const markdown = new MarkdownManager({extensions:[StarterKit.configure({underline:false, trailingNode:false})], markedOptions:{gfm:true,breaks:false}});
export const newNote = (type:NoteBlock['type']='paragraph', extra:Partial<NoteBlock>={}):NoteBlock => ({id:crypto.randomUUID(),type,text:'',requirement:'',state:type==='image'?'placeholder':'ready',sourceIds:[],...(type==='heading'?{level:2}:{}),...extra});
const contentSchema=getSchema([StarterKit.configure({underline:false,trailingNode:false})]);
const fingerprint = (content:JSONContent[]) => JSON.stringify(content);
// Unsupported syntax stays editable as source, never silently flattened by the rich editor.
export function sourceOnly(b:NoteBlock){return b.type==='markdown'||/(^---\s*\n|\[\^|<\/?[a-zA-Z]|!\[|^\s*\|.*\|\s*$|^\s*[-*+] \[[ xX]\]|\$\$|\\\[)/m.test(b.text)||marked.lexer(b.text).some(token=>token.type==='table'||token.type==='html');}
export function noteJSON(b:NoteBlock):JSONContent {
 if(b.type==='image'||sourceOnly(b))return {type:'notebookAtom',attrs:{note:b}};
 let content:JSONContent[];
 try{content=markdown.parse(b.type==='heading'?'#'.repeat(b.level||2)+' '+b.text:b.text).content||[];}catch{return {type:'notebookAtom',attrs:{note:b}};}
 if(!content.length)content=[{type:b.type==='heading'?'heading':'paragraph',...(b.type==='heading'?{attrs:{level:b.level||2}}:{})}];
 return {type:'notebookBlock',attrs:{note:b,baseline:fingerprint(contentSchema.nodeFromJSON({type:'doc',content}).toJSON().content||[])},content};
}
export const notebookJSON=(blocks:NoteBlock[],groups:NoteGroup[]=[]):JSONContent=>({type:'doc',attrs:{groups},content:(blocks.length?blocks:[newNote()]).map(noteJSON)});
export function readNote(node:PMNode):NoteBlock {
 const note:NoteBlock=node.attrs.note||newNote();
 if(node.type.name==='notebookAtom')return note;
 const content=node.toJSON().content||[];
 if(fingerprint(content)===node.attrs.baseline)return note;
 const heading=node.childCount===1&&node.firstChild?.type.name==='heading';
 const text=markdown.serialize({type:'doc',content});
 return {...note,heading:undefined,type:note.type==='annotation'?'annotation':heading?'heading':'paragraph',...(heading?{level:node.firstChild!.attrs.level}:{}),text:heading?text.replace(/^#{1,6} /,''):text,state:node.content.size>2?'ready':note.state,locked:node.content.size>2?true:note.locked};
}
export function readNotebook(doc:PMNode){const blocks:NoteBlock[]=[];doc.forEach(node=>blocks.push(readNote(node)));return {blocks,groups:doc.attrs.groups as NoteGroup[]};}
export function noteAt(editor:Editor,id?:string){let result:{node:PMNode;pos:number;index:number}|undefined;editor.state.doc.forEach((node,pos,index)=>{if(id?node.attrs.note?.id===id:pos<=editor.state.selection.from&&pos+node.nodeSize>editor.state.selection.from)result={node,pos,index};});return result;}
export function focusNote(editor:Editor,id:string,end=false){const found=noteAt(editor,id);if(!found)return;editor.commands.focus();editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(found.pos+(end?found.node.nodeSize-1:1)),end?-1:1)));}
export function replaceNotebook(editor:Editor,blocks:NoteBlock[],groups:NoteGroup[]=[],history=true){
 const next=editor.schema.nodeFromJSON(notebookJSON(blocks,groups));
 let tr=editor.state.tr.replaceWith(0,editor.state.doc.content.size,next.content).setDocAttribute('groups',groups).setMeta('notebookStructuralEdit',true);
 tr=history?closeHistory(tr):tr.setMeta('addToHistory',false);
 editor.view.dispatch(tr);
}
export function editNotes(editor:Editor,edit:(value:ReturnType<typeof readNotebook>)=>ReturnType<typeof readNotebook>,focus?:string){
 if(!editor.isEditable)return;const previous=readNotebook(editor.state.doc),value=edit(previous);if(value!==previous)replaceNotebook(editor,value.blocks,value.groups);if(focus)focusNote(editor,focus);
}
export function patchNote(editor:Editor,id:string,patch:Partial<NoteBlock>){
 if(!editor.isEditable)return;const found=noteAt(editor,id);if(!found)return;
 const note={...readNote(found.node),...patch},next=editor.schema.nodeFromJSON(noteJSON(note));
 const tr=editor.state.tr.replaceWith(found.pos,found.pos+found.node.nodeSize,next);editor.view.dispatch(closeHistory(tr));
}
const semantic=(blocks:NoteBlock[])=>JSON.stringify(blocks.map(({createdAt,updatedAt,revision,updatedBy,...b})=>b));
// Autosave receipts update server stamps without creating undo steps or resetting selection.
export function syncNotebook(editor:Editor,blocks:NoteBlock[],groups:NoteGroup[]=[]){
 const before=readNotebook(editor.state.doc);
 if(JSON.stringify(before)===JSON.stringify({blocks,groups}))return;
 if(semantic(before.blocks)===semantic(blocks)&&JSON.stringify(before.groups)===JSON.stringify(groups)){
  const tr=editor.state.tr;editor.state.doc.forEach((node,pos,i)=>tr.setNodeMarkup(pos,undefined,{...node.attrs,note:blocks[i]}));editor.view.dispatch(tr.setMeta('addToHistory',false));
 }else replaceNotebook(editor,blocks,groups);
}
export const NotebookDoc=Node.create({name:'doc',topNode:true,content:'notebook*',addAttributes:()=>({groups:{default:[]}})});
export const NotebookBlock=Node.create({name:'notebookBlock',group:'notebook',content:'block+',defining:true,
 addAttributes:()=>({note:{default:null},baseline:{default:''}}),
 parseHTML:()=>[{tag:'div[data-notebook-text]'}],renderHTML:()=>['div',{'data-notebook-text':''},0]});
export const NotebookAtom=Node.create({name:'notebookAtom',group:'notebook',atom:true,selectable:true,
 addAttributes:()=>({note:{default:null}}),parseHTML:()=>[],renderHTML:({node})=>['div',{'data-notebook-source':''},node.attrs.note?.text||'']});

function mergeable(a:NoteBlock,b:NoteBlock){return a.type==='paragraph'&&b.type==='paragraph'&&a.groupId===b.groupId;}
const combine=(a:NoteBlock,b:NoteBlock)=>({...a,sourceIds:[...new Set([...a.sourceIds,...b.sourceIds])],requirement:[...new Set([a.requirement,b.requirement].filter(Boolean))].join('\n'),state:'ready' as const,locked:true});
export function boundaryKey(editor:Editor,key:string){
 const {state,view}=editor,{$from,empty}=state.selection,found=noteAt(editor);
 if(!found||found.node.type.name!=='notebookBlock')return false;
 if(key==='Enter'&&empty){
  // Lists and code keep their familiar native Enter behavior.
  if($from.depth!==2||!['paragraph','heading'].includes($from.parent.type.name))return false;
  const following=state.doc.maybeChild(found.index+1);
  if($from.parent.type.name==='heading'&&$from.parentOffset===$from.parent.content.size&&following?.type.name==='notebookBlock'&&following.attrs.note?.type==='paragraph'&&!following.textContent&&following.attrs.note.groupId===found.node.attrs.note.groupId){focusNote(editor,following.attrs.note.id);return true;}
  const cut=state.selection.from-found.pos-1,b=readNote(found.node);
  const left=found.node.content.cut(0,cut),right=found.node.content.cut(cut);
  const next=newNote(b.type==='annotation'?'annotation':'paragraph',{groupId:b.groupId,sourceIds:[...b.sourceIds],...(b.type==='annotation'?{role:b.role,targetId:b.targetId,purpose:b.purpose}:{})});
  const first=found.node.type.create({...found.node.attrs,note:{...b,state:'ready',locked:true},baseline:''},left);
  const rightNodes:PMNode[]=[];right.forEach(n=>rightNodes.push(n.type.name==='heading'?state.schema.nodes.paragraph.create(null,n.content):n));
  const second=found.node.type.create({note:next,baseline:''},rightNodes.length?rightNodes:[state.schema.nodes.paragraph.create()]);
  const tr=state.tr.replaceWith(found.pos,found.pos+found.node.nodeSize,Fragment.fromArray([first,second]));
  tr.setSelection(TextSelection.near(tr.doc.resolve(found.pos+first.nodeSize+1)));view.dispatch(closeHistory(tr).scrollIntoView());return true;
 }
 if(!empty||!['Backspace','Delete'].includes(key)||$from.depth!==2||$from.parent.type.name!=='paragraph')return false;
 const backwards=key==='Backspace';
 if(backwards?$from.parentOffset!==0||$from.index(1)!==0:$from.parentOffset!==$from.parent.content.size||$from.index(1)!==found.node.childCount-1)return false;
 const otherIndex=found.index+(backwards?-1:1);if(otherIndex<0||otherIndex>=state.doc.childCount)return true;
 const other=state.doc.child(otherIndex),a=backwards?other:found.node,b=backwards?found.node:other;
 if(a.type.name!=='notebookBlock'||b.type.name!=='notebookBlock'||!mergeable(readNote(a),readNote(b)))return true;
 const start=backwards?found.pos-other.nodeSize:found.pos,join=a.content.size-1;
 const merged=Fragment.fromArray([...Array.from({length:a.childCount-1},(_,i)=>a.child(i)),state.schema.nodes.paragraph.create(null,a.lastChild!.content.append(b.firstChild!.content)),...Array.from({length:b.childCount-1},(_,i)=>b.child(i+1))]);
 const node=a.type.create({note:combine(readNote(a),readNote(b)),baseline:''},merged);
 const tr=state.tr.replaceWith(start,start+a.nodeSize+b.nodeSize,node);tr.setSelection(TextSelection.near(tr.doc.resolve(start+join)));view.dispatch(closeHistory(tr).scrollIntoView());return true;
}
export const NotebookEditing=Extension.create<{slash:(id:string)=>void}>({name:'notebookEditing',priority:1100,
 addOptions:()=>({slash:()=>{}}),
 addProseMirrorPlugins(){const editor=this.editor,slash=this.options.slash;return [new Plugin({
  props:{handleKeyDown(view,event){if(event.isComposing||view.composing||event.keyCode===229)return event.key==='Enter';if(!event.shiftKey&&!event.metaKey&&!event.ctrlKey&&['Enter','Backspace','Delete'].includes(event.key)&&boundaryKey(editor,event.key))return true;if(event.key==='/'&&editor.state.selection.empty){const found=noteAt(editor);if(found?.node.type.name==='notebookBlock'&&!found.node.textContent){event.preventDefault();slash(found.node.attrs.note.id);return true;}}return false;},
   clipboardTextSerializer(slice){const parts:string[]=[];slice.content.forEach(node=>{parts.push(node.type.name.startsWith('notebook')?readNote(node).text:markdown.serialize(node.toJSON()));});return parts.join('\n\n');},
   handleDrop(_view,event){return !!event.dataTransfer?.files.length;},
  },
  appendTransaction(transactions,old,state){
   if(!transactions.some(t=>t.docChanged))return null;
   const tr=state.tr,ids=new Set<string>(),groups:NoteGroup[]=[...state.doc.attrs.groups];let previousGroup:string|undefined,mappedGroup:string|undefined;const closed=new Set<string>();
   const imageIds=new Set<string>();state.doc.forEach(node=>{if(node.attrs.note?.type==='image')imageIds.add(node.attrs.note.id);});
   const removedSources:NoteBlock[]=[];
   if(!old.selection.empty&&!transactions.some(t=>t.getMeta('notebookStructuralEdit'))){const existing=new Set<string>();state.doc.forEach(n=>existing.add(n.attrs.note?.id));old.doc.forEach(n=>{if(!existing.has(n.attrs.note?.id)&&n.attrs.note)removedSources.push(n.attrs.note);});}
   state.doc.forEach((node,pos)=>{
    let note=readNote(node);
    if(note.role==='caption'&&!imageIds.has(note.targetId!)){tr.delete(tr.mapping.map(pos),tr.mapping.map(pos+node.nodeSize));return;}
    if(ids.has(note.id))note={...note,id:crypto.randomUUID()};ids.add(note.id);
    if(note.groupId!==previousGroup){if(previousGroup)closed.add(previousGroup);mappedGroup=note.groupId;if(note.groupId&&closed.has(note.groupId)){const original=groups.find(g=>g.id===note.groupId);mappedGroup=crypto.randomUUID();if(original)groups.push({...original,id:mappedGroup});}previousGroup=note.groupId;}if(mappedGroup!==note.groupId)note={...note,groupId:mappedGroup};
    if(removedSources.length&&pos<=state.selection.from&&pos+node.nodeSize>state.selection.from)for(const source of removedSources)note=combine(note,source);
    const baseline=node.type.name==='notebookBlock'?fingerprint(node.toJSON().content||[]):undefined;
    if(JSON.stringify(note)!==JSON.stringify(node.attrs.note)||baseline!==undefined&&baseline!==node.attrs.baseline)tr.setNodeMarkup(tr.mapping.map(pos),undefined,{...node.attrs,note,...(baseline!==undefined?{baseline}:{})});
   });
   const used=new Set<string>();tr.doc.forEach(n=>{if(n.attrs.note?.groupId)used.add(n.attrs.note.groupId);});
   const nextGroups=groups.filter(g=>used.has(g.id));if(JSON.stringify(nextGroups)!==JSON.stringify(state.doc.attrs.groups))tr.setDocAttribute('groups',nextGroups);
   if(!tr.doc.childCount)tr.insert(0,state.schema.nodeFromJSON(noteJSON(newNote())));
   return tr.docChanged?tr:null;
  },
 })];},
});
