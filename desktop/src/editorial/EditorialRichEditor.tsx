import NotebookInternalNotes from './NotebookInternalNotes';
import {restorePrivateEditorial,appendInternalNotes,type PrivateEditorialData} from '../../../contracts/article-internal-notes.mjs';
import {useEffect,useMemo,useRef,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import NotebookBlockEditor from './NotebookBlockEditor';
import {editorialImageReferences,lockedHeadings} from './editorialRichMarkdown';
import {manuscriptBlocks} from './manuscriptBlocks';
import type {NoteBlock,NoteGroup} from '../../scripts/agent/notebook.mjs';
import './editorial-rich.css';

import { tr } from "../uiText";
type Props={articleId:string;text:string;disabled:boolean;lockedHeadings?:string[];onChange:(text:string)=>void;onError?:(message:string)=>void};
/** Markdown is the file boundary; all visual editing uses the notebook's block editor. */
export default function EditorialRichEditor({articleId,text,disabled,onChange,onError,lockedHeadings:fixed=[]}:Props){
 const initial=useMemo(()=>manuscriptBlocks(text),[articleId]);
 const adapter=useRef(initial),echo=useRef(text),callbacks=useRef({onChange,onError});callbacks.current={onChange,onError};
 const [privateData,setPrivateData]=useState<PrivateEditorialData|null>(null);
 const [blocks,setBlocks]=useState(initial.blocks),[groups,setGroups]=useState<NoteGroup[]>([]);
 const [imageSources,setImageSources]=useState<Record<string,string|null>>({}),[warning,setWarning]=useState(''),[notesError,setNotesError]=useState('');
 const [imageId,setImageId]=useState<string|null>(null),[address,setAddress]=useState(''),[alt,setAlt]=useState(''),[imageError,setImageError]=useState('');
 const extensions=useMemo(()=>fixed.length?[lockedHeadings(fixed,label=>queueMicrotask(()=>callbacks.current.onError?.(tr("“{{label}}”是固定章节，对应官网字段，不能改名、删除或重复。", {label}))))]:[],[JSON.stringify(fixed)]);
 useEffect(()=>{
  if(text===echo.current)return;
  adapter.current=manuscriptBlocks(text);echo.current=text;setBlocks(adapter.current.blocks);setGroups([]);setPrivateData(data=>data?restorePrivateEditorial(adapter.current,data):null);
 },[text]);
 useEffect(()=>{
  let obsolete=false;setPrivateData(null);setNotesError('');
  void invoke<PrivateEditorialData|null>('editorial_call',{method:'draft_private_notes',params:{id:articleId}}).then(data=>{if(!obsolete&&data)setPrivateData(restorePrivateEditorial(adapter.current,data));}).catch(error=>{if(!obsolete&&!/Article not found/.test(String(error)))setNotesError(tr('内部备注读取失败：{{error}}',{error:String(error)}));});
  return()=>{obsolete=true;};
 },[articleId]);
 const rowNotes=(b:NoteBlock,index:number)=><NotebookInternalNotes label={tr(index===0?'作者备注':'行间备注')} notes={appendInternalNotes(index===0?privateData?.internalNotes:{},privateData?.blockNotes?.[b.id]?.notes||{})} signatures={index===0?privateData?.modelSignatures:undefined} unplaced={index===0?Object.fromEntries(Object.entries(privateData?.blockNotes||{}).filter(([id])=>!blocks.some(b=>b.id===id))):undefined}/>;
 const imageKey=JSON.stringify(editorialImageReferences(text));
 useEffect(()=>{
  let obsolete=false;const local=(JSON.parse(imageKey) as string[]).filter(src=>!/^https?:\/\//i.test(src));
  if(!local.length){setImageSources({});setWarning('');return;}
  void invoke<{imageSources?:Record<string,string|null>;warnings?:string[]}>('editorial_call',{method:'draft_preview',params:{id:articleId,markdown:local.map(src=>`![image](<${src}>)`).join('\n\n'),embedImages:true,includeImageSources:true}})
   .then(result=>{if(!obsolete){setImageSources(result.imageSources||{});setWarning((result.warnings||[]).join('；'));}})
   .catch(error=>{if(!obsolete)setWarning(tr("图片预览失败：{{error}}", {error: String(error)}));});
  return()=>{obsolete=true;};
 },[articleId,imageKey]);
 function change(next:NoteBlock[],nextGroups:NoteGroup[]=[]){
  setBlocks(next);setGroups(nextGroups);const value=adapter.current.serialize(next);echo.current=value;callbacks.current.onChange(value);
 }
 function editImage(id:string){const b=blocks.find(b=>b.id===id);setImageId(id);setAddress(b?.text||'');setAlt(b?.alt||'');setImageError('');}
 return <div className="manuscript-notebook">
  {/* Private notes are optional: a failed read is noted here, never a blocking dialog. */}
  {notesError&&<p role="status" className="editor-notes-error" title={notesError}>{notesError}</p>}
  {warning&&<p role="status">{warning}</p>}
  {imageId&&<form className="editorial-rich-insert" onSubmit={event=>{
   event.preventDefault();const value=address.trim();
   if(!value||/[\r\n<>\\]/.test(value)||value.startsWith('/')||(/^[a-z][a-z\d+.-]*:/i.test(value)&&!/^https?:\/\//i.test(value))){setImageError(tr('请输入稿件内图片的相对路径或 http(s) 图片网址。'));return;}
   change(blocks.map(b=>b.id===imageId?{...b,text:value,alt,state:'ready',locked:true}:b),groups);setImageId(null);
  }}><label>{tr("图片路径或网址")}<input autoFocus value={address} onChange={e=>setAddress(e.target.value)} placeholder={tr("assets/配图.png 或 https://…")}/></label><label>{tr("图片说明")}<input value={alt} onChange={e=>setAlt(e.target.value)}/></label><button disabled={disabled} type="submit">{tr("应用图片")}</button><button type="button" onClick={()=>setImageId(null)}>{tr("取消")}</button>{imageError&&<span role="alert">{imageError}</span>}</form>}
  <NotebookBlockEditor renderAside={rowNotes} blocks={blocks} groups={groups} extensions={extensions} disabled={disabled} labels={{}} onChange={change}
   imageMethods={[{method:'local',label:tr("设置图片路径或网址")}]} onImage={editImage}
   renderImage={b=>{const src=/^https?:\/\//i.test(b.text)?b.text:imageSources[b.text];return src?<img src={src} alt={b.alt||''}/>:<span>{tr("图片：{{text}}", {text: b.text})}</span>;}}/>
 </div>;
}
