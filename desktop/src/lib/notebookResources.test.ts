// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import NotebookResourceCard from '../editorial/NotebookResourceCard';
import {Editor} from '@tiptap/core';
import {NotebookDoc,NotebookBlock,NotebookAtom,NotebookEditing,notebookStarter,notebookJSON,readNotebook,syncNotebook} from '../editorial/notebookEditorModel';
import {placeNotebookResource,placedSources,placedTemplates} from '../editorial/notebookResources';
import {startResourceDrag} from '../editorial/notebookResourceDrag';
import type {Notebook,NoteBlock} from '../../scripts/agent/notebook.mjs';
const b=(id:string,extra:Partial<NoteBlock>={}):NoteBlock=>({id,type:'paragraph',text:'人工正文',state:'ready',sourceIds:[],locked:true,...extra});
const blank=():Notebook=>({version:2,title:'文章',kind:'article',skills:[],fields:{},sources:[],blocks:[b('p')],groups:[],mounts:{templates:[],brands:[]}});
const source={id:'web',title:'资料',summary:'原始摘要',url:'https://example.org/a',acquiredVia:'web' as const,reviewed:true};
const template={kind:'template' as const,template:{id:'tpl',name:'研究方法',prompt:'说明方法与步骤'}};
it('remounts a previously removed source without duplicating or editing prose',()=>{
 const n=blank();n.sources=[source];n.blocks[0].sourceIds=[source.id];n.context={webEnabled:false,excludedSourceIds:[source.id]};
 const remounted=placeNotebookResource(n,{kind:'web',source});expect(remounted.context?.excludedSourceIds).toEqual([]);expect(remounted.blocks).toBe(n.blocks);expect(remounted.sources).toBe(n.sources);
});
it('places a source as an empty placeholder, reuses reviewed metadata and rejects duplicate or stale drops',()=>{
 const n=blank();n.sources=[source];const placed=placeNotebookResource(n,{kind:'web',source},{id:'p',edge:'before'},()=> 'insert');
 expect(placed.blocks[0]).toMatchObject({id:'insert',state:'placeholder',text:'',sourceIds:['web']});expect(placed.blocks[1]).toBe(n.blocks[0]);expect(placed.sources).toBe(n.sources);
 expect(placedSources(n)).toEqual([]);expect(placedSources(placed)).toEqual([source]);expect(placeNotebookResource(placed,{kind:'web',source})).toBe(placed);
 expect(placeNotebookResource(n,{kind:'web',source},{id:'gone',edge:'after'})).toBe(n);
});
it('inserts outside grouped sections and replaces only a pristine initial slot',()=>{
 const n=blank();n.blocks=[b('h',{type:'heading',level:2,groupId:'g'}),b('p',{groupId:'g'}),b('last')];n.groups=[{id:'g',kind:'section'}];
 const placed=placeNotebookResource(n,template,{id:'p',edge:'before'});expect(placed.blocks.slice(2)).toEqual(n.blocks);expect(placed.groups?.[0]).toEqual(n.groups[0]);expect(placedTemplates(placed)).toEqual(['tpl']);
 const empty=blank();empty.blocks=[b('empty',{locked:false,state:'placeholder',text:''})];expect(placeNotebookResource(empty,template).blocks).toHaveLength(2);
 empty.blocks[0].requirement='我的占位要求';expect(placeNotebookResource(empty,template).blocks).toHaveLength(3);
});
it('undo and redo restore both candidate availability and inserted grouping',()=>{
 const n=blank(),placed=placeNotebookResource(n,template),editor=new Editor({extensions:[NotebookDoc,notebookStarter(),NotebookBlock,NotebookAtom,NotebookEditing],content:notebookJSON(n.blocks,n.groups)});
 try{syncNotebook(editor,placed.blocks,placed.groups);expect(placedTemplates({...placed,...readNotebook(editor.state.doc)})).toEqual(['tpl']);editor.commands.undo();expect(readNotebook(editor.state.doc).blocks).toEqual(n.blocks);expect(placedTemplates({...placed,...readNotebook(editor.state.doc)})).toEqual([]);editor.commands.redo();expect(placedTemplates({...placed,...readNotebook(editor.state.doc)})).toEqual(['tpl']);}finally{editor.destroy();}
});
function pointer(type:string,x:number,y:number,id=1){const e=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y});Object.defineProperty(e,'pointerId',{value:id});return e as PointerEvent;}
let cancel:(()=>void)|undefined;
afterEach(()=>{cancel?.();cancel=undefined;vi.useRealTimers();document.body.innerHTML='';});
function drag(){vi.useFakeTimers();const handle=document.createElement('button'),paper=document.createElement('div');document.body.append(handle,paper);paper.getBoundingClientRect=()=>({left:300,right:700,top:0,bottom:500,height:500,width:400} as DOMRect);paper.innerHTML='<div data-block-id="h"></div><div data-block-id="p"></div>';
 [...paper.children].forEach((row,index)=>row.getBoundingClientRect=()=>({left:300,right:700,top:80+index*100,bottom:180+index*100,height:100,width:400} as DOMRect));const change=vi.fn(),drop=vi.fn();cancel=startResourceDrag({event:pointer('pointerdown',50,50),handle,paper,units:[['h','p']],onChange:change,onDrop:drop});return {change,drop,paper};}
