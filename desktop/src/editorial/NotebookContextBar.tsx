import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import Icon,{type IconName} from '../components/Icon';

import { tr } from "../uiText";
export type ContextChip={id:string;name:string;description:string;icon:IconName;remove?:()=>void;open?:()=>void};
export default function NotebookContextBar({items,disabled,onConfigure}:{items:ContextChip[];disabled:boolean;onConfigure?:()=>void}){
 const hasConfiguration=!!onConfigure;
 const bar=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null),trigger=useRef<HTMLElement|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [capacity,setCapacity]=useState(2),[detail,setDetail]=useState<string|null>(null),[anchor,setAnchor]=useState({left:0,bottom:0,width:280});
 useEffect(()=>{const element=bar.current;if(!element)return;const measure=()=>setCapacity(Math.max(1,Math.floor(((element.clientWidth||300)-86-(hasConfiguration?36:0))/106)));measure();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[hasConfiguration]);
 useEffect(()=>{if(detail&&detail!=='more'&&!items.some(i=>i.id===detail))setDetail(null);},[items,detail]);
 useEffect(()=>{if(!detail)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setDetail(null);trigger.current?.focus();}},outside=(e:Event)=>{if(!bar.current?.contains(e.target as Node)&&!popup.current?.contains(e.target as Node))setDetail(null);};window.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);return()=>{window.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};},[detail]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 function show(id:string,element:HTMLElement){clearTimeout(timer.current);trigger.current=element;const r=element.getBoundingClientRect(),width=Math.min(320,window.innerWidth-24);setAnchor({left:Math.max(12,Math.min(r.left,window.innerWidth-width-12)),bottom:window.innerHeight-r.top+8,width});setDetail(id);}
 function leave(){clearTimeout(timer.current);timer.current=setTimeout(()=>{if(!bar.current?.contains(document.activeElement)&&!popup.current?.contains(document.activeElement))setDetail(null);},180);}
 const visible=items.length<=capacity+1?items:items.slice(0,capacity),hidden=items.slice(visible.length),current=items.find(i=>i.id===detail);
 return <div className="notebook-context-bar" ref={bar} aria-label={tr("本轮挂载")} onMouseLeave={leave}>
  {onConfigure&&<button type="button" className="notebook-config-button" aria-label={tr("添加挂载")} title={tr("添加挂载")} aria-controls="assistant-panel-config" onClick={()=>{setDetail(null);onConfigure();}}><Icon name="plus" size={16}/></button>}
  {!items.length&&!onConfigure&&<small>{tr("尚未选择模板或挂载资料")}</small>}
  {visible.map(item=><span className="notebook-context-chip" key={item.id}>
   <button type="button" aria-label={tr("查看挂载：{{name}}", {name: item.name})} aria-expanded={detail===item.id} onMouseEnter={e=>show(item.id,e.currentTarget)} onFocus={e=>show(item.id,e.currentTarget)} onClick={e=>{if(item.open){setDetail(null);item.open();}else show(item.id,e.currentTarget);}}><Icon name={item.icon} size={13}/><span>{item.name}</span></button>
   {item.remove&&<button type="button" className="notebook-context-remove" aria-label={tr("取消挂载：{{name}}", {name: item.name})} disabled={disabled} onClick={item.remove}>×</button>}
  </span>)}
  {!!hidden.length&&<button className="notebook-context-more" aria-expanded={detail==='more'} onClick={e=>show('more',e.currentTarget)}>{tr("更多 {{hidden}} 项", {hidden: hidden.length})}</button>}
  {detail&&(current||hidden.length>0)&&createPortal(<div ref={popup} className="notebook-context-popover" role="region" aria-label={tr("挂载详情")} style={{position:'fixed',...anchor}} onMouseEnter={()=>clearTimeout(timer.current)} onMouseLeave={leave}>
   {(detail==='more'?hidden:current?[current]:[]).map(item=><div key={item.id}><strong><Icon name={item.icon} size={14}/>{item.name}</strong><p>{item.description}</p><footer>{item.open&&<button onClick={()=>{setDetail(null);item.open!();}}>{tr("更换栏目")}</button>}{item.remove&&<button disabled={disabled} onClick={()=>{item.remove!();setDetail(null);}}>{tr("取消挂载：{{name}}", {name: item.name})}</button>}</footer></div>)}
  </div>,document.body)}
 </div>;
}
