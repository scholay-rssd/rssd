import {useState} from 'react';
import {writingTaskLabel} from '../../scripts/agent/notebook.mjs';
import EditorialIcon from './EditorialIcon';
import {TASK_MODES,type WorkbenchTask,type TaskRunState} from './taskWorkbench';

import { tr, trKey } from "../uiText";
export function taskStatus(t:WorkbenchTask,r:TaskRunState={}){
 if(t.completedAt)return trKey('已结束 · 完成');
 if(t.delivery?.destination==='cloud'&&t.delivery.phase==='retiring')return trKey('交稿 · 回收中');
 if(t.delivery?.destination==='cloud'&&t.delivery.phase==='cleanup_blocked')return trKey('交稿 · 待回收');
 const phase=t.notebook?trKey('写作'):t.mode==='image'?trKey('配图'):({topic:trKey('选题'),outline:trKey('生成'),draft:trKey('编辑'),review:trKey('编辑'),deliver:trKey('交稿')} as Record<string,string>)[t.stage]||trKey('编辑');
 const status=r.status||t.runtime?.status||'',result=t.runtime?.lastRunStatus||t.runtime?.status;
 const state=r.pending?trKey('等你确认'):r.queued?trKey('排队中'):r.busy?trKey('执行中'):t.runtime?.busy&&!r.status?trKey('上次执行已中断'):/异常|失败|error|超时|中断|断开/i.test(status)?trKey('异常'):!t.notebook&&!['image','legacy'].includes(t.mode)&&((t.board.sections.length&&!t.topicConfirmed)||(t.outline.blocks.length&&!t.outlineConfirmed))?trKey('等你确认'):status==='已停止'||result==='已停止'?trKey('已停止'):status==='已完成'||result==='已完成'?(t.workIds.includes(t.articleId)?trKey('待交稿'):t.mode==='image'?trKey('完成'):trKey('待继续')):/异常|失败|error|超时|中断|断开/i.test(result||'')?trKey('异常'):trKey('待继续');
 return phase+' · '+state;
}
// Status text stays Chinese for matching; split parts translate for display.
const statusText=(label:string)=>label.split(' · ').map(part=>tr(part)).join(' · ');
function StatusIcon({label}:{label:string}){
 const status=label.split(' · ').at(-1),running=status==='执行中'||status==='回收中';
 const paths:Record<string,string>={完成:'m4 10 4 4 8-8',已停止:'M6 6h8v8H6z',等你确认:'M10 5v6M10 14h.01',排队中:'M10 5v5l3 2',异常:'m6 6 8 8M6 14l8-8',待继续:'m8 6 6 4-6 4z',待交稿:'m8 6 6 4-6 4z',待回收:'M10 5v6M10 14h.01'};
 return <span className={'task-state-icon'+(running?' is-running':'')} data-status={status} role="img" aria-label={statusText(label)} title={statusText(label)}>{running?<i className="cursor-spinner"/>:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="8"/><path d={paths[status||'']||paths.异常}/></svg>}</span>;
}
export default function TaskHistoryList({tasks,runs,selected,onSelect,onManage}:{tasks:WorkbenchTask[];runs:Record<string,TaskRunState>;selected:string;onSelect:(id:string)=>void;onManage:(id:string)=>void}){
 return <>{tasks.map(t=><div className={'task-history-row'+(t.id===selected?' is-selected':'')} key={t.id}><button className="task-history-item" title={`${t.title}\n${tr(writingTaskLabel(t)||TASK_MODES[t.mode])} · ${statusText(taskStatus(t,runs[t.id]))}`} aria-current={t.id===selected?'true':undefined} onClick={()=>onSelect(t.id)}><StatusIcon label={taskStatus(t,runs[t.id])}/><strong>{t.pinned?'• ':''}{t.title}</strong></button><button className="task-row-menu" aria-label={tr("任务操作：{{title}}", {title: t.title})} onClick={()=>onManage(t.id)}><EditorialIcon name="more"/></button></div>)}</>;
}
export function TaskActions({task,busy,onClose,onSave,onDelete,onFinish}:{task:WorkbenchTask;busy:boolean;onClose:()=>void;onSave:(patch:object)=>Promise<void>;onDelete:()=>Promise<void>;onFinish:()=>Promise<void>}){
 const [working,setWorking]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
 async function apply(action:()=>Promise<void>){if(working)return;setWorking(true);setError('');try{await action();onClose();}catch(e){setError(String(e));}finally{setWorking(false);}}
 return <div className="task-modal-backdrop" onKeyDown={e=>{if(e.key==='Escape'&&!working)onClose();}}><form className="task-new-dialog task-actions-dialog" role="dialog" aria-label={tr("任务操作")} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void apply(()=>onSave({title:String(data.get('title')),...(!task.completedAt?{brief:String(data.get('brief')),days:Number(data.get('days'))}:{})}));}}><header><h2>{confirm?tr("删除任务"):tr("任务设置")}</h2><button type="button" aria-label={tr("关闭任务操作")} disabled={working} onClick={onClose}>×</button></header>{confirm?<><p>{tr("删除“{{title}}”及其执行记录？关联稿件和图片会保留。", {title: task.title})}</p><footer><button type="button" disabled={working} onClick={()=>setConfirm(false)}>{tr("取消")}</button><button type="button" disabled={working||busy} onClick={()=>void apply(onDelete)}>{tr("确认删除")}</button></footer></>:<><label>{tr("名称")}<input name="title" aria-label={tr("重命名任务")} defaultValue={task.title} maxLength={120} required autoFocus/></label><label>{tr("要求")}<textarea name="brief" aria-label={tr("调整任务要求")} defaultValue={task.brief} disabled={!!task.completedAt}/></label><label>{tr("素材范围（天）")}<input name="days" type="number" min="1" max="365" defaultValue={task.days||30} disabled={!!task.completedAt}/></label><footer>{!task.completedAt&&<button type="button" disabled={working||busy} onClick={()=>void apply(onFinish)}>{tr("结束对话")}</button>}<button type="button" disabled={working} onClick={()=>void apply(()=>onSave({pinned:!task.pinned}))}>{task.pinned?tr("取消置顶"):tr("置顶")}</button><button type="button" disabled={working||busy} title={busy?tr("请先停止任务"):undefined} onClick={()=>setConfirm(true)}>{tr("删除")}</button><button className="task-primary" disabled={working||busy}>{tr("保存")}</button></footer></>}{error&&<p role="alert">{error}</p>}</form></div>;
}
