import type {PointerEvent, ReactNode} from 'react';
import Icon, {type IconName} from '../components/Icon';

import { tr } from "../uiText";
export default function NotebookResourceCard({title,description,meta,icon,disabled,dragging,onPointerDown,onAdd,onPreview,onOpen,actions}:{title:string;description:string;meta:string;icon:IconName;disabled?:boolean;dragging?:boolean;onPointerDown:(event:PointerEvent<HTMLElement>)=>void;onAdd:()=>void;onPreview?:()=>void;onOpen?:()=>void;actions?:ReactNode}){
 return <article className={'notebook-source-card'+(dragging?' is-dragging':'')} aria-disabled={disabled||undefined} onMouseEnter={onPreview} onFocus={onPreview} draggable={false} onDragStart={e=>e.preventDefault()} onPointerDown={e=>{if(disabled||(e.target as HTMLElement).closest('button,a,input'))return;onPointerDown(e);}}>
  <button className="notebook-source-handle" type="button" disabled={disabled} onPointerDown={e=>{e.stopPropagation();onPointerDown(e);}} onClick={e=>{if(e.detail===0)onAdd();}} aria-label={tr("拖入正文：{{title}}", {title})} title={tr("按住卡片拖入正文")}>⠿</button>
  <div className="notebook-source-body"><span className="notebook-source-icon"><Icon name={icon} size={18}/></span><strong>{title}</strong><p>{description}</p><small>{meta}</small></div>
  <footer className="notebook-source-actions"><button type="button" disabled={disabled} onClick={onAdd} aria-label={tr("插入文章：{{title}}", {title})}>{tr("插入文章")}</button>{onOpen&&<button type="button" title={tr("查看原文")} aria-label={tr("查看原文：{{title}}", {title})} onClick={onOpen}><Icon name="open" size={13}/></button>}{actions}</footer>
 </article>;
}
