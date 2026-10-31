import type {DragEvent,HTMLAttributes} from 'react';
import Icon from '../components/Icon';
import {DEFAULT_TEMPLATE_DAYS,type TopicTemplate} from './topicTemplates';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import {isGuoxueSite} from '../../scripts/agent/guoxue-domain.mjs';

import { tr, trKey } from "../uiText";
export const rangeLabel=(t:TopicTemplate)=>isGuoxueSite(ACTIVE_SITE)?t.mode==='rss'?trKey('当前可用'):t.mode==='calendar'?trKey('核对活动日期'):trKey('不限定近期'):t.kind===undefined&&t.days===undefined?trKey('沿用原方向'):t.mode==='history'?trKey('历史史料'):t.mode==='rss'?trKey('当前可用'):'近 '+(t.days??DEFAULT_TEMPLATE_DAYS)+' 天';
// rangeLabel stays Chinese (shared with tests); rangeText is its display form.
const rangeText=(t:TopicTemplate)=>{const label=rangeLabel(t),days=/^近 (\d+) 天$/.exec(label);return days?tr('近 {{days}} 天',{days:days[1]}):tr(label);};
export type TemplateCardProps={selectionHint?:string;template:TopicTemplate;selected:boolean;usable:boolean;busy:boolean;saving:boolean;dragProps:HTMLAttributes<HTMLDivElement>&{onDragStart:(e:DragEvent)=>void};onSelect:()=>void;onEdit:()=>void;onDelete:()=>void};

function Actions({name,busy,saving,onEdit,onDelete}:Pick<TemplateCardProps,'busy'|'saving'|'onEdit'|'onDelete'>&{name:string}){
 return <div className="topic-template-actions"><button disabled={busy||saving} aria-label={tr("编辑模板：{{name}}", {name})} onClick={onEdit}>✎</button><button className="topic-template-delete" disabled={busy||saving} aria-label={tr("删除模板：{{name}}", {name})} onClick={onDelete}><Icon name="trash" size={14}/></button></div>;
}

/** A material template is one search direction: what a single card looks for, and over what time range. */
export function MaterialTemplateCard(p:TemplateCardProps){
 const t=p.template;
 return <div className={'topic-shelf-card is-material'+(p.selected?' is-selected':'')+(!p.usable?' is-unavailable':'')} {...p.dragProps}>
  <button className="topic-source-select" disabled={p.busy||!p.usable} aria-pressed={p.selected} onClick={p.onSelect} title={p.selectionHint||tr("拖到右侧分栏，或点选后点击分栏里的 +")}>
   <span className="tpl-head"><strong title={t.name}>{t.name}</strong><em className="tpl-meta">{rangeText(t)}</em></span>
   <p className="tpl-direction" title={t.prompt}>{t.prompt}</p>
  </button>
  <Actions name={t.name} busy={p.busy} saving={p.saving} onEdit={p.onEdit} onDelete={p.onDelete}/>
 </div>;
}

/** A column template is a structure: its title and the materials it will lay out, in order. */
export function ColumnTemplateCard(p:TemplateCardProps){
 const t=p.template,materials=t.materials||[];
 return <div className={'topic-shelf-card is-section'+(p.selected?' is-selected':'')+(!p.usable?' is-unavailable':'')} {...p.dragProps}>
  <button className="topic-source-select" disabled={p.busy||!p.usable} aria-pressed={p.selected} onClick={p.onSelect} title={p.selectionHint||tr("拖到右侧分栏区，或点选后点击“新增分栏”")}>
   <span className="tpl-head"><strong title={t.name}>{t.name}</strong><em className="tpl-meta">{tr("{{materials}} 张 · {{rangeLabel}}", {materials: materials.length, rangeLabel: rangeText(t)})}</em></span>
   <ol className="tpl-materials">{materials.map((m,i)=><li key={i} title={m.prompt}><i>{i+1}</i><span>{m.name}</span></li>)}</ol>
  </button>
  <Actions name={t.name} busy={p.busy} saving={p.saving} onEdit={p.onEdit} onDelete={p.onDelete}/>
 </div>;
}
