import {useEffect,useRef,useState} from 'react';
import {connectionService,providers,safeResourceUrl,type Resource,type ResourcePage} from '../connections/client';
import type {NoteSource} from '../../scripts/agent/notebook.mjs';
import type {TurnAttachment} from './notebookAttachments';
import Icon from '../components/Icon';

import { tr } from "../uiText";
export default function NotebookAppResources({providerId,mountedIds,disabled,onSource,onFile,onOpen,onClose}:{providerId:string;mountedIds:string[];disabled:boolean;onSource:(source:NoteSource)=>void;onFile:(file:TurnAttachment)=>boolean;onOpen:(url:string,title:string)=>void;onClose:()=>void}){
 const [page,setPage]=useState<ResourcePage>({items:[]}),[busy,setBusy]=useState(false),[error,setError]=useState(''),live=useRef(true);
 const provider=providers.find(p=>p.id===providerId)!;
 async function browse(cursor?:string){setBusy(true);setError('');try{const result=await connectionService.browse(providerId,cursor);if(live.current)setPage(old=>({...result,items:cursor?[...old.items,...result.items.filter(item=>!old.items.some(x=>x.id===item.id))]:result.items}));}catch(e){if(live.current)setError(String(e));}finally{if(live.current)setBusy(false);}}
 useEffect(()=>{live.current=true;void browse();return()=>{live.current=false;};},[]);
 function attach(item:Resource){
  const url=safeResourceUrl(item.url),id=providerId+':'+item.id,summary=[provider.name+' · '+item.kind,item.detail,item.target?'资源标识：'+item.target:''].filter(Boolean).join('\n');
  if(url)onSource({id,title:item.title,summary,url,publisher:provider.name,recordId:id,acquiredVia:'record',reviewed:false});
  else if(!onFile({id,name:item.title+'.txt',type:'text',text:[item.title,summary,'这是目录信息，不包含文档正文。'].join('\n')}))return;
 }
 return <section className="notebook-chat-resource" aria-label={tr("{{name}}资料", {name: provider.name})}><header><strong>{provider.name}</strong><button aria-label={tr("关闭应用资料")} onClick={onClose}><Icon name="x" size={14}/></button></header>
  {error&&<p role="alert">{error}<button disabled={busy} onClick={()=>void browse()}>{tr("重试")}</button></p>}
  {page.notice&&<p>{page.notice}</p>}
  {page.items.map(item=><article className="notebook-rss-result" key={item.id}>{safeResourceUrl(item.url)?<a href={safeResourceUrl(item.url)} onClick={e=>{e.preventDefault();onOpen(safeResourceUrl(item.url)!,item.title);}}>{item.title}</a>:<strong>{item.title}</strong>}<p>{item.detail}</p><button disabled={disabled||mountedIds.includes(providerId+':'+item.id)} onClick={()=>attach(item)}>{mountedIds.includes(providerId+':'+item.id)?tr("已附加"):safeResourceUrl(item.url)?tr("附加来源引用"):tr("附加目录信息")}</button></article>)}
  {busy?<p role="status">{tr("读取资料…")}</p>:!page.items.length&&!error?<p>{tr("当前范围没有资料")}</p>:null}
  {page.nextCursor&&<button disabled={busy} onClick={()=>void browse(page.nextCursor)}>{tr("加载更多")}</button>}
 </section>;
}
