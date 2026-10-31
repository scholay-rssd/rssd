import {useRef,useState,type DragEvent} from 'react';
import {invoke} from '../lib/nativeCore';
import {openCreativeSpace} from './SpaceEntrances';

import { tr, trNative } from "../uiText";
export type SiteAuthorizationResult={cancelled?:boolean;connected?:boolean;spaceId:string;siteId:string;name:string;origin:string;existing:boolean;message:string};
export default function SiteAuthorizationImport({disabled,currentSpace,onImported,onBusyChange}:{disabled:boolean;currentSpace?:string;onImported:(result:SiteAuthorizationResult)=>Promise<void>;onBusyChange:(busy:boolean)=>void}){
 const [busy,setBusy]=useState(false),[dragging,setDragging]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<SiteAuthorizationResult>();
 const pending=useRef(false),depth=useRef(0);
 async function importFile(file?:File){
  if(disabled||pending.current)return;
  pending.current=true;setBusy(true);onBusyChange(true);setError('');setResult(undefined);
  try{
   if(file&&(!file.name.toLowerCase().endsWith('.json')||file.size>64*1024))throw Error(tr('请选择不超过 64 KB 的 .json 站点授权文件'));
   const imported=await invoke<SiteAuthorizationResult>('space_authorization',{content:file?await file.text():null});
   if(imported.cancelled)return;
   setResult(imported);
   try{await onImported(imported);}catch{setError(tr("连接已完成，但空间列表刷新失败，请重新打开设置查看"));}
  }catch(e){setError(String(e));}finally{pending.current=false;setBusy(false);onBusyChange(false);}
 }
 function drop(event:DragEvent){
  event.preventDefault();event.stopPropagation();depth.current=0;setDragging(false);
  if(disabled||pending.current)return;
  if(event.dataTransfer.files.length!==1){setError(tr("请一次拖入一个站点授权文件"));return;}
  void importFile(event.dataTransfer.files[0]);
 }
 async function enterSpace(){
  if(!result||pending.current)return;
  pending.current=true;setBusy(true);onBusyChange(true);setError('');
  try{await openCreativeSpace(result.spaceId);}catch(e){setError(String(e));}finally{pending.current=false;setBusy(false);onBusyChange(false);}
 }
 return <div className="site-authorization-import">
  <div className={`site-authorization-drop${dragging?' is-dragging':''}`} role="region" aria-label={tr("导入站点授权文件")} aria-busy={busy}
   onDragEnter={e=>{e.preventDefault();depth.current++;if(!disabled)setDragging(true);}}
   onDragLeave={e=>{e.preventDefault();if(--depth.current<=0){depth.current=0;setDragging(false);}}}
   onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect=disabled?'none':'copy';}}
   onDrop={drop}>
   <strong>{tr("拖入站点授权文件，新增或连接空间")}</strong>
   <p>{tr("自动识别站点、验证连接并保存授权。已有空间会保留原来的稿件和设置。")}</p>
   <button type="button" disabled={disabled||busy} onClick={()=>void importFile()}>{tr("选择授权文件")}</button>
   <small>{tr("使用管理员提供的 .scholay-site.json 文件 · 一次导入一个站点")}</small>
  </div>
  {busy&&<p role="status">{result?tr("正在保存并进入空间…"):tr("正在核验站点身份与授权，请稍候…")}</p>}
  {result&&<div className="site-authorization-result" role="status"><strong>{result.name}</strong><span>{result.origin}</span><p>{trNative(result.message)}</p>{result.spaceId!==currentSpace&&<button type="button" disabled={disabled||busy} onClick={()=>void enterSpace()}>{tr("进入此空间")}</button>}</div>}
  {error&&<p className="integration-error" role="alert">{error}</p>}
 </div>;
}
