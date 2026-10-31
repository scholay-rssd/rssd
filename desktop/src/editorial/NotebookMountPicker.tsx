import {useEffect,useRef,useState,type ReactNode} from 'react';
import * as api from '../api';
import Icon,{type IconName} from '../components/Icon';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import {templateKind,type ContentTemplate} from '../../scripts/agent/notebook-templates.mjs';
import type {Brand,MountedWritingSkill,Notebook,TitleTemplate} from '../../scripts/agent/notebook.mjs';
import {isStarter,notebookTemplateModes,readNotebookTemplateLibrary,templateForArticle,templateSetting} from './notebookTemplates';
import {defaults as titleDefaults,setting as titleSetting} from './NotebookTitlePanel';
import {connectionService,connectionEnabled,providers,statusLabels,type Connection} from '../connections/client';
import type {TurnContext} from './notebookTurns';

import { tr } from "../uiText";
export type PresetKind='templates'|'titles'|'brands';
type Props={draft:TurnContext;note:Notebook;bound:boolean;skills:MountedWritingSkill[];brands:Brand[];disabled:boolean;onChange:(next:TurnContext)=>void;onFiles:()=>void;onApp:(id:string)=>void;onClose:()=>void;onManage:(kind:PresetKind)=>void};
export default function NotebookMountPicker(p:Props){
 const [templates,setTemplates]=useState<ContentTemplate[]>([]),[titles,setTitles]=useState<TitleTemplate[]>([]),[connections,setConnections]=useState<Connection[]>([]),[error,setError]=useState(''),[appError,setAppError]=useState(''),[loading,setLoading]=useState(true);
 const root=useRef<HTMLDivElement>(null),space=ACTIVE_SITE.spaceId;
 useEffect(()=>{
  root.current?.querySelector<HTMLButtonElement>('.notebook-mount-row:not(:disabled)')?.focus();
 },[]);
 useEffect(()=>{
  let live=true;
  void Promise.allSettled([...notebookTemplateModes.map(async mode=>readNotebookTemplateLibrary(await api.getSetting(templateSetting(mode)),mode).library.templates.map(t=>templateForArticle(t,mode))),api.getSetting(titleSetting).then(raw=>{
   const values:TitleTemplate[]=raw?JSON.parse(raw):titleDefaults;
   if(!Array.isArray(values)||values.some(t=>!t||typeof t.id!=='string'||typeof t.name!=='string'||typeof t.requirement!=='string'))throw Error(tr('标题模板格式无效'));return values;
  })]).then(results=>{if(!live||space!==ACTIVE_SITE.spaceId)return;setTemplates(results.slice(0,-1).flatMap(r=>r.status==='fulfilled'?r.value as ContentTemplate[]:[]));const last=results.at(-1)!;if(last.status==='fulfilled')setTitles(last.value as TitleTemplate[]);if(results.some(r=>r.status==='rejected'))setError(tr("部分预设读取失败，原数据已保留"));setLoading(false);});
  let request=0;
  const loadConnections=()=>{const version=++request;void connectionService.list().then(state=>{if(live&&version===request&&space===ACTIVE_SITE.spaceId&&state.spaceId===space){setConnections(state.connections);setAppError('');}}).catch(()=>{if(live&&version===request)setAppError(tr('应用连接暂时无法读取'));});};
  const changed=(e:Event)=>{if((e as CustomEvent).detail?.spaceId===space)loadConnections();};
  loadConnections();window.addEventListener('today:connections-changed',changed);
  return()=>{live=false;window.removeEventListener('today:connections-changed',changed);};
 },[space]);
 useEffect(()=>{
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)&&!(e.target as Element).closest('.notebook-config-button'))p.onClose();};
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[p.onClose]);
 function change(patch:Partial<TurnContext>,id?:string){p.onChange({...p.draft,...patch,defaultIds:id?p.draft.defaultIds?.filter(x=>x!==id):p.draft.defaultIds});}
 function row(id:string,name:string,description:string,icon:IconName,action:()=>void,selected?:boolean,disabled=false,manage?:PresetKind):ReactNode{
  if(selected)return null;
  return <button key={id} type="button" className="notebook-mount-row" aria-label={name} disabled={p.disabled||disabled} title={description} onClick={e=>{const rows=[...root.current!.querySelectorAll<HTMLButtonElement>('.notebook-mount-row:not(:disabled)')],next=rows[rows.indexOf(e.currentTarget)+1]||rows[0];action();if(selected!==undefined)next?.focus();}} onContextMenu={manage?e=>{e.preventDefault();p.onManage(manage);}:undefined} onKeyDown={manage?e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();p.onManage(manage);}}:undefined}><Icon name={icon} size={17}/><span>{name}</span><small>{description}</small></button>;
 }
 const allTemplates=[...templates,...(p.draft.template&&!templates.some(t=>t.id===p.draft.template?.id&&t.mode===p.draft.template.mode)?[p.draft.template]:[])];
 const allTitles=[...titles,...(p.draft.titleTemplate&&!titles.some(t=>t.id===p.draft.titleTemplate?.id)?[p.draft.titleTemplate]:[])];
 const allSkills=[...p.skills,...p.draft.skills.filter(s=>!p.skills.some(x=>x.id===s.id))];
 const allBrands=[...p.brands,...p.draft.brands.filter(b=>!p.brands.some(x=>x.id===b.id))];
 return <div ref={root} className="notebook-mount-picker is-section-list" role="dialog" aria-label={tr("选择本轮挂载")} id="assistant-panel-config" onKeyDown={e=>{
  if(e.key==='Escape'){e.stopPropagation();p.onClose();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)||e.target instanceof HTMLInputElement)return;
  const rows=[...root.current!.querySelectorAll<HTMLButtonElement>('.notebook-mount-row:not(:disabled)')],i=rows.indexOf(e.target as HTMLButtonElement);if(i<0)return;
  e.preventDefault();rows[e.key==='Home'?0:e.key==='End'?rows.length-1:(i+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();
 }}>
  <div className="notebook-mount-sections">
   <section aria-labelledby="mount-attach"><h3 id="mount-attach" title={tr("右键管理品牌资料")} tabIndex={0} onContextMenu={e=>{e.preventDefault();p.onManage('brands');}}>Attach</h3>
    {row('files',tr('上传本地文件'),tr('文本、Markdown、CSV、JSON、图片'),'file',p.onFiles)}
    {allBrands.map(b=>row('brand:'+b.id,b.name,tr('品牌资料 · {{description}}',{description:b.voice||b.description}),'bookmark',()=>change({brands:p.draft.brands.some(x=>x.id===b.id)?p.draft.brands.filter(x=>x.id!==b.id):[...p.draft.brands,b],endnotes:p.draft.endnotes?.filter(x=>x.preset?.brandId!==b.id)},'brand:'+b.id),p.draft.brands.some(x=>x.id===b.id),false,'brands'))}
   </section>
   <section aria-labelledby="mount-skills"><h3 id="mount-skills" title={tr("右键管理文章模板")} tabIndex={0} onContextMenu={e=>{e.preventDefault();p.onManage('templates');}}>Plugin Skills</h3>
    {loading&&<p role="status">{tr("读取写作预设…")}</p>}{error&&<p role="alert">{error}</p>}
    {allSkills.map(s=>row('skill:'+s.id,s.name,'Skill · '+s.description,'sparkle',()=>change({skills:p.draft.skills.some(x=>x.id===s.id)?p.draft.skills.filter(x=>x.id!==s.id):[...p.draft.skills,s]},'skill:'+s.id),p.draft.skills.some(x=>x.id===s.id)))}
    {[...allTemplates].sort((a,b)=>Number(isStarter(b))-Number(isStarter(a))).map(t=>row('template:'+t.mode+':'+t.id,t.name,tr(isStarter(t)?'文章模板':t.kind==='section'?'内容模板':'素材写法')+' · '+t.prompt,'file',()=>change({template:p.draft.template?.id===t.id&&p.draft.template.mode===t.mode?undefined:t},'template'),p.draft.template?.id===t.id&&p.draft.template.mode===t.mode,p.bound&&templateKind(t.mode)!==p.note.kind,'templates'))}
    {allTitles.map(t=>row('title:'+t.id,t.name,tr('标题模板 · {{requirement}}',{requirement:t.requirement}),'text',()=>change({titleTemplate:p.draft.titleTemplate?.id===t.id?undefined:t},'title-template'),p.draft.titleTemplate?.id===t.id,false,'titles'))}
   </section>
   <section aria-labelledby="mount-app"><h3 id="mount-app">App</h3>
    {row('rss',tr('RSS 素材'),tr('从本地素材库选取文章'),'rss',()=>p.onApp('rss'))}
    {row('web',tr('联网搜索'),tr('允许本轮搜索公开资料'),'globe',()=>change({webEnabled:!p.draft.webEnabled}),p.draft.webEnabled)}
    {providers.map(provider=>{const c=connections.find(c=>c.provider===provider.id);return connectionEnabled(c)&&c?row('app:'+provider.id,provider.name,tr(statusLabels[c.status])+' · '+provider.capabilities.join('、'),'globe',()=>p.onApp(provider.id),undefined,c.status==='expired'||c.status==='limited'):null;})}
    {appError&&<p role="status">{appError}</p>}
   </section>
   <section aria-labelledby="mount-mcp"><h3 id="mount-mcp">MCP</h3><p className="notebook-mount-empty">{tr("暂无可挂载的 MCP 服务")}</p></section>
  </div>
 </div>;
}
