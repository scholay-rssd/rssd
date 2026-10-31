import NotebookInternalNotes from './NotebookInternalNotes';
import type {NotebookTurn,TurnContext} from './notebookTurns';
import type {NoteSource} from '../../scripts/agent/notebook.mjs';
import Icon from '../components/Icon';
import { tr } from "../uiText";
export function TurnMounts({context}:{context:TurnContext}){
 const names=[...(context.files||[]).map(f=>f.name),context.template?.name,context.titleTemplate?.name,...context.skills.map(s=>s.name),...context.brands.map(b=>b.name),...context.sources.map(s=>s.title),context.webEnabled?tr('联网搜索'):null].filter(Boolean);
 return names.length?<div className="notebook-turn-mounts" aria-label={tr("此轮挂载")}>{names.map((name,i)=><span key={i} title={name!}>{name}</span>)}</div>:null;
}
export default function NotebookTurnResults({turn,disabled,onAccept,onMount,onOpen}:{turn:NotebookTurn;disabled:boolean;onAccept:(ids?:string[])=>void;onMount:(source:NoteSource)=>void;onOpen:(url:string,title:string)=>void}){
 const remaining=turn.items.filter(i=>!i.accepted);
 return <section className="notebook-turn-results" aria-label={tr("本轮生成结果")}>
  {!!turn.items.length&&<header><strong>{turn.status==='interrupted'?tr("已中断 · 已生成的内容"):tr("本轮候选")}</strong><button disabled={disabled||!remaining.length} onClick={()=>onAccept()}>{remaining.length?tr("全部接受"):tr("已接受")}</button></header>}
  {turn.items.map(item=><article className={'notebook-proposal'+(item.kind==='internal'?' notebook-private-proposal':'')} key={item.id}><header><span>{item.kind==='title'?tr("标题"):item.label}{item.kind==='internal'&&<NotebookInternalNotes notes={{[item.field||'other']:item.noteText||''}} label={tr(item.blockId?'行间备注':'作者备注')}/>}</span><button disabled={disabled||item.accepted} onClick={()=>onAccept([item.id])}>{item.accepted?<><Icon name="check" size={12}/>{tr("已接受")}</>:tr("接受")}</button></header><div>{item.kind==='internal'?null:item.kind==='title'?item.label:item.kind==='source'?<><a href={item.source!.url}>{item.label}</a><p>{item.source!.summary}</p></>:item.kind==='fields'?<><p>{({article:tr('文章'),year:tr('日历事项'),history:tr('历史记录'),openSource:tr('资源介绍')} as Record<string,string>)[item.after?.kind||'article']}</p>{Object.entries(item.after?.fields||{}).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([key,value])=><p key={key}>{({date:tr('日期'),start:tr('开始日期'),year:tr('年份'),dateKey:tr('日期'),url:tr('链接'),category:tr('分类'),sourceName:tr('来源'),sourceUrl:tr('来源链接'),domain:tr('领域'),eventType:tr('事项类型')} as Record<string,string>)[key]||key}：{String(value)}</p>)}</>:item.blocks?.map(b=><p key={b.id}>{b.type==='image'?tr("配图 · {{value}}", {value: (b.alt||b.caption||'')}):b.text}</p>)}</div></article>)}
  {!!turn.sources?.length&&<details className="notebook-result-sources"><summary>{tr("参考资料 · {{sources}}", {sources: turn.sources.length})}</summary>{turn.sources.map(source=><article key={source.id}><a href={source.url} onClick={e=>{e.preventDefault();onOpen(source.url,source.title);}}>{source.title}</a><p>{source.summary}</p><button disabled={disabled} onClick={()=>onMount(source)}>{tr("用于本轮")}</button></article>)}</details>}
 </section>;
}
