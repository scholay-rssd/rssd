import {createPortal} from 'react-dom';
import NotebookSearchBar from './NotebookSearchBar';
import {useEffect,useRef,useState} from 'react';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import * as api from '../api';
import Icon from '../components/Icon';
import {WRITING_SKILLS,type Notebook} from '../../scripts/agent/notebook.mjs';
import {templateKey,templateKind,type ContentTemplate} from '../../scripts/agent/notebook-templates.mjs';
import {notebookTemplateModes,readNotebookTemplateLibrary,templateSetting,templateForArticle,isStarter} from './notebookTemplates';
import {type TopicLibrary,type TopicTemplate,type TemplateMode} from './topicTemplates';
import TopicTemplateDialog from './TopicTemplateDialog';

import { tr } from "../uiText";
export default function NotebookTemplatePanel({note,disabled,bound,active=true,onSelect,toolbarHost}:{toolbarHost?:HTMLElement|null;note:Notebook;disabled:boolean;bound:boolean;active?:boolean;onSelect:(template:ContentTemplate|null)=>Promise<void>}){
 const spaceId=ACTIVE_SITE.spaceId;
 const [libraries,setLibraries]=useState<Partial<Record<TemplateMode,TopicLibrary>>>({}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [mode,setMode]=useState<TemplateMode|'all'>('all'),[scope,setScope]=useState<'start'|'all'>('start'),[query,setQuery]=useState(''),[editing,setEditing]=useState<{mode:TemplateMode;template?:TopicTemplate}|null>(null);
 const selecting=useRef(false),alive=useRef(true),stored=useRef<Partial<Record<TemplateMode,string|null>>>({});
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(!active)return;
  let live=true;setLoading(true);setError('');setLibraries({});
  void Promise.all(notebookTemplateModes.map(async mode=>{
   const key=templateSetting(mode),raw=await api.getSetting(key),result=readNotebookTemplateLibrary(raw,mode);
   if(!live||ACTIVE_SITE.spaceId!==spaceId)return null;
   // Browsing never rewrites a saved library. Persist the compatible merged
   // definition only when the author actually edits/deletes/creates a template.
   stored.current[mode]=raw;
   return [mode,result.library] as const;
  })).then(rows=>{if(live&&ACTIVE_SITE.spaceId===spaceId)setLibraries(Object.fromEntries(rows.filter(row=>row!==null)));}).catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[spaceId,retry,active]);
 async function select(t:TopicTemplate,mode:TemplateMode){
  if(selecting.current||disabled||saving)return;selecting.current=true;setError('');
  try{await onSelect(note.templateSelection?.key===templateKey(spaceId,{...t,mode})?null:templateForArticle(t,mode));}catch(e){if(alive.current)setError(String(e));}finally{selecting.current=false;}
 }
 async function save(mode:TemplateMode,templates:TopicTemplate[]){
  if(disabled||saving||!libraries[mode]||ACTIVE_SITE.spaceId!==spaceId)return false;
  setSaving(true);setError('');
  try{const key=templateSetting(mode),current=await api.getSetting(key);if(current!==stored.current[mode])throw Error(tr('模板库已在其他页面修改，请重新读取后继续'));if(ACTIVE_SITE.spaceId!==spaceId)throw Error(tr('工作空间已变化'));const library={...libraries[mode]!,templates},raw=JSON.stringify(library);await api.setSetting(key,raw);stored.current[mode]=raw;if(alive.current&&ACTIVE_SITE.spaceId===spaceId)setLibraries(all=>({...all,[mode]:library}));return true;}
  catch(e){if(alive.current)setError(tr("模板保存失败：{{e}}", {e: String(e)}));return false;}finally{if(alive.current)setSaving(false);}
 }
 const rows=notebookTemplateModes.flatMap(mode=>(libraries[mode]?.templates||[]).map(template=>({mode,template})));
 const shown=rows.filter(row=>(mode==='all'||mode===row.mode)&&(scope==='all'||isStarter(row.template))&&(row.template.name+' '+row.template.prompt).toLowerCase().includes(query.toLowerCase()));
 const current=note.templateSelection;
 return <section className="notebook-template-panel" aria-label={tr("文章模板")}>
  {toolbarHost===undefined&&<>  <header><h3>{tr("文章模板")}</h3><button type="button" disabled={disabled||loading||saving||!!error} onClick={()=>setEditing({mode:mode==='all'?'essay':mode})}><Icon name="plus" size={14}/>{tr("新建")}</button></header>
  <p className="notebook-template-help">{tr("单选即填入占位，再次点击取消。已写内容会保留。")}</p>
  {!current&&!!note.mounts?.templates.length&&<p className="notebook-template-help">{tr("已有模板结构已保留，尚未选用新的预设。")}</p>}
  <div className="notebook-template-filters"><select aria-label={tr("模板用途")} disabled={saving} value={mode} onChange={e=>setMode(e.target.value as TemplateMode|'all')}><option value="all">{tr("全部用途")}</option>{notebookTemplateModes.map(id=><option key={id} value={id}>{WRITING_SKILLS[id].name}</option>)}</select><select aria-label={tr("模板范围")} value={scope} onChange={e=>setScope(e.target.value as 'start'|'all')}><option value="start">{tr("起步模板")}</option><option value="all">{tr("全部模板")}</option></select></div>
  <input className="notebook-template-search" aria-label={tr("搜索文章模板")} placeholder={tr("搜索模板…")} value={query} onChange={e=>{setQuery(e.target.value);if(e.target.value)setScope('all');}}/>
</>}
  {toolbarHost&&createPortal(<NotebookSearchBar label={tr("搜索文章模板")} query={query} onQuery={value=>{setQuery(value);if(value)setScope('all');}} disabled={saving} filters={<div className="notebook-template-filters"><select aria-label={tr("模板用途")} disabled={saving} value={mode} onChange={e=>setMode(e.target.value as TemplateMode|'all')}><option value="all">{tr("全部用途")}</option>{notebookTemplateModes.map(id=><option key={id} value={id}>{WRITING_SKILLS[id].name}</option>)}</select><select aria-label={tr("模板范围")} value={scope} onChange={e=>setScope(e.target.value as 'start'|'all')}><option value="start">{tr("起步模板")}</option><option value="all">{tr("全部模板")}</option></select></div>} actions={<button type="button" aria-label={tr("新建文章模板")} title={tr("新建文章模板")} disabled={disabled||loading||saving||!!error} onClick={()=>setEditing({mode:mode==='all'?'essay':mode})}><Icon name="plus" size={16}/></button>}/>,toolbarHost)}
  {error&&<p role="alert">{error}<button disabled={saving} onClick={()=>setRetry(n=>n+1)}>{tr("重新读取")}</button></p>}
  {loading?<p role="status">{tr("正在读取当前空间的模板…")}</p>:<div className="notebook-template-list">{shown.map(({mode,template:t})=>{
   const selected=current?.key===templateKey(spaceId,{...t,mode}),incompatible=bound&&templateKind(mode)!==note.kind;
   return <article key={mode+':'+t.id} className={'notebook-template-card'+(selected?' is-selected':'')}>
    <button type="button" className="notebook-template-select" aria-pressed={selected} disabled={disabled||saving||incompatible} onClick={()=>void select(t,mode)}><span><strong>{t.name}</strong></span><small>{WRITING_SKILLS[mode].name} · {isStarter(t)?tr("整篇起步"):t.kind==='section'?tr("分栏"):tr("素材")}</small><p>{incompatible?tr("此模板使用另一种记录类型，请新建创作选用。"):t.prompt}</p></button>
    <div className="notebook-template-actions"><button aria-label={tr("编辑模板：{{name}}", {name: t.name})} disabled={disabled||saving} onClick={()=>setEditing({mode,template:t})}>{tr("编辑")}</button><button aria-label={tr("删除模板：{{name}}", {name: t.name})} disabled={disabled||saving} onClick={()=>void save(mode,libraries[mode]!.templates.filter(x=>x.id!==t.id))}>{tr("删除")}</button></div>
   </article>;
  })}{!shown.length&&!error&&<p>{tr("没有匹配的模板，可以切换范围或新建。")}</p>}</div>}
  {editing&&<TopicTemplateDialog key={editing.mode+':'+(editing.template?.id||'new')} allowArticle mode={editing.mode} initial={editing.template} defaultKind="article" materialTemplates={libraries[editing.mode]?.templates.filter(t=>t.kind==='material')} saving={saving} errorMessage={error} onClose={()=>setEditing(null)} onConfirm={async value=>{const entries=libraries[editing.mode]!.templates,next=editing.template?entries.map(t=>t.id===value.id?value:t):[...entries,value];if(await save(editing.mode,next)){setEditing(null);setScope('all');setMode(editing.mode);setQuery('');}}}/>}
 </section>;
}
