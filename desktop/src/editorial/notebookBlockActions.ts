import {formatErrors,type NoteBlock,type NoteGroup,type NoteSource} from '../../scripts/agent/notebook.mjs';
import {notebookMoveUnits} from './notebookReorder';
import { tr } from "../uiText";
type Document={blocks:NoteBlock[];groups:NoteGroup[]};
export const BLOCK_CLIPBOARD='application/x-today-notebook-blocks';
export type BlockClipboard={version:1;blocks:NoteBlock[];groups:NoteGroup[];sources:NoteSource[]};
export function selectedUnitIds(note:Document,ids:string[]){const wanted=new Set(ids);return notebookMoveUnits(note).filter(unit=>unit.some(b=>wanted.has(b.id))).flatMap(unit=>unit.map(b=>b.id));}
export function removeBlocks<T extends Document>(note:T,ids:string[]):T{const selected=new Set(selectedUnitIds(note,ids)),blocks=note.blocks.filter(b=>!selected.has(b.id)),groups=note.groups.filter(g=>blocks.some(b=>b.groupId===g.id));return {...note,blocks,groups};}
export function copyBlocks(note:Document,ids:string[],sources:NoteSource[]=[]):BlockClipboard{
 const selected=new Set(selectedUnitIds(note,ids)),blocks=note.blocks.filter(b=>selected.has(b.id)),used=new Set(blocks.flatMap(b=>b.sourceIds));
 return structuredClone({version:1,blocks,groups:note.groups.filter(g=>blocks.some(b=>b.groupId===g.id)),sources:sources.filter(s=>used.has(s.id))});
}
export function parseBlockClipboard(raw:string):BlockClipboard{
 if(raw.length>1000000)throw Error(tr('复制内容过大'));const value=JSON.parse(raw);
 if(value?.version!==1||!Array.isArray(value.blocks)||!value.blocks.length||!Array.isArray(value.groups)||!Array.isArray(value.sources))throw Error(tr('块内容格式无效'));
 const errors=formatErrors({...value,version:2,title:'',kind:'article',skills:[],fields:{}});if(errors.length)throw Error(tr('块内容格式无效：{{error}}',{error:errors[0].message}));
 return value;
}
export function pasteBlocks<T extends Document>(note:T,payload:BlockClipboard,afterId?:string,sources:NoteSource[]=[],makeId=()=>crypto.randomUUID()){
 if(note.blocks.length===1&&note.blocks[0].type==='paragraph'&&!note.blocks[0].text&&!note.blocks[0].requirement&&!note.blocks[0].locked&&!note.blocks[0].sourceIds.length&&!note.blocks[0].groupId)note={...note,blocks:[]};
 const blockIds=new Map(payload.blocks.map(b=>[b.id,makeId()])),groupIds=new Map(payload.groups.map(g=>[g.id,makeId()])),sourceIds=new Map<string,string>(),merged=[...sources];
 for(const source of payload.sources){const existing=merged.find(s=>s.url===source.url);let id=existing?.id||source.id;if(!existing&&merged.some(s=>s.id===id))id=makeId();sourceIds.set(source.id,id);if(!existing)merged.push({...source,id});}
 const blocks=payload.blocks.map(({createdAt,updatedAt,revision,updatedBy,...b})=>({...b,id:blockIds.get(b.id)!,...(b.groupId?{groupId:groupIds.get(b.groupId)}:{}),...(b.targetId?{targetId:blockIds.get(b.targetId)}:{}),sourceIds:b.sourceIds.map(id=>sourceIds.get(id)||id)}));
 const unit=notebookMoveUnits(note).find(u=>u.some(b=>b.id===afterId)),index=unit?note.blocks.findIndex(b=>b.id===unit.at(-1)!.id)+1:note.blocks.length;
 return {note:{...note,blocks:[...note.blocks.slice(0,index),...blocks,...note.blocks.slice(index)],groups:[...note.groups,...payload.groups.map(g=>({...g,id:groupIds.get(g.id)!}))]},ids:blocks.map(b=>b.id),sources:merged};
}
