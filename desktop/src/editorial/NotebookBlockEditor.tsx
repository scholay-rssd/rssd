import NotebookSourceEditor from './NotebookSourceEditor';
import {headingLabels} from '../../scripts/agent/notebook-headings.mjs';
import {createContext,useContext,useEffect,useMemo,useRef,useState,type ReactNode,type MouseEvent as ReactMouseEvent} from 'react';
import {EditorContent,NodeViewContent,NodeViewWrapper,ReactNodeViewRenderer,useEditor,type NodeViewProps} from '@tiptap/react';
import {createPortal} from 'react-dom';
import {BLOCK_CLIPBOARD,copyBlocks,parseBlockClipboard,pasteBlocks,removeBlocks,selectedUnitIds} from './notebookBlockActions';
import type {Editor,Extensions} from '@tiptap/core';
import {notebookGroups,type NoteBlock,type NoteGroup,type NoteSource} from '../../scripts/agent/notebook.mjs';
import {NotebookDoc,NotebookBlock,NotebookAtom,NotebookEditing,notebookStarter,notebookJSON,readNotebook,readNote,noteAt,newNote,editNotes,patchNote,focusNote,syncNotebook} from './notebookEditorModel';
import Icon from '../components/Icon';
import PopoverDetails from '../components/PopoverDetails';
import {useDismiss} from '../hooks/useDismiss';
import {useNotebookDrag} from './useNotebookDrag';
import {notebookMoveUnits} from './notebookReorder';
import './notebook-editor.css';

