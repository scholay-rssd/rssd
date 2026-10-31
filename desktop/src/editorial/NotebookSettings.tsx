import type {Notebook} from '../../scripts/agent/notebook.mjs';
import Icon from '../components/Icon';
import NotebookFields from './NotebookFields';

import { tr } from "../uiText";
export default function NotebookSettings({note,disabled,sections,panel,onPanel,onChange}:{note:Notebook;disabled:boolean;sections:{id:string;name:string}[];panel:'section'|'properties'|null;onPanel:(panel:'section'|'properties'|null)=>void;onChange:(note:Notebook)=>void}){
 return <section className="notebook-settings" aria-label={tr("文章设置")}><h3>{tr("文章设置")}</h3><div className="notebook-mount-grid">{([['section',tr('公开栏目'),'folder',sections.find(s=>s.id===note.sectionId)?.name||tr('沿用原栏目映射')],['properties',tr('内容属性'),'settings',tr(note.kind==='article'?'当前模板与内容类型':'内容类型与组件字段')]] as const).map(([key,name,icon,description])=><button key={key} type="button" className={'notebook-mount-card'+(panel===key?' is-selected':'')} aria-expanded={panel===key} aria-label={name} onClick={()=>onPanel(panel===key?null:key)}><span className="notebook-mount-icon"><Icon name={icon} size={26}/></span><strong>{name}</strong><small>{description}</small></button>)}</div>
  {panel==='section'&&<div className="notebook-settings-detail" data-notebook-setting="section"><label>{tr("公开栏目")}<select aria-label={tr("公开栏目")} disabled={disabled} value={note.sectionId||''} onChange={e=>onChange({...note,sectionId:e.target.value||undefined})}><option value="">{tr("沿用原栏目映射")}</option>{sections.map(section=><option key={section.id} value={section.id}>{section.name}</option>)}</select></label></div>}
  {panel==='properties'&&<div className="notebook-settings-detail" data-notebook-setting="properties"><NotebookFields note={note} disabled={disabled} onChange={onChange} inline/></div>}
 </section>;
}
