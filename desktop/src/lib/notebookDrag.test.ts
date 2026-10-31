// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {NotebookDoc, NotebookBlock, NotebookAtom, NotebookEditing, notebookStarter, notebookJSON, readNotebook, editNotes} from '../editorial/notebookEditorModel';
import {notebookMoveUnits, reorderNotebook} from '../editorial/notebookReorder';
import {startNotebookDrag} from '../editorial/notebookPointerDrag';
import type {NoteBlock, NoteGroup} from '../../scripts/agent/notebook.mjs';

const block = (id:string, extra:Partial<NoteBlock> = {}):NoteBlock => ({id, type:'paragraph', text:id, state:'ready', sourceIds:[], ...extra});
const original = {blocks:[block('a', {locked:true, sourceIds:['source'], requirement:'保留人工要求'}), block('heading', {type:'heading', level:2, groupId:'section'}), block('body', {groupId:'section'}), block('image', {type:'image', groupId:'figure'}), block('caption', {type:'annotation', role:'caption', targetId:'image', groupId:'figure'}), block('z')], groups:[{id:'section', kind:'section'}, {id:'figure', kind:'figure'}] as NoteGroup[]};
const order = (note:typeof original) => note.blocks.map(b => b.id);

it('reorders upward, downward, first and last, keeping section/figure metadata together', () => {
  const down = reorderNotebook(original, 'body', 'caption', 'after');
  expect(order(down)).toEqual(['a','image','caption','heading','body','z']);
  const first = reorderNotebook(down, 'caption', 'a', 'before');
  expect(order(first)).toEqual(['image','caption','a','heading','body','z']);
  expect(order(reorderNotebook(first, 'image', 'z', 'after'))).toEqual(['a','heading','body','z','image','caption']);
  expect(first.groups).toBe(original.groups);
  expect(first.blocks.find(b => b.id==='a')).toBe(original.blocks[0]);
  expect(first.blocks.find(b => b.id==='caption')).toBe(original.blocks[4]);
});
it('also keeps legacy images with captions; self and adjacent drops do not change history', () => {
  const legacy = {blocks:[block('a'),block('img',{type:'image'}),block('cap',{type:'annotation',role:'caption',targetId:'img'}),block('b')], groups:[]};
  expect(notebookMoveUnits(legacy).map(u => u.map(b => b.id))).toEqual([['a'],['img','cap'],['b']]);
  expect(order(reorderNotebook(legacy,'cap','b','after'))).toEqual(['a','b','img','cap']);
  expect(reorderNotebook(original,'heading','body','after')).toBe(original);
  expect(reorderNotebook(original,'a','heading','before')).toBe(original);
  expect(reorderNotebook(original,'z','caption','after')).toBe(original);
});
it('commits a move as one undo step and restores exact content and relations', () => {
  const editor = new Editor({extensions:[NotebookDoc,notebookStarter(),NotebookBlock,NotebookAtom,NotebookEditing],content:notebookJSON(original.blocks,original.groups)});
  try {
    editNotes(editor,n => reorderNotebook(n,'image','a','before'));
    expect(readNotebook(editor.state.doc).blocks.slice(0,2).map(b=>b.id)).toEqual(['image','caption']);
    editor.commands.undo(); expect(readNotebook(editor.state.doc)).toEqual(original);
    expect(editor.can().undo()).toBe(false);
    editor.commands.redo(); expect(readNotebook(editor.state.doc).blocks[0].id).toBe('image');
  } finally { editor.destroy(); }
});

