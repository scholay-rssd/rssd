import {useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Notebook} from '../../scripts/agent/notebook.mjs';
import type {ContentTemplate} from '../../scripts/agent/notebook-templates.mjs';
import {useFocusTrap} from '../hooks/useFocusTrap';
import NotebookTemplatePanel from './NotebookTemplatePanel';
import NotebookTitlePanel from './NotebookTitlePanel';
import NotebookBrandPanel from './NotebookBrandPanel';
import type {PresetKind} from './NotebookMountPicker';
import { tr } from "../uiText";
export default function NotebookPresetManager({initial,note,bound,disabled,onSelect,onChange,onClose}:{initial:PresetKind;note:Notebook;bound:boolean;disabled:boolean;onSelect:(t:ContentTemplate|null)=>Promise<void>;onChange:(n:Notebook)=>void;onClose:()=>void}){
 const [kind,setKind]=useState(initial),[toolbar,setToolbar]=useState<HTMLDivElement|null>(null),ref=useRef<HTMLDivElement>(null);useFocusTrap(ref);
 return createPortal(<div className="modal-backdrop" onClick={onClose}><div ref={ref} className="modal notebook-preset-manager" role="dialog" aria-modal="true" aria-label={tr("管理写作预设")} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'&&ref.current?.contains(e.target as Node)){e.stopPropagation();onClose();}}}><header><select autoFocus aria-label={tr("预设类型")} value={kind} onChange={e=>setKind(e.target.value as PresetKind)}><option value="templates">{tr("文章模板")}</option><option value="titles">{tr("标题模板")}</option><option value="brands">{tr("品牌资料")}</option></select><button aria-label={tr("关闭预设管理")} onClick={onClose}>×</button></header><div className="notebook-preset-manager-body">{kind==='templates'?<NotebookTemplatePanel note={note} disabled={disabled} bound={bound} toolbarHost={toolbar} onSelect={onSelect}/>:kind==='titles'?<NotebookTitlePanel note={note} disabled={disabled} toolbarHost={toolbar} onChange={onChange}/>:<NotebookBrandPanel note={note} disabled={disabled} toolbarHost={toolbar} onChange={onChange}/>}</div><div ref={setToolbar}/></div></div>,document.body);
}
