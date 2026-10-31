import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {InternalNotes,ModelSignature,BlockInternalNotes} from '../../scripts/agent/notebook.mjs';
import {INTERNAL_NOTE_FIELDS} from '../../../contracts/article-internal-notes.mjs';
import Icon from '../components/Icon';
import {tr} from '../uiText';
import './notebook-internal-notes.css';

const actions:Record<string,string>={organize:'整理与写作',complete:'完成文章',revise:'改写',fill:'补全',research:'检索',image:'配图',title:'标题'};
const entries=(notes:InternalNotes)=>Object.entries(INTERNAL_NOTE_FIELDS).filter(([key])=>notes[key as keyof InternalNotes]?.trim()) as [keyof InternalNotes,string][];
type Props={notes?:InternalNotes;signatures?:ModelSignature[];unplaced?:BlockInternalNotes;disabled?:boolean;onChange?:(notes:InternalNotes)=>void;label?:string};
/** Private metadata lives outside the editable document and its clipboard. */
export default function NotebookInternalNotes({notes={},signatures=[],unplaced={},disabled=false,onChange,label=tr('作者备注')} : Props){
 const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[position,setPosition]=useState({left:12,top:12});
 const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),id=useId();
 const fields=entries(notes),orphans=Object.entries(unplaced).filter(([,entry])=>entries(entry.notes).length);
 const cancel=()=>clearTimeout(timer.current);
 const show=()=>{cancel();setOpen(true);};
 const hide=()=>{cancel();timer.current=setTimeout(()=>{if(!panel.current?.contains(document.activeElement)){setOpen(false);setEditing(false);}},150);};
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useLayoutEffect(()=>{
  if(!open||!trigger.current||!panel.current)return;
  const r=trigger.current.getBoundingClientRect(),h=panel.current.getBoundingClientRect().height,w=panel.current.getBoundingClientRect().width;
  setPosition({left:Math.max(12,Math.min(window.innerWidth-w-12,r.right-w)),top:Math.max(12,r.bottom+h+12>window.innerHeight?r.top-h-6:r.bottom+6)});
 },[open,editing,notes,signatures.length]);
 useEffect(()=>{
  if(!open)return;
  const inside=(target:EventTarget|null)=>target instanceof Node&&(trigger.current?.contains(target)||panel.current?.contains(target));
  const close=()=>{cancel();setOpen(false);setEditing(false);};
  const outside=(e:Event)=>{if(!inside(e.target))close();};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();trigger.current?.focus();close();}};
  const scroll=(e:Event)=>{if(!(e.target instanceof Node&&panel.current?.contains(e.target)))close();};
  document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape,true);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',close);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape,true);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',close);};
 },[open]);
 if(!fields.length&&!signatures.length&&!orphans.length&&!editing)return null;
 return <span className="notebook-private-marker" data-visibility="private" contentEditable={false}>
  <button type="button" className="notebook-private-trigger" ref={trigger} aria-label={label+' · '+tr('仅作者可见')} aria-expanded={open} aria-controls={open?id:undefined} aria-haspopup="dialog" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={show}><Icon name="eye-off" size={13}/></button>
  {open&&createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} className="notebook-private-popover" data-visibility="private" style={position} contentEditable={false} onMouseEnter={cancel} onMouseLeave={hide} onBlur={hide} onPointerDown={e=>e.stopPropagation()}>
   <header><strong>{label}</strong><small>{tr('仅作者可见 · 不对外展示')}</small>{onChange&&!disabled&&<button type="button" onClick={()=>{if(editing){setEditing(false);setOpen(false);}else setEditing(true);}}>{tr(editing?'完成':'编辑')}</button>}</header>
   {(editing?Object.entries(INTERNAL_NOTE_FIELDS) as [keyof InternalNotes,string][]:fields).map(([key,name])=><section className="notebook-private-field" key={key}><label htmlFor={id+key}>{tr(name)}</label>{editing?<textarea id={id+key} aria-label={tr(name)+' · '+tr('仅内部可见')} value={notes[key]||''} rows={3} maxLength={16000} disabled={disabled} onChange={e=>onChange?.({...notes,[key]:e.target.value})}/>:<p>{notes[key]}</p>}</section>)}
   {orphans.map(([key,entry])=><section className="notebook-private-field" key={key}><label>{tr('未定位的行间备注')}</label>{entry.anchor?.text&&<blockquote>{entry.anchor.text.slice(0,100)}</blockquote>}{entries(entry.notes).map(([field,name])=><p key={field}><small>{tr(name)} · </small>{entry.notes[field]}</p>)}</section>)}
   {!!signatures.length&&<details className="notebook-model-signatures" open={!fields.length&&!orphans.length}><summary>{tr('模型记录')} · {signatures.length}</summary>
    {signatures.map(s=><div className="notebook-model-row" key={s.runId}><strong>{/^(auto|default\[\])$/i.test(s.modelName||s.modelId||'')?tr('自动选择（具体模型未报告）'):s.modelName||s.modelId||tr('模型未报告')}</strong><span>{s.agentName} · {tr(actions[s.action]||s.action)} · {tr(s.status==='completed'?'已完成':s.status==='running'?'进行中':'已中断')}{s.device&&<> · {s.device}</>}</span><time dateTime={s.startedAt}>{new Date(s.startedAt).toLocaleString()}</time></div>)}
   </details>}
  </div>,document.body)}
 </span>;
}
