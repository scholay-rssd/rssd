// The permanent preview beside every production station. Whatever the station works on — chosen materials,
// outline blocks, the saved manuscript — is shown here in article form, with placeholders where nothing is
// written yet. Each previewed element mirrors one element of the station: removing it here removes it there.
import {useEffect,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import PrivateHtmlPreview from './PreviewInternalNotes';
import type {TopicBoard,WorkbenchTask} from './taskWorkbench';
import './article-preview.css';

import { tr, trKey } from "../uiText";
type Outline=WorkbenchTask['outline'];
const chosen=(item:TopicBoard['sections'][number]['items'][number])=>item.selected??!item.excluded;
const Lines=({count=3}:{count?:number})=><div className="preview-lines" aria-hidden="true">{Array.from({length:count},(_,i)=><i key={i}/>)}</div>;
function Remove({label,disabled,onClick}:{label:string;disabled:boolean;onClick:()=>void}){
 return <button type="button" className="preview-remove" aria-label={label} title={label} disabled={disabled} onClick={onClick}>×</button>;
}

/** Materials chosen on the topic station, laid out as the article they will become. The title is not decided yet. */
export function BoardPreview({board,disabled,loading,onRemove}:{board:TopicBoard;disabled:boolean;loading:boolean;onRemove:(sectionId:string,itemId:string)=>void}){
 const sections=board.sections.map(s=>({...s,chosen:s.items.filter(chosen),waiting:(s.slots||[]).filter(slot=>slot.mode==='smart'&&!s.items.some(i=>i.id===slot.id)).length})).filter(s=>s.chosen.length||s.waiting);
 const grouped=board.sections.length>1;
 return <div className="editorial-prose article-preview-body" data-stage="board">
  <h1 className="preview-pending" aria-label={tr("标题待定")}><Lines count={1}/></h1>
  {!sections.length&&<div className="preview-empty"><Lines count={4}/><p>{tr("选用素材后，文章内容会出现在这里。")}</p></div>}
  {sections.map(s=><section key={s.id} aria-label={s.title}>
   {grouped&&<h2>{s.title}</h2>}
   {s.chosen.map(item=><article key={item.id} className="preview-element" data-preview-id={item.id}>
    <Remove label={tr("从文章中移除：{{title}}", {title: item.title})} disabled={disabled} onClick={()=>onRemove(s.id,item.id)}/>
    <h3>{item.title}</h3><p>{item.summary}</p>{(item.publisher||item.date)&&<small>{[item.publisher,item.date].filter(Boolean).join(' · ')}</small>}
   </article>)}
   {Array.from({length:s.waiting},(_,i)=><div key={'waiting-'+i} className={'preview-element is-placeholder'+(loading?' is-filling':'')} aria-hidden="true"><Lines count={3}/></div>)}
  </section>)}
 </div>;
}

const BLOCK_LABELS:Record<string,string>={summary:trKey('摘要'),heading:trKey('小标题'),paragraph:trKey('段落'),image:trKey('插图'),references:trKey('参考资料'),product:trKey('产品信息'),signature:trKey('署名'),qrcode:trKey('二维码')};
/** Outline blocks in reading order. A block without text keeps its place as a placeholder. */
export function OutlinePreview({outline,titles,disabled,loading,onRemove}:{outline:Outline;titles:string[];disabled:boolean;loading:boolean;onRemove:(blockId:string)=>void}){
 const candidates=outline.titleCandidates||titles,title=outline.blocks.find(b=>b.type==='title')?.text||candidates[outline.selectedTitle??0]||'';
 const blocks=outline.blocks.filter(b=>b.type!=='title');
 return <div className="editorial-prose article-preview-body" data-stage="outline">
  {title?<h1>{title}</h1>:<h1 className="preview-pending" aria-label={tr("标题待定")}><Lines count={1}/></h1>}
  {!blocks.length&&<div className={'preview-empty'+(loading?' is-filling':'')}><Lines count={5}/><p>{loading?tr("正在编排内容块…"):tr("生成大纲后，文章结构会出现在这里。")}</p></div>}
  {blocks.map(b=>{const label=tr(BLOCK_LABELS[b.type]||b.type),text=b.text.trim();
   return <div key={b.id} className={'preview-element'+(text?'':' is-placeholder')} data-preview-id={b.id} data-type={b.type}>
    <Remove label={tr("删除{{label}}{{value}}", {label, value: (text?'：'+text.slice(0,24):'')})} disabled={disabled} onClick={()=>onRemove(b.id)}/>
    {b.type==='heading'?(text?<h2>{text}</h2>:<h2 className="preview-pending"><Lines count={1}/></h2>)
     :b.type==='summary'?(text?<blockquote>{text}</blockquote>:<Lines count={2}/>)
     :b.type==='image'?<figure className="preview-figure"><div aria-hidden="true">{tr("插图")}</div>{text&&<figcaption>{text}</figcaption>}</figure>
     :b.type==='paragraph'?(text?<p>{text}</p>:<Lines count={3}/>)
     :<div className="preview-module"><span>{label}</span>{text&&<p>{text}</p>}</div>}
   </div>;})}
 </div>;
}

/** The saved manuscript, rendered. It follows saves, not keystrokes. */
export function DraftPreview({articleId,version,onOpenUrl}:{articleId:string;version:unknown;onOpenUrl?:(url:string,title:string)=>void}){
 const [html,setHtml]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let stale=false;setError('');void invoke<{html:string}>('editorial_call',{method:'draft_preview',params:{id:articleId,embedImages:true}}).then(r=>{if(!stale)setHtml(r?.html||'');}).catch(e=>{if(!stale)setError(String(e));});return()=>{stale=true;};},[articleId,version]);
 if(error)return <div className="editorial-prose article-preview-body"><p className="preview-note" role="alert">{tr("预览暂不可用：{{error}}", {error})}</p></div>;
 if(!html)return <div className="editorial-prose article-preview-body"><div className="preview-empty is-filling"><Lines count={6}/></div></div>;
 return <PrivateHtmlPreview articleId={articleId} html={html} className="editorial-prose article-preview-body" data-stage="draft" onClick={e=>{const a=(e.target as Element).closest('a');if(!a)return;e.preventDefault();const href=a.getAttribute('href')||'';if(/^https?:\/\//i.test(href))onOpenUrl?.(href,a.textContent||tr('来源网页'));}}/>;
}

/** Nothing to show yet: the manuscript has not been generated. */
export function EmptyPreview({loading,text}:{loading:boolean;text:string}){
 return <div className="editorial-prose article-preview-body"><h1 className="preview-pending" aria-label={tr("标题待定")}><Lines count={1}/></h1><div className={'preview-empty'+(loading?' is-filling':'')}><Lines count={6}/><p>{text}</p></div></div>;
}
