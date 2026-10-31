import {useEffect,useRef,useState} from 'react';
import type {CompletionCheck,CompletionTarget} from '../../scripts/agent/notebook-completion.mjs';
import Icon from '../components/Icon';
import {useDismiss} from '../hooks/useDismiss';

import { tr } from "../uiText";
export default function NotebookCompletionButton({checks,checking,busy,completed,failed,onComplete,onLocate,onReopen,onOpen}:{checks:CompletionCheck[];checking:boolean;busy:boolean;completed:boolean;failed?:boolean;onComplete:()=>void;onLocate:(target:CompletionTarget)=>void;onReopen:()=>void;onOpen:()=>void}){
 const [open,setOpen]=useState(false),host=useRef<HTMLDivElement>(null),closeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const ready=checks.every(check=>check.ok)&&!checking,state=completed?'saved':busy?'busy':checking?'checking':!ready?'pending':failed?'retry':'ready';
 const label=tr(({saved:'成稿已完成',busy:'正在完成文章',checking:'正在检查文章',pending:'查看待处理项',retry:'重试完成文章',ready:'AI 完成文章并保存'})[state]);
 useDismiss(host,()=>setOpen(false),{enabled:open,onFocusOut:true});
 useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
 return <div ref={host} className={'notebook-completion is-'+state} onMouseEnter={()=>{clearTimeout(closeTimer.current);setOpen(true);}} onMouseLeave={()=>{closeTimer.current=setTimeout(()=>{if(!host.current?.contains(document.activeElement))setOpen(false);},160);}}>
  <button type="button" className="notebook-completion-button" aria-label={label} aria-expanded={open} aria-haspopup="dialog" onFocus={()=>setOpen(true)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);requestAnimationFrame(()=>host.current?.querySelector<HTMLButtonElement>('.notebook-completion-popover button')?.focus());}}} onClick={()=>{if(completed)onOpen();else if(ready&&!busy){setOpen(false);onComplete();}else setOpen(true);}}><Icon name={completed?'check-all':busy||checking?'refresh':ready?'sparkle':'check'} size={20}/></button>
  {open&&<div className="notebook-completion-popover" role="dialog" aria-label={tr("文章完成检查")}><header><strong>{label}</strong><small>{completed?tr("已保存到作品库"):busy?tr("正在补全占位并整理子标题"):checking?tr("正在核对最新草稿"):ready?tr("点击图标，补全占位、整理子标题并保存"):tr("处理以下项目后即可开始")}</small></header>
   {completed?<><button onClick={()=>{setOpen(false);onOpen();}}>{tr("在作品库查看")}<Icon name="open" size={14}/></button><button disabled={busy} onClick={()=>{setOpen(false);onReopen();}}>{tr("继续写作")}<Icon name="text" size={14}/></button></>:<ul>{checks.map(check=><li key={check.id} className={check.ok?'is-passed':'is-pending'}><Icon name={check.ok?'check':'circle'} size={14}/><span>{check.label}</span><button type="button" aria-label={tr("定位：{{label}}", {label: check.label})} onClick={()=>{setOpen(false);onLocate(check.target);}}>{check.ok?tr("查看"):tr("去处理")}<Icon name="chevron-right" size={12}/></button></li>)}</ul>}
  </div>}
 </div>;
}
