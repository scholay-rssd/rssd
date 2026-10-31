import {useRef,useState} from 'react';
import Icon from '../components/Icon';
import {WRITING_SKILLS} from '../../scripts/agent/notebook.mjs';
import {TASK_MODES,type TaskMode} from './taskWorkbench';
import {TASK_TYPES,TASK_TYPE_IDS} from '../../scripts/agent/task-types.mjs';

import { tr, trKey } from "../uiText";
const SKILLS=[
 ['essay','text',trKey('记录经历与观点，展开自己的思考')],
 ['documentation','file',trKey('说明使用方法、操作步骤与验证结果')],
 ['design','image',trKey('呈现项目背景、设计过程与作品')],
 ['encyclopedia','globe',trKey('梳理概念、特征与可靠来源')],
] as const;
const ENTRIES=TASK_TYPE_IDS.map(mode=>({mode,description:TASK_TYPES[mode].description,path:TASK_TYPES[mode].icon}));

export default function TaskStartCards({onCreate,onStart,pending}:{onCreate:(mode:TaskMode,skill?:string)=>void;onStart:(text:string)=>Promise<void>;pending?:TaskMode|null}){
 const [message,setMessage]=useState(''),[sending,setSending]=useState(false),submitting=useRef(false);
 const disabled=!!pending||sending;
 async function send(){
  const text=message.trim();if(!text||text.length>8000||disabled||submitting.current)return;
  submitting.current=true;setSending(true);
  try{await onStart(text);}finally{submitting.current=false;setSending(false);}
 }
 return <section className="task-start" aria-label={tr("新建对话入口")} aria-busy={disabled}>
  <header><h1>{tr("开始新的创作")}</h1><p>{tr("选择一种写法，或在下方说说你想写什么")}</p></header>
  <div className="task-start-grid">{SKILLS.map(([id,icon,description])=><button type="button" className="task-start-card" key={id} disabled={disabled} onClick={()=>onCreate('observation',id)}><span className="task-start-icon"><Icon name={icon} size={17}/></span><strong>{tr(WRITING_SKILLS[id].name)}</strong><span className="task-start-description">{tr(description)}</span><span className="task-start-arrow" aria-hidden="true">↗</span></button>)}{ENTRIES.map(({mode,description,path})=><button key={mode} type="button" className="task-start-card" aria-label={tr("新建{{TASK_MODES}}", {TASK_MODES: tr(TASK_MODES[mode])})} disabled={disabled} onClick={()=>onCreate(mode)}>
   <span className="task-start-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path}/></svg></span>
   <strong>{tr(TASK_MODES[mode])}</strong><span className="task-start-description">{tr(description)}</span><span className="task-start-arrow" aria-hidden="true">↗</span>
  </button>)}</div>
  <form className="task-start-composer" onSubmit={e=>{e.preventDefault();void send();}}>
   <label htmlFor="task-start-message">{tr("直接开始")}</label>
   <div className="task-start-composer-box">
    <textarea id="task-start-message" aria-label={tr("开始创作的要求")} aria-describedby="task-start-hint" placeholder={tr("说说你想写什么，或贴上已有的想法…")} maxLength={8000} value={message} disabled={disabled} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229){e.preventDefault();void send();}}}/>
    <footer><span id="task-start-hint">{tr("⌘ Enter 发送 · Enter 换行")}</span><button type="submit" className="task-primary" disabled={disabled||!message.trim()} aria-label={tr("发送并开始创作")} title={tr("发送并开始创作 · ⌘ Enter")}>{sending?<i className="cursor-spinner"/>:<Icon name="arrow-up" size={18}/>}</button></footer>
   </div>
  </form>
 </section>;
}