it('long press highlights the destination without inserting, then drops at a whole-group boundary',()=>{const {change,drop}=drag();vi.advanceTimersByTime(299);expect(change).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(change.mock.lastCall?.[0]).toMatchObject({drop:null});document.dispatchEvent(pointer('pointermove',400,260));expect(change.mock.lastCall?.[0].drop).toEqual({id:'p',edge:'after'});expect(drop).not.toHaveBeenCalled();document.dispatchEvent(pointer('pointerup',400,260));expect(drop).toHaveBeenCalledExactlyOnceWith({id:'p',edge:'after'});expect(change).toHaveBeenLastCalledWith(null);});
it.each(['outside','escape','pointercancel','unmount'])('preserves a candidate when drag ends through %s',reason=>{const {drop}=drag();document.dispatchEvent(pointer('pointermove',400,260));if(reason==='outside')document.dispatchEvent(pointer('pointerup',50,50));if(reason==='escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));if(reason==='pointercancel')document.dispatchEvent(pointer('pointercancel',400,260));if(reason==='unmount')cancel?.();expect(drop).not.toHaveBeenCalled();});
it('a click does not insert, and other pointers cannot commit the current drag',()=>{const {drop}=drag();document.dispatchEvent(pointer('pointerup',50,50));expect(drop).not.toHaveBeenCalled();cancel?.();const second=drag();document.dispatchEvent(pointer('pointermove',400,260));document.dispatchEvent(pointer('pointerup',400,260,2));expect(second.drop).not.toHaveBeenCalled();document.dispatchEvent(pointer('pointerup',400,260));expect(second.drop).toHaveBeenCalledOnce();});

it('starts dragging from the entire resource card but keeps its action buttons independent',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);const root=createRoot(host),start=vi.fn(),add=vi.fn(),open=vi.fn();
 try{await act(async()=>root.render(createElement(NotebookResourceCard,{title:'来源',description:'摘要',meta:'RSS',icon:'rss',onPointerDown:start,onAdd:add,onOpen:open})));
 await act(async()=>host.querySelector('.notebook-source-body p')!.dispatchEvent(pointer('pointerdown',20,20)));expect(start).toHaveBeenCalledOnce();
 const action=host.querySelector<HTMLButtonElement>('[aria-label="插入文章：来源"]')!;await act(async()=>{action.dispatchEvent(pointer('pointerdown',20,20));action.click();});expect(start).toHaveBeenCalledOnce();expect(add).toHaveBeenCalledOnce();
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="查看原文：来源"]')!.click());expect(open).toHaveBeenCalledOnce();
 await act(async()=>root.render(createElement(NotebookResourceCard,{title:'来源',description:'摘要',meta:'RSS',icon:'rss',disabled:true,onPointerDown:start,onAdd:add})));
 await act(async()=>host.querySelector('.notebook-source-body')!.dispatchEvent(pointer('pointerdown',20,20)));expect(start).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
