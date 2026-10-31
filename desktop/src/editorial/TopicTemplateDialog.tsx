import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import {isGuoxueSite,GUOXUE_PROMPT_GROUPS} from '../../scripts/agent/guoxue-domain.mjs';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {bundleSummary,type TopicTemplate,type TemplateMode,type SectionMaterial} from './topicTemplates';
import {taskType} from '../../scripts/agent/task-types.mjs';
import {useFocusTrap} from '../hooks/useFocusTrap';
import { tr, trKey } from "../uiText";
const PROMPT_GROUPS=[
 {label:trKey('内容方向'),items:[[trKey('科研新进展'),'关注有新证据、新方法或新发现的科研进展。'],[trKey('资助政策'),'查找科研资助、基金申报与政策规则的新变化。'],[trKey('学术会议'),'查找学术会议、征稿与重要学术活动。'],[trKey('开源项目'),'查找面向科研的开源项目、数据集或实用工具。']]},
 {label:trKey('来源偏好'),items:[[trKey('本地 RSS 优先'),'优先检索本地 RSS 已收集的材料，缺口再联网补充。'],[trKey('机构原文'),'优先大学、研究机构、资助机构发布的官方原文。'],[trKey('论文原文'),'优先论文原文及其配套数据，区分论文结论与媒体解读。'],[trKey('开源仓库'),'优先官方开源仓库，核对许可证、维护状态与实际用途。']]},
 {label:trKey('采集要求'),items:[[trKey('核实日期'),'核对原始发布日期与事件日期，不以抓取日期代替。'],[trKey('排除转载'),'同一事件的转载去重，避开已选素材和重复角度。'],[trKey('可操作信息'),'优先包含申请条件、截止日期、使用入口等可操作信息。']]},
];
const GENERAL_PROMPT_GROUPS=[
 {label:trKey('内容方向'),items:[[trKey('领域进展'),'围绕当前工作空间的领域，核对新进展的原始事实。'],[trKey('概念与方法'),'解释具体概念、方法及适用边界，区分事实与作者判断。'],[trKey('案例与实践'),'整理有出处的案例和可复现步骤，不编造亲历或实测结果。'],[trKey('工具与资源'),'核对资源的正式入口、版本、授权与实际用途。']]},
 {label:trKey('来源偏好'),items:[[trKey('已有资料优先'),'优先使用本篇已选资料和本地 RSS，缺口再补充原始来源。'],[trKey('官方原文'),'优先发布机构或作者的原文，保留出处与版本。'],[trKey('开源仓库'),'代码项目优先官方仓库，核对许可证、维护状态与实际用途。']]},
 {label:trKey('核对要求'),items:[[trKey('核实日期'),'区分发布日期、事件日期和抓取日期。'],[trKey('保留分歧'),'保留来源分歧、适用条件和未核实的缺口。'],[trKey('避免重复'),'围绕本篇主题补充不同角度，避免资料重复。']]},
];
export default function TopicTemplateDialog({initial,defaultKind='material',allowArticle=false,materialTemplates=[],mode='xiwen',onConfirm,onClose,saving,errorMessage}:{mode?:TemplateMode;allowArticle?:boolean;defaultKind?:'material'|'section'|'article';materialTemplates?:TopicTemplate[];initial?:TopicTemplate;onConfirm:(value:TopicTemplate)=>void;onClose:()=>void;saving:boolean;errorMessage:string}){
 const guoxue=isGuoxueSite(ACTIVE_SITE);
 const promptGroups=guoxue?GUOXUE_PROMPT_GROUPS:ACTIVE_SITE.legacy?PROMPT_GROUPS:GENERAL_PROMPT_GROUPS;
 const ref=useRef<HTMLDivElement>(null);useFocusTrap(ref);
 const [name,setName]=useState(initial?.name||''),[prompt,setPrompt]=useState(initial?.prompt||''),[kind,setKind]=useState<'material'|'section'|'article'>(initial?.kind||defaultKind),[days,setDays]=useState(initial?.days?.toString()||''),[materials,setMaterials]=useState<SectionMaterial[]>(()=>initial?.materials?.map(m=>({...m}))||[{name:'',prompt:''},{name:'',prompt:''},{name:'',prompt:''}]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();if(!saving)onClose();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[onClose,saving]);
 const selected=(text:string)=>prompt.split('\n').some(line=>line.trim()===text);
 function toggle(text:string){setPrompt(current=>current.split('\n').some(line=>line.trim()===text)?current.split('\n').filter(line=>line.trim()!==text).join('\n'):[current.trimEnd(),text].filter(Boolean).join('\n'));}
 return createPortal(<div className="modal-backdrop" onClick={()=>{if(!saving)onClose();}}><div className="modal topic-source-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="topic-template-heading" onClick={e=>e.stopPropagation()}>
 <header><h2 id="topic-template-heading">{initial?tr("编辑 AI 模板"):tr("新建 AI 模板")}</h2></header>
 <div className="topic-smart-options"><div className="topic-template-fields"><label>{tr("模板类型")}<select aria-label={tr("模板类型")} value={kind} disabled={saving} onChange={e=>setKind(e.target.value as typeof kind)}><option value="material">{tr("单条素材")}</option><option value="section">{tr("整个分栏")}</option>{(allowArticle||initial?.kind==='article')&&<option value="article">{tr("整篇起步")}</option>}</select></label>{!guoxue&&taskType(mode)?.dateRule==='recent'&&<label>{tr("时间范围")}<select aria-label={tr("时间范围")} value={days} disabled={saving} onChange={e=>setDays(e.target.value)}><option value="">{tr("默认（近 7 天）")}</option>{[...new Set([7,14,30,90,...(initial?.days?[initial.days]:[])])].map(n=><option key={n} value={n}>{tr("近 {{n}} 天", {n})}</option>)}</select></label>}</div><label className="topic-search-direction">{kind==='article'?tr("模板名称"):kind==='section'?tr("分栏标题"):tr("素材名称")}<input autoFocus disabled={saving} maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder={guoxue?(kind!=='material'?tr("例如：四书五经"):tr("例如：论语章句细读")):(ACTIVE_SITE.legacy?(kind!=='material'?tr("例如：基金与政策"):tr("例如：科研资助政策")):(kind!=='material'?tr("例如：{{domain}}专题", {domain: ACTIVE_SITE.domain}):tr("例如：{{domain}}资料核对", {domain: ACTIVE_SITE.domain})))}/></label>
 {kind!=='material'?<>
 <section className="topic-bundle-editor" aria-label={tr("分栏里的素材")}>
  {materials.map((m,i)=><div className="topic-bundle-row" key={i}>
   <div className="topic-bundle-head"><span>{tr("素材 {{value}}", {value: i+1})}</span><button type="button" aria-label={tr("删除素材 {{value}}", {value: (i+1)})} disabled={saving||materials.length<=1} onClick={()=>setMaterials(list=>list.filter((_,j)=>j!==i))}>{tr("删除")}</button></div>
   <input aria-label={tr("素材名称 {{value}}", {value: (i+1)})} disabled={saving} maxLength={60} value={m.name} onChange={e=>setMaterials(list=>list.map((x,j)=>j===i?{...x,name:e.target.value}:x))} placeholder={guoxue?tr("素材名称，例如：儒家义理"):ACTIVE_SITE.legacy?tr("素材名称，例如：科研突破"):tr("素材名称，例如：核心概念")}/>
   <textarea aria-label={tr("素材检索方向 {{value}}", {value: (i+1)})} disabled={saving} maxLength={1000} value={m.prompt} onChange={e=>setMaterials(list=>list.map((x,j)=>j===i?{...x,prompt:e.target.value}:x))} placeholder={tr("这张卡片要检索什么：对象、来源偏好、核对要求")}/>
  </div>)}
  <div className="topic-bundle-actions"><button type="button" disabled={saving||materials.length>=(kind==='article'?36:5)} onClick={()=>setMaterials(list=>[...list,{name:'',prompt:''}])}>{tr("＋ 添加素材")}</button>
   {materialTemplates.length>0&&<select aria-label={tr("从素材模板选取")} disabled={saving||materials.length>=(kind==='article'?36:5)&&!materials.some(m=>!m.name.trim()&&!m.prompt.trim())} value="" onChange={e=>{const t=materialTemplates.find(x=>x.id===e.target.value);if(!t)return;setMaterials(list=>{const blank=list.findIndex(m=>!m.name.trim()&&!m.prompt.trim()),item={name:t.name,prompt:t.prompt};return blank>=0?list.map((m,j)=>j===blank?item:m):list.length<(kind==='article'?36:5)?[...list,item]:list;});}}><option value="">{tr("从素材模板选取…")}</option>{materialTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>}</div>
 </section>
 </>:<>
 <div className="topic-prompt-presets" aria-label={tr("提示词预设")}>{promptGroups.map(group=><div className="topic-prompt-group" role="group" aria-label={tr(group.label)} key={group.label}><span>{tr(group.label)}</span><div>{group.items.map(([label,text])=><button key={label} type="button" aria-pressed={selected(text)} disabled={saving||!selected(text)&&prompt.trimEnd().length+text.length+1>1000} title={text} onClick={()=>toggle(text)}>{tr(label)}</button>)}</div></div>)}</div>
 <label className="topic-search-direction">{tr("检索方向")}<textarea disabled={saving} maxLength={1000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={guoxue?tr("例如：论语的具体章句，核对原文、注疏与版本"):ACTIVE_SITE.legacy?tr("例如：科研资助政策的新变化，优先机构原文"):tr("例如：围绕{{domain}}的具体问题，核对原始出处与适用范围", {domain: ACTIVE_SITE.domain})}/></label>
 </>}</div>
 {errorMessage&&<p role="alert">{errorMessage}</p>}<footer className="modal-actions"><button disabled={saving} onClick={onClose}>{tr("取消")}</button><button className="s-btn primary" disabled={saving||!name.trim()||(kind!=='material'?!materials.length||materials.some(m=>!m.name.trim()||!m.prompt.trim()):!prompt.trim())} onClick={()=>{
  const cleaned=materials.map(m=>({name:m.name.trim(),prompt:m.prompt.trim()}));
  onConfirm({...initial,id:initial?.id||crypto.randomUUID(),name:name.trim(),prompt:kind!=='material'?bundleSummary(cleaned):prompt.trim(),kind,...(initial?.mode||mode!=='xiwen'?{mode:initial?.mode||mode}:{}),days:!guoxue&&days?Number(days):undefined,materials:kind!=='material'?cleaned:undefined});
 }}>{tr("保存模板")}</button></footer>
 </div></div>,document.body);
}
