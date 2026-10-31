import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import * as api from '../api';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import type {Notebook,TitleTemplate} from '../../scripts/agent/notebook.mjs';
import Icon from '../components/Icon';
import NotebookSearchBar from './NotebookSearchBar';
import {useFocusTrap} from '../hooks/useFocusTrap';

import {DEFAULT_TITLE_TEMPLATE} from '../../scripts/agent/notebook-templates.mjs';
import { tr } from "../uiText";
export {DEFAULT_TITLE_TEMPLATE};
export const defaults:TitleTemplate[]=[DEFAULT_TITLE_TEMPLATE,{id:'title-question',name:'问题与解答',requirement:'围绕正文实际回答的问题拟一个明确的疑问式标题，不制造悬念或夸大结论。'},{id:'title-project',name:'项目与用途',requirement:'以项目或工具名称和主要用途拟标题，说明适用对象，不添加未经验证的评价。'},{id:'title-viewpoint',name:'主题与观点',requirement:'以文章主题和作者实际表达的核心观点拟标题，保留必要的范围与限定。'}];
export const setting='editorial.title-templates.v1';
export default function NotebookTitlePanel({note,disabled,onChange,toolbarHost}:{note:Notebook;disabled:boolean;onChange:(note:Notebook)=>void;toolbarHost:HTMLElement|null}){
 const [rows,setRows]=useState(defaults),[query,setQuery]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false),[saving,setSaving]=useState(false),[editing,setEditing]=useState<TitleTemplate|null>(null),[retry,setRetry]=useState(0);
 const stored=useRef<string|null>(null),alive=useRef(true),spaceId=ACTIVE_SITE.spaceId;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let live=true;setReady(false);setError('');void api.getSetting(setting).then(raw=>{if(!live||ACTIVE_SITE.spaceId!==spaceId)return;const parsed=raw?JSON.parse(raw):defaults;if(!Array.isArray(parsed)||parsed.some(t=>!t||typeof t.id!=='string'||typeof t.name!=='string'||typeof t.requirement!=='string'))throw Error(tr('标题模板格式无效'));stored.current=raw;setRows(parsed);setReady(true);}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[spaceId,retry]);
 async function save(next:TitleTemplate[]){if(!ready||saving||disabled)return false;setSaving(true);setError('');try{if(ACTIVE_SITE.spaceId!==spaceId||await api.getSetting(setting)!==stored.current)throw Error(tr('标题模板库已变化，请重新读取'));if(ACTIVE_SITE.spaceId!==spaceId)throw Error(tr('工作空间已变化'));const raw=JSON.stringify(next);await api.setSetting(setting,raw);stored.current=raw;if(alive.current&&ACTIVE_SITE.spaceId===spaceId)setRows(next);return true;}catch(e){if(alive.current)setError(String(e));return false;}finally{if(alive.current)setSaving(false);}}
 const selected=note.titleTemplate;
 return <section className="notebook-template-panel" aria-label={tr("标题模板")}>
  {error&&<p role="alert">{error}<button disabled={saving} onClick={()=>setRetry(n=>n+1)}>{tr("重新读取")}</button></p>}
  <div className="notebook-template-list">{[...rows,...(selected&&!rows.some(t=>t.id===selected.id)?[selected]:[])].filter(t=>(t.name+' '+t.requirement).toLowerCase().includes(query.toLowerCase())).map(t=><article key={t.id} className={'notebook-template-card'+(selected?.id===t.id?' is-selected':'')}><button className="notebook-template-select" aria-pressed={selected?.id===t.id} disabled={disabled||saving||!ready} onClick={()=>onChange({...note,titleTemplate:selected?.id===t.id?undefined:{...t}})}><span><strong>{t.name}</strong></span><p>{selected?.id===t.id?selected.requirement:t.requirement}</p></button><div className="notebook-template-actions"><button aria-label={tr("编辑标题模板：{{name}}", {name: t.name})} disabled={disabled||saving||!ready} onClick={()=>setEditing({...t})}>{tr("编辑")}</button><button aria-label={tr("删除标题模板：{{name}}", {name: t.name})} disabled={disabled||saving||!ready} onClick={()=>void save(rows.filter(x=>x.id!==t.id))}>{tr("删除")}</button></div></article>)}</div>
  {toolbarHost&&createPortal(<NotebookSearchBar label={tr("搜索标题模板")} query={query} onQuery={setQuery} actions={<button type="button" aria-label={tr("新建标题模板")} title={tr("新建标题模板")} disabled={disabled||saving||!ready} onClick={()=>setEditing({id:crypto.randomUUID(),name:'',requirement:''})}><Icon name="plus" size={16}/></button>}/>,toolbarHost)}
  {editing&&<TitleEditor initial={editing} saving={saving} error={error} onClose={()=>{if(!saving)setEditing(null);}} onSave={async value=>{if(await save(rows.some(t=>t.id===value.id)?rows.map(t=>t.id===value.id?value:t):[...rows,value])){if(note.titleTemplate?.id===value.id)onChange({...note,titleTemplate:value});setEditing(null);}}}/>}
 </section>;
}
function TitleEditor({initial,saving,error,onClose,onSave}:{initial:TitleTemplate;saving:boolean;error:string;onClose:()=>void;onSave:(value:TitleTemplate)=>Promise<void>}){
 const [value,setValue]=useState(initial),ref=useRef<HTMLDivElement>(null);useFocusTrap(ref);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!saving)onClose();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[saving,onClose]);
 return createPortal(<div className="modal-backdrop" onClick={onClose}><div className="modal notebook-title-dialog" role="dialog" aria-modal="true" aria-label={tr("编辑标题模板")} ref={ref} onClick={e=>e.stopPropagation()}><h2>{tr("标题模板")}</h2><label>{tr("名称")}<input autoFocus aria-label={tr("标题模板名称")} maxLength={120} disabled={saving} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/></label><label>{tr("标题要求")}<textarea aria-label={tr("标题模板要求")} maxLength={4000} disabled={saving} value={value.requirement} onChange={e=>setValue({...value,requirement:e.target.value})}/></label>{error&&<p role="alert">{error}</p>}<footer><button disabled={saving} onClick={onClose}>{tr("取消")}</button><button disabled={saving||!value.name.trim()||!value.requirement.trim()} onClick={()=>void onSave({...value,name:value.name.trim(),requirement:value.requirement.trim()})}>{tr("保存")}</button></footer></div></div>,document.body);
}