import { tr, trKey } from "../uiText";
type Props={extensions?:Extensions;imageMethods?:{method:'online'|'local'|'generate';label:string}[];unifiedCompletion?:boolean;blocks:NoteBlock[];groups?:NoteGroup[];sources?:NoteSource[];disabled:boolean;labels:Record<string,string>;onChange:(blocks:NoteBlock[],groups?:NoteGroup[],sources?:NoteSource[])=>void;onAi?:(ids:string[],action:'fill'|'revise')=>void;onImage:(id:string,method:'online'|'local'|'generate')=>void;renderAside?:(b:NoteBlock,index:number)=>ReactNode;renderImage:(b:NoteBlock)=>ReactNode};
type InsertType='paragraph'|'heading'|'section'|'figure'|'endnote'|'markdown';
const INSERTS:{type:InsertType;label:string;hint:string;level?:number}[]=[{type:'paragraph',label:trKey('正文行'),hint:trKey('段落 paragraph')},{type:'heading',level:1,label:trKey('标题 1'),hint:'H1 heading'},{type:'heading',level:2,label:trKey('标题 2'),hint:'H2 heading'},{type:'heading',level:3,label:trKey('标题 3'),hint:'H3 heading'},{type:'section',label:trKey('标题＋正文'),hint:trKey('分组 section')},{type:'figure',label:trKey('图片＋图注'),hint:trKey('在线搜索、本地选取、即时生成 image')},{type:'endnote',label:trKey('尾部注释'),hint:trKey('说明、引用、外链 annotation')},{type:'markdown',label:trKey('Markdown 源文'),hint:trKey('保留源文本 source')}];
type Controls={props:Props;editor:Editor;openInsert:(id?:string,before?:boolean)=>void;insertAt:(id?:string,before?:boolean)=>void;insertingId?:string;selected:string[];select:(id:string,event:ReactMouseEvent)=>void;drag:ReturnType<typeof useNotebookDrag>;convert:(id:string,value:string)=>void};
const Context=createContext<Controls|null>(null);
function placeholderSummary(block:NoteBlock){
 const fallback=tr(block.type==='heading'?'待补充标题':block.type==='image'?'待添加图片':block.role==='caption'?'待补充图注':'点击填写写作要求');
 if(!block.requirement?.trim())return fallback;
 if(block.type==='heading'&&block.requirement.startsWith('先完成正文'))return tr('根据正文拟定小节标题');
 const brief=block.requirement.replace(/^写作方向[（(]仅供规划[）)]\s*[：:]\s*/,'').split(/\n|核对资料版本|[。！？]/)[0].trim();
 return brief.length>42?brief.slice(0,42)+'…':brief||fallback;
}
function NotebookRow({node,editor}:NodeViewProps){
 const controls=useContext(Context)!;if(!controls)return <NodeViewWrapper><NodeViewContent/></NodeViewWrapper>;
 const p=controls.props,b=readNote(node),{blocks,groups}=readNotebook(editor.state.doc),index=blocks.findIndex(x=>x.id===b.id),unit=notebookGroups({blocks,groups} as any).find(u=>u.blocks.some(x=>x.id===b.id))!,placeholder=b.state==='placeholder',first=unit?.blocks[0].id===b.id,last=unit?.blocks.at(-1)?.id===b.id;
 const numbered=b.type==='heading'&&!b.locked&&['numbered','fixed'].includes(b.heading?.mode||'')&&b.state==='ready';
 const patch=(value:Partial<NoteBlock>)=>patchNote(editor,b.id,value);
 const close=(element:HTMLElement)=>element.closest('details')?.removeAttribute('open');
 const moving=controls.drag.state?.ids.includes(b.id),drop=controls.drag.state?.drop;

 return <NodeViewWrapper className={'notebook-unit'+(unit?.group?' is-group':'')+(first?' is-group-first':'')+(last?' is-group-last':'')+(moving?' is-dragging':'')+(controls.selected.includes(b.id)?' is-block-selected':'')} data-block-id={b.id} data-group-id={b.groupId} data-drop-edge={drop?.id===b.id?drop.edge:undefined}>
  {!p.disabled&&<button type="button" contentEditable={false} className="notebook-row-gap" aria-label={tr("在第 {{value}} 行前插入", {value: (index+1)})} onClick={()=>controls.insertAt(b.id,true)}><span>＋</span></button>}
  {unit?.group&&first&&<header contentEditable={false} className="notebook-group-header"><span>{unit.group.label||(unit.group.kind==='figure'?tr("图片与图注"):tr("标题与正文"))}</span><small>{tr("{{length}}/{{blocks}} 正式", {length: unit.blocks.filter(x=>x.state==='ready').length, blocks: unit.blocks.length})}</small>{!p.unifiedCompletion&&p.onAi&&<button disabled={p.disabled||!unit.blocks.some(x=>x.state==='placeholder'&&x.type!=='image')} onClick={()=>p.onAi?.(unit.blocks.filter(x=>x.state==='placeholder'&&x.type!=='image').map(x=>x.id),'fill')}>{tr("补全本组")}</button>}</header>}
  <div className={`notebook-row is-${b.type}${placeholder?' is-placeholder':''}${placeholder&&!b.text.trim()?' is-empty-placeholder':''}`} data-level={b.level}>
   {p.renderAside?.(b,index)}
   <button type="button" className="notebook-drag-handle" contentEditable={false} aria-label={tr("选择或拖动内容块 {{value}}", {value: (index+1)})} aria-pressed={controls.selected.includes(b.id)} disabled={p.disabled} title={tr("点击选中；按住拖动")} draggable={false} onDragStart={e=>e.preventDefault()} onPointerDown={e=>controls.drag.start(e,b.id)} onClick={e=>{controls.drag.click(e);if(!e.defaultPrevented)controls.select(b.id,e);}}>⠿</button>
   <div className="notebook-row-actions" contentEditable={false}><span className="notebook-row-kind">{b.type==='image'?tr("图片"):b.type==='heading'?`H${b.level}`:b.role==='caption'?tr("图注"):b.role==='endnote'?tr("尾注"):b.type==='markdown'?'Markdown':tr("正文")}</span><PopoverDetails className="notebook-block-menu"><summary aria-label={tr("内容行菜单 {{value}}", {value: (index+1)})} title={tr("行级操作")}>⋯</summary><div className="notebook-block-popover">
    <small>{tr("内容行 {{value}}", {value: index+1})}</small>
    {b.type==='image'&&<><div className="notebook-image-actions">{(p.imageMethods||[{method:'online',label:tr("在线搜索")},{method:'local',label:tr("本地选取")},{method:'generate',label:tr("即时生成")}] as const).map(({method,label})=><button key={method} disabled={p.disabled} onClick={()=>p.onImage(b.id,method)}>{label}</button>)}</div>{b.text&&<details className="notebook-properties"><summary>{tr("图片显示")}</summary><label>{tr("替代文本")}<input value={b.alt||''} disabled={p.disabled} onChange={e=>patch({alt:e.target.value})}/></label><label>{tr("宽度")}<select value={b.presentation?.widthMode||'content'} disabled={p.disabled} onChange={e=>patch({presentation:{...b.presentation,widthMode:e.target.value as 'content'|'wide'}})}><option value="content">{tr("正文宽度")}</option><option value="wide">{tr("宽幅")}</option></select></label></details>}</>}
    {['paragraph','heading','markdown'].includes(b.type)&&<label>{tr("转换为")}<select aria-label={tr("转换内容行 {{value}}", {value: (index+1)})} disabled={p.disabled} value={b.type==='heading'?'h'+b.level:b.type} onChange={e=>controls.convert(b.id,e.target.value)}><option value="paragraph">{tr("正文")}</option>{[1,2,3,...((b.level||0)>3?[b.level!]:[])].map(n=><option value={'h'+n} key={n}>{tr("标题 {{n}}", {n})}</option>)}<option value="markdown">{tr("Markdown 源文")}</option></select></label>}
    {b.role==='endnote'&&<label>{tr("尾注用途")}<select value={b.purpose||'explanation'} disabled={p.disabled} onChange={e=>patch({purpose:e.target.value as NoteBlock['purpose']})}><option value="explanation">{tr("说明")}</option><option value="reference">{tr("引用")}</option><option value="marketing">{tr("营销外链")}</option></select></label>}
    {p.onAi&&b.type!=='image'&&<button disabled={p.disabled} onClick={e=>{p.onAi?.([b.id],placeholder?'fill':'revise');close(e.currentTarget);}}><Icon name="sparkle"/>{placeholder?tr("交给 AI 完成"):tr("交给 AI 改写")}</button>}
   </div></PopoverDetails>
    {placeholder&&<div className="notebook-requirement" contentEditable={false}><span>{tr("占位")}</span><textarea rows={3} aria-label={tr("占位要求 {{value}}", {value: (index+1)})} value={b.requirement||''} placeholder={p.labels[b.id]||tr("描述这一处需要的内容…")} disabled={p.disabled} onChange={e=>patch({requirement:e.target.value})}/>{!p.unifiedCompletion&&p.onAi&&b.type!=='image'&&<button disabled={p.disabled} aria-label={tr("AI 完成内容行 {{value}}", {value: (index+1)})} onClick={()=>p.onAi?.([b.id],'fill')} title={tr("交给 AI 完成")}><Icon name="sparkle" size={14}/></button>}</div>}
   </div>
   <div className="notebook-row-content">
    {controls.insertingId===b.id&&<button className="notebook-inline-type" contentEditable={false} onClick={()=>controls.openInsert(b.id)}>{tr("选择行类型 ▾")}</button>}
    {placeholder&&<button type="button" className="notebook-placeholder-preview" contentEditable={false} aria-label={tr("编辑占位要求 {{value}}", {value: (index+1)})} onClick={e=>e.currentTarget.closest('.notebook-row')?.querySelector<HTMLTextAreaElement>('.notebook-requirement textarea')?.focus()}>{placeholderSummary(b)}</button>}
    {numbered&&<span className="notebook-heading-number" contentEditable={false}>{b.heading?.mode==='fixed'?headingLabels(blocks)[b.id].slice(0,-b.text.length):headingLabels(blocks)[b.id]}</span>}
    {node.type.name==='notebookBlock'?<NodeViewContent className="notebook-rich-content" data-row-id={b.id} aria-label={tr("内容行 {{value}}", {value: (index+1)})}/>:
     b.type==='image'?<div className="notebook-image-row" contentEditable={false}>{b.text&&p.renderImage(b)}</div>:
     <NotebookSourceEditor text={b.text} rowId={b.id} label={tr("内容行 {{value}}", {value: (index+1)})} disabled={p.disabled} onChange={text=>patch({text,state:'ready',locked:true})}/>}
   </div>
  </div>
  {!p.disabled&&index===blocks.length-1&&<button type="button" contentEditable={false} className="notebook-row-gap is-last" aria-label={tr("在末尾插入内容块")} onClick={()=>controls.insertAt(b.id)}><span>＋</span></button>}
 </NodeViewWrapper>;
}
export default function NotebookBlockEditor(p:Props){
 const latest=useRef(p);latest.current=p;const syncing=useRef(false),host=useRef<HTMLDivElement>(null);
 const insertRef=useRef<HTMLDivElement>(null),linkRef=useRef<HTMLFormElement>(null),trashRef=useRef<HTMLDivElement>(null),pasteSources=useRef<NoteSource[]|undefined>(undefined);
 const [selected,setSelected]=useState<string[]>([]),[blockError,setBlockError]=useState('');const selectionAnchor=useRef<string|undefined>(undefined);
 const [insert,setInsert]=useState<{id?:string;before?:boolean;top:number}|null>(null),[query,setQuery]=useState(''),[choice,setChoice]=useState(0),[link,setLink]=useState<string|null>(null),[linkError,setLinkError]=useState('');
 const openInsert=(id?:string,before=false)=>{const row=[...host.current?.querySelectorAll<HTMLElement>('[data-block-id]')||[]].find(el=>el.dataset.blockId===id);setInsert({id,before,top:row&&host.current?row.getBoundingClientRect().bottom-host.current.getBoundingClientRect().top:45});setQuery('');setChoice(0);};
 const openRef=useRef(openInsert);openRef.current=openInsert;
 // The workbench polls while idle. Recreating constructor options on each poll
 // makes useEditor call setOptions/updateState even when no document changed.
 // Content after mount is reconciled by syncNotebook below, not by options.
 const initialContent=useMemo(()=>notebookJSON(p.blocks,p.groups),[]);
 const extensions=useMemo(()=>[...(p.extensions||[]),NotebookDoc,notebookStarter(),NotebookBlock.extend({addNodeView:()=>ReactNodeViewRenderer(NotebookRow)}),NotebookAtom.extend({addNodeView:()=>ReactNodeViewRenderer(NotebookRow)}),NotebookEditing.configure({slash:id=>openRef.current(id)})],[p.extensions]);
 const bodyLabel=tr('文章正文');
 const editorOptions=useMemo(()=>({extensions,content:initialContent,editable:!p.disabled,shouldRerenderOnTransaction:true,
  editorProps:{attributes:{class:'notebook-prosemirror','aria-label':bodyLabel,'role':'textbox','aria-multiline':'true'}},
  onUpdate({editor}:{editor:Editor}){if(syncing.current)return;const n=readNotebook(editor.state.doc);latest.current.onChange(n.blocks,n.groups,pasteSources.current);pasteSources.current=undefined;},
 }),[extensions,initialContent,p.disabled,bodyLabel]);
 const editor=useEditor(editorOptions);
 useEffect(()=>{if(!editor)return;let cancelled=false;queueMicrotask(()=>{if(cancelled||editor.isDestroyed)return;syncing.current=true;try{syncNotebook(editor,p.blocks,p.groups);}finally{syncing.current=false;}});return()=>{cancelled=true;};},[editor,p.blocks,p.groups]);
 useEffect(()=>{if(editor&&editor.isEditable!==!p.disabled)editor.setEditable(!p.disabled,false);if(p.disabled){setInsert(null);setLink(null);setSelected([]);}},[editor,p.disabled]);
 useDismiss(insertRef,()=>setInsert(null),{enabled:!!insert,onFocusOut:true});
 useDismiss(linkRef,()=>setLink(null),{enabled:link!==null,onFocusOut:true});
 const drag=useNotebookDrag(editor,host,p.disabled,trashRef,selected);
 useEffect(()=>{const outside=(e:Event)=>{if(!host.current?.contains(e.target as Node))setSelected([]);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 useEffect(()=>{setSelected(ids=>ids.filter(id=>p.blocks.some(b=>b.id===id)));},[p.blocks]);
 useEffect(()=>{if(drag.state){setInsert(null);setLink(null);}},[!!drag.state]);
 if(!editor)return null;
 const active=noteAt(editor),activeNote=active&&readNote(active.node),rich=active?.node.type.name==='notebookBlock',editable=!p.disabled&&!!rich;
 function convert(id:string,value:string){const found=noteAt(editor!,id);if(!found)return;const b=readNote(found.node);if(b.type==='image'||b.type==='annotation')return;patchNote(editor!,id,{type:value.startsWith('h')?'heading':value as 'paragraph'|'markdown',...(value.startsWith('h')?{level:Number(value.slice(1))}:{}),locked:b.state==='ready'?true:b.locked});focusNote(editor!,id);}
 function add(type:InsertType,level?:number){
  let focus='';editNotes(editor!,n=>{const anchor=n.blocks.findIndex(b=>b.id===insert?.id),original=n.blocks[anchor];let index=anchor<0?n.blocks.length:anchor+(insert?.before?0:1);const reuse=original&&original.type==='paragraph'&&!original.text&&!original.requirement&&!original.locked&&!original.sourceIds.length;
   const id=crypto.randomUUID(),items:NoteBlock[]=type==='section'||type==='figure'?(()=>{const first=newNote(type==='section'?'heading':'image',{groupId:id});return [first,newNote(type==='section'?'paragraph':'annotation',{groupId:id,...(type==='figure'?{role:'caption',targetId:first.id}:{})})];})():[newNote(type==='endnote'?'annotation':type,{...(level?{level}:{}),...(original?.groupId?{groupId:original.groupId}:{}),...(type==='endnote'?{role:'endnote',purpose:'explanation'}:{})})];
   if(reuse){index=anchor;items[0].id=original.id;if(type==='figure')items[1].targetId=original.id;}
   const blocks=[...n.blocks];blocks.splice(index,reuse?1:0,...items);focus=items[0].id;return {blocks,groups:[...n.groups,...(type==='section'||type==='figure'?[{id,kind:type} as NoteGroup]:[])]};});setInsert(null);focusNote(editor!,focus);
 }
 function select(id:string,event:ReactMouseEvent){
  const n=readNotebook(editor!.state.doc),ids=selectedUnitIds(n,[id]);let next=ids;
  if(event.shiftKey&&selectionAnchor.current){const from=n.blocks.findIndex(b=>b.id===selectionAnchor.current),to=n.blocks.findIndex(b=>b.id===id);next=selectedUnitIds(n,n.blocks.slice(Math.min(from,to),Math.max(from,to)+1).map(b=>b.id));}
  else if(event.ctrlKey||event.metaKey){next=ids.every(x=>selected.includes(x))?selected.filter(x=>!ids.includes(x)):[...new Set([...selected,...ids])];}
  if(!event.shiftKey)selectionAnchor.current=id;setSelected(next);setBlockError('');host.current?.focus({preventScroll:true});
 }
 function insertAt(id?:string,before=false){
  if(p.disabled)return;let fresh='';editNotes(editor!,n=>{const anchor=n.blocks.findIndex(b=>b.id===id),original=n.blocks[anchor];let index=anchor<0?n.blocks.length:anchor+(before?0:1);const figure=notebookMoveUnits(n).find(u=>u.some(b=>b.id===id)&&u.some(b=>b.type==='image'));
   if(figure)index=n.blocks.findIndex(b=>b.id===(before?figure[0].id:figure.at(-1)!.id))+(before?0:1);
   const groupId=!figure?original?.groupId:undefined,b=newNote('paragraph',{...(groupId?{groupId}:{})});fresh=b.id;return {...n,blocks:[...n.blocks.slice(0,index),b,...n.blocks.slice(index)]};});setSelected([]);openInsert(fresh);
  requestAnimationFrame(()=>{const row=host.current?.querySelector<HTMLElement>('[data-block-id="'+fresh+'"]');if(row&&host.current)setInsert(v=>v?.id===fresh?{...v,top:row.getBoundingClientRect().top-host.current!.getBoundingClientRect().top+32}:v);});
 }
 function pastePayload(payload:ReturnType<typeof copyBlocks>){const n=readNotebook(editor!.state.doc),after=selected.at(-1)||activeNote?.id,result=pasteBlocks(n,payload,after,p.sources||[]);pasteSources.current=result.sources;editNotes(editor!,()=>result.note);setSelected(result.ids);host.current?.focus({preventScroll:true});}
 const controls:Controls={props:p,editor,openInsert,insertAt,insertingId:insert?.id,convert,drag,select,selected};
 const items=INSERTS.filter(item=>(item.label+' '+item.hint).toLowerCase().includes(query.toLowerCase()));
 const formatButton=(label:string,text:ReactNode,pressed:boolean,action:()=>void,disabled=!editable)=><button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={action}>{text}</button>;
 const inlineTools=<>{formatButton(tr('加粗 ⌘B'),<Icon name="bold"/>,editor.isActive('bold'),()=>editor.chain().focus().toggleBold().run())}{formatButton(tr('斜体 ⌘I'),<Icon name="italic"/>,editor.isActive('italic'),()=>editor.chain().focus().toggleItalic().run())}{formatButton(tr('链接'),<Icon name="link"/>,editor.isActive('link'),()=>{setLink(editor.getAttributes('link').href||'');setLinkError('');})}{formatButton(tr('行内代码'),<Icon name="code"/>,editor.isActive('code'),()=>editor.chain().focus().toggleCode().run())}{formatButton(tr('清除文字格式'),<Icon name="format-clear"/>,false,()=>editor.chain().focus().unsetAllMarks().run())}</>;
 const selectionText=!editor.state.selection.empty&&editable&&editor.isFocused;
 let selectionTop=48;try{if(selectionText&&host.current)selectionTop=Math.max((host.current.querySelector('.notebook-editor-toolbar')?.clientHeight||40)+8,editor.view.coordsAtPos(editor.state.selection.from).top-host.current.getBoundingClientRect().top-40);}catch{/* Layout is unavailable in headless DOM tests. */}
 function saveLink(){const url=(link||'').trim();if(url&&!/^(https?:\/\/|mailto:)/i.test(url)){setLinkError(tr('请填写 http、https 或 mailto 链接'));return;}if(url)editor!.chain().focus().extendMarkRange('link').setLink({href:url}).run();else editor!.chain().focus().extendMarkRange('link').unsetLink().run();setLink(null);}
 return <Context.Provider value={controls}><div className={"notebook-document"+(drag.state?" is-sorting":"")} ref={host} tabIndex={-1} aria-label={tr("内容块操作区")} onFocusCapture={e=>{const element=e.target as HTMLElement;if(element!==host.current&&(element.matches('input,textarea,select,[contenteditable=true]')||element.closest('.notebook-rich-content')))setSelected([]);}} onPointerDownCapture={e=>{if((e.target as HTMLElement).closest('.notebook-row-content,input,textarea,select'))setSelected([]);}}
  onKeyDownCapture={e=>{if(e.nativeEvent.isComposing||editor.view.composing)return;if(e.key==='Escape'){setInsert(null);setLink(null);setSelected([]);return;}if(p.disabled)return;const target=e.target as HTMLElement;const historyKey=(e.metaKey||e.ctrlKey)&&(e.key.toLowerCase()==='z'||e.key.toLowerCase()==='y');if(historyKey&&!target.matches('input,textarea:not([data-row-id])')){e.preventDefault();e.stopPropagation();if(e.shiftKey||e.key.toLowerCase()==='y')editor.commands.redo();else editor.commands.undo();setSelected([]);return;}if(e.target!==host.current&&!target.closest('.notebook-drag-handle'))return;if(!selected.length)return;
   const key=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&key==='d'){e.preventDefault();e.stopPropagation();pastePayload(copyBlocks(readNotebook(editor.state.doc),selected,p.sources));}
   else if((e.ctrlKey||e.metaKey)&&key==='a'){e.preventDefault();setSelected(readNotebook(editor.state.doc).blocks.map(b=>b.id));}
   else if(!e.ctrlKey&&!e.metaKey&&['Backspace','Delete'].includes(e.key)){e.preventDefault();e.stopPropagation();editNotes(editor,n=>removeBlocks(n,selected));setSelected([]);}
  }}
  onCopyCapture={e=>{if(!selected.length)return;const payload=copyBlocks(readNotebook(editor.state.doc),selected,p.sources);e.preventDefault();e.stopPropagation();e.clipboardData.setData(BLOCK_CLIPBOARD,JSON.stringify(payload));e.clipboardData.setData('text/plain',payload.blocks.map(b=>b.type==='heading'?'#'.repeat(b.level||2)+' '+b.text:b.text||b.requirement||'').join('\n\n'));}}
  onCutCapture={e=>{if(!selected.length||p.disabled)return;const payload=copyBlocks(readNotebook(editor.state.doc),selected,p.sources);e.preventDefault();e.stopPropagation();e.clipboardData.setData(BLOCK_CLIPBOARD,JSON.stringify(payload));e.clipboardData.setData('text/plain',payload.blocks.map(b=>b.text||b.requirement||'').join('\n\n'));editNotes(editor,n=>removeBlocks(n,selected));setSelected([]);}}
  onPasteCapture={e=>{if(p.disabled)return;const raw=e.clipboardData.getData(BLOCK_CLIPBOARD),plain=e.clipboardData.getData('text/plain');if(!raw&&(!selected.length||!plain))return;const target=e.target as HTMLElement;if(target.matches('input,textarea')||target.closest('.notebook-requirement'))return;e.preventDefault();e.stopPropagation();try{pastePayload(raw?parseBlockClipboard(raw):{version:1,blocks:[newNote('paragraph',{text:plain,state:'ready',locked:true})],groups:[],sources:[]});setBlockError('');}catch(error){setBlockError(String(error));}}}>
  {blockError&&<p role="alert">{blockError}</p>}
  <div className="notebook-editor-toolbar" role="toolbar" aria-label={tr("正文编辑工具栏")}>
   <div className="notebook-history-tools" role="group" aria-label={tr("编辑历史")}>
    <button type="button" aria-label={tr("撤销")} title={tr("撤销 · ⌘Z / Ctrl+Z")} disabled={p.disabled||!editor.can().undo()} onMouseDown={e=>e.preventDefault()} onClick={()=>{editor.chain().focus().undo().run();setSelected([]);}}><Icon name="undo"/></button>
    <button type="button" aria-label={tr("重做")} title={tr("重做 · ⇧⌘Z / Ctrl+Shift+Z")} disabled={p.disabled||!editor.can().redo()} onMouseDown={e=>e.preventDefault()} onClick={()=>{editor.chain().focus().redo().run();setSelected([]);}}><Icon name="redo"/></button>
   </div><span className="notebook-toolbar-divider"/>
   <select aria-label={tr("段落类型")} disabled={!editable||activeNote?.type==='annotation'} value={activeNote?.type==='heading'?'h'+activeNote.level:'paragraph'} onChange={e=>activeNote&&convert(activeNote.id,e.target.value)}><option value="paragraph">{tr("正文")}</option>{[1,2,3,...((activeNote?.level||0)>3?[activeNote!.level!]:[])].map(level=><option key={level} value={'h'+level}>{tr("标题 {{level}}", {level})}</option>)}</select>
   {inlineTools}<span className="notebook-toolbar-divider"/>
   {formatButton(tr('无序列表'),<Icon name="list"/>,editor.isActive('bulletList'),()=>editor.chain().focus().toggleBulletList().run())}
   {formatButton(tr('有序列表'),<Icon name="list-ordered"/>,editor.isActive('orderedList'),()=>editor.chain().focus().toggleOrderedList().run())}
   {formatButton(tr('引用'),<Icon name="quote"/>,editor.isActive('blockquote'),()=>editor.chain().focus().toggleBlockquote().run())}
   {formatButton(tr('代码块'),tr('代码'),editor.isActive('codeBlock'),()=>editor.chain().focus().toggleCodeBlock().run())}
   <span className="notebook-toolbar-divider"/><button disabled={p.disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>openInsert(activeNote?.id)} className="notebook-insert-button"><Icon name="plus" size={14}/>{tr("插入")}</button>
  </div>
  {selectionText&&link===null&&<div className="notebook-selection-toolbar" style={{top:selectionTop}} role="toolbar" aria-label={tr("选中文字工具栏")} onMouseDown={e=>e.preventDefault()}>{inlineTools}</div>}
  {link!==null&&<form ref={linkRef} className="notebook-link-popover" onSubmit={e=>{e.preventDefault();saveLink();}}><label>{tr("链接地址")}<input autoFocus aria-label={tr("链接地址")} value={link} placeholder="https://" onChange={e=>setLink(e.target.value)}/></label>{linkError&&<small role="alert">{linkError}</small>}<button type="submit">{tr("应用链接")}</button>{editor.isActive("link")&&<button type="button" onClick={()=>{editor.chain().focus().extendMarkRange("link").unsetLink().run();setLink(null);}}>{tr("移除链接")}</button>}<button type="button" onClick={()=>setLink(null)}>{tr("取消")}</button></form>}
  {drag.state&&<div className="notebook-drag-status" role="status">{tr("{{value}} · Esc 取消", {value: drag.state.deleting?tr('松开删除'):drag.state.ids.length>1?tr('移动整组 · {{count}} 行',{count:drag.state.ids.length}):tr('移动内容行')})}</div>}
  {selected.length>0&&<div className="notebook-block-selection-status" role="status">{tr("已选 {{selected}} 块 · Ctrl/Cmd＋D 复制 · Backspace 删除 · Ctrl/Cmd＋X/C/V 剪切、复制、粘贴", {selected: selected.length})}</div>}
  {drag.state&&host.current&&createPortal(<div ref={trashRef} className={'notebook-drag-trash'+(drag.state.deleting?' is-over':'')} style={(()=>{const r=(host.current!.closest('.notebook-paper')||host.current!).getBoundingClientRect();return {position:'fixed' as const,left:r.left+16,top:Math.min(r.bottom,window.innerHeight)-70,width:Math.max(120,r.width-32)};})()} role="status"><Icon name="trash" size={18}/>{drag.state.deleting?tr("松开删除"):tr("拖到这里删除")}</div>,document.body)}
  <EditorContent editor={editor}/>
  {!p.disabled&&<footer className="notebook-document-footer"><button className="notebook-add-content" onClick={()=>openInsert()}>{tr("＋ 添加内容")} <kbd>/</kbd></button><small>{tr("左侧 ⠿ 选中或拖动 · 行间 ＋ 插入 · 右侧 ⋯ 内容块操作")}</small></footer>}
  {insert&&<div ref={insertRef} className="notebook-insert-popover" style={{top:insert.top}} role="dialog" aria-label={tr("插入内容")}><input autoFocus role="combobox" aria-label={tr("搜索插入类型")} aria-expanded="true" aria-controls="notebook-insert-results" aria-activedescendant={items.length?'notebook-option-'+Math.min(choice,items.length-1):undefined} placeholder={tr("搜索内容类型…")} value={query} onChange={e=>{setQuery(e.target.value);setChoice(0);}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setChoice(v=>Math.max(0,Math.min(items.length-1,v+(e.key==='ArrowDown'?1:-1))));}if(e.key==='Enter'&&items.length){e.preventDefault();const selected=items[Math.min(choice,items.length-1)];add(selected.type,selected.level);}if(e.key==='Escape'){e.preventDefault();setInsert(null);if(insert.id)focusNote(editor,insert.id);}}}/><div id="notebook-insert-results" className="notebook-insert-options" role="listbox" aria-label={tr("插入内容类型")}>{items.map((item,index)=><button id={'notebook-option-'+index} role="option" aria-selected={index===choice} key={item.type+(item.level||'')} onClick={()=>add(item.type,item.level)}>{tr(item.label)}<small>{tr(item.hint)}</small></button>)}{!items.length&&<small>{tr("没有匹配的内容类型")}</small>}</div></div>}
 </div></Context.Provider>;
}