let host:HTMLDivElement, paper:HTMLDivElement, cancel:() => void;
const changes = vi.fn(), dropped = vi.fn(), finished = vi.fn();
function pointer(type:string, y:number, x=30, pointerId=1) {
  const event = new MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y});
  Object.defineProperties(event,{pointerId:{value:pointerId},pointerType:{value:'mouse'}});
  return event as PointerEvent;
}
function begin() { cancel = startNotebookDrag({event:pointer('pointerdown',50),handle:host.querySelector('summary')!,host,id:'a',units:[['a'],['b','c'],['z']],onChange:changes,onDrop:dropped,onFinish:finished}); }
beforeEach(() => {
  vi.useFakeTimers(); changes.mockClear(); dropped.mockClear(); finished.mockClear();
  paper = document.createElement('div'); paper.className='notebook-paper'; host=document.createElement('div'); paper.append(host); document.body.append(paper);
  paper.getBoundingClientRect=()=>({left:0,right:300,top:0,bottom:500,height:500,width:300} as DOMRect);
  host.innerHTML=['a','b','c','z'].map(id=>`<div data-block-id="${id}"><summary>${id}</summary></div>`).join('');
  [...host.children].forEach((row,i) => { row.getBoundingClientRect=()=>({top:i*100,bottom:(i+1)*100,left:0,right:300,width:300,height:100} as DOMRect); });
});
afterEach(() => { cancel?.(); paper.remove(); vi.useRealTimers(); });
it('distinguishes a click from long press, shows a group boundary, commits only on release', () => {
  begin(); document.dispatchEvent(pointer('pointerup',50)); expect(dropped).not.toHaveBeenCalled(); expect(finished).toHaveBeenLastCalledWith(false);
  begin(); vi.advanceTimersByTime(300); expect(changes).toHaveBeenLastCalledWith({ids:['a'],drop:null});
  document.dispatchEvent(pointer('pointermove',280)); expect(changes).toHaveBeenLastCalledWith({ids:['a'],drop:{id:'c',edge:'after'}}); expect(dropped).not.toHaveBeenCalled();
  document.dispatchEvent(pointer('pointerup',280)); expect(dropped).toHaveBeenCalledExactlyOnceWith({id:'c',edge:'after'}); expect(finished).toHaveBeenLastCalledWith(true);
});
it.each(['Escape','pointercancel','outside'])('cancels %s without committing a move', reason => {
  begin(); document.dispatchEvent(pointer('pointermove',350));
  if(reason==='Escape') window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  else document.dispatchEvent(pointer(reason==='outside'?'pointerup':'pointercancel',350,reason==='outside'?500:30));
  expect(dropped).not.toHaveBeenCalled(); expect(changes).toHaveBeenLastCalledWith(null);
});
it('scrolls at the paper edge and cleans up timers and other pointer events', () => {
  begin(); document.dispatchEvent(pointer('pointermove',490)); vi.advanceTimersByTime(48); expect(paper.scrollTop).toBeGreaterThan(0);
  document.dispatchEvent(pointer('pointerup',490,30,2)); expect(finished).not.toHaveBeenCalled();
  cancel(); const top=paper.scrollTop; vi.advanceTimersByTime(400); expect(paper.scrollTop).toBe(top); expect(dropped).not.toHaveBeenCalled();
});

it.each(['drop','escape','outside'])('drag deletion commits only on an explicit trash drop: %s',reason=>{
 const trash=document.createElement('div'),removed=vi.fn();trash.getBoundingClientRect=()=>({left:10,right:290,top:410,bottom:480} as DOMRect);
 cancel=startNotebookDrag({event:pointer('pointerdown',50),handle:host.querySelector('summary')!,host,id:'a',units:[['a'],['b','c'],['z']],onChange:changes,onDrop:dropped,onFinish:finished,trash:()=>trash,onDelete:removed});
 vi.advanceTimersByTime(300);document.dispatchEvent(pointer('pointermove',450));expect(changes).toHaveBeenLastCalledWith({ids:['a'],drop:null,deleting:true});expect(removed).not.toHaveBeenCalled();
 if(reason==='escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));else document.dispatchEvent(pointer('pointerup',450,reason==='outside'?500:30));
 if(reason==='drop')expect(removed).toHaveBeenCalledExactlyOnceWith(['a']);else expect(removed).not.toHaveBeenCalled();expect(dropped).not.toHaveBeenCalled();
});
