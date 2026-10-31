import {useEffect,useRef,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import {protectMathMarkdown,restoreMathHtml} from '../../../scripts/article-math.mjs';
import {CardPreviewInternalNotes,type CardPreviewBlock,type CardPreviewPosition} from './PreviewInternalNotes';
import './note-cards-preview.css';

import { tr } from "../uiText";
type Breaks=Record<string,'page'|'flow'>;
type Rendered={id:string;sourceHash:string;width:number;height:number;pages:{thumbnail:string;heading:string;blocks:string[];positions?:CardPreviewPosition[]}[];blocks:(CardPreviewBlock&{label:string})[];warnings?:string[]};
type Source={html:string;hash:string;key:string;storageKey:string};
type Props={articleId:string;text?:string;html?:string;baseUrl?:string};
const sha=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
function readBreaks(key:string):Breaks{try{const value=JSON.parse(localStorage.getItem(key)||'{}');return Object.fromEntries(Object.entries(value).filter(([id,v])=>/^b\d+(?:-\d+)?$/.test(id)&&(v==='page'||v==='flow'))) as Breaks;}catch{return {};}}

export default function NoteCardsPreview({articleId,text,html:given,baseUrl}:Props){
  const propKey=JSON.stringify([ACTIVE_SITE.id,articleId,text,given,baseUrl]);
  const [source,setSource]=useState<Source|null>(null),[breaks,setBreaks]=useState<Breaks>({});
  const [rendered,setRendered]=useState<(Rendered&{key:string})|null>(null),[selected,setSelected]=useState(0);
  const [full,setFull]=useState({key:'',image:''}),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [working,setWorking]=useState(true),[exporting,setExporting]=useState(false),[retry,setRetry]=useState(0);
  const [platform,setPlatform]=useState('xiaohongshu'),[format,setFormat]=useState('png'),[inspector,setInspector]=useState(false),[zoom,setZoom]=useState(false);
  const stage=useRef<HTMLDivElement>(null),paper=useRef<HTMLImageElement>(null);
  const renderKey=JSON.stringify([propKey,breaks,retry]);
  const fresh=!!rendered&&source?.key===propKey&&rendered.key===renderKey;
  const current=useRef(renderKey);current.current=renderKey;
  useEffect(()=>{
    let stale=false;setError('');setNotice('');setWorking(true);setSource(null);
    const timer=setTimeout(()=>void (async()=>{
      let html=given;
      if(html===undefined){const protectedMath=text===undefined?undefined:protectMathMarkdown(text);const response=await invoke<{html:string;warnings?:string[]}>('editorial_call',{method:'draft_preview',params:{id:articleId,markdown:protectedMath?.markdown,embedImages:true}});if(response.warnings?.length)throw Error(response.warnings.join('；'));html=restoreMathHtml(response.html,protectedMath?.replacements||[]);}
      if(baseUrl){const doc=new DOMParser().parseFromString(html,'text/html');for(const img of doc.querySelectorAll('img')){const src=img.getAttribute('src');if(src&&!src.startsWith('data:'))img.setAttribute('src',new URL(src,baseUrl).href);}html=doc.body.innerHTML;}
      const hash=await sha(html),storageKey=`scholay.note-cards.v1:${ACTIVE_SITE.id}:${articleId}:${hash}`;
      if(!stale){setBreaks(readBreaks(storageKey));setSource({html,hash,key:propKey,storageKey});}
    })().catch(e=>{if(!stale){setError(String(e));setWorking(false);}}),200);
    return()=>{stale=true;clearTimeout(timer);};
  },[propKey,retry]);
  useEffect(()=>{
    if(!source||source.key!==propKey)return;
    let stale=false;setWorking(true);setError('');setNotice('');
    const timer=setTimeout(()=>void invoke<Rendered>('note_cards_call',{method:'render',params:{articleId,html:source.html,breaks}}).then(value=>{
      if(!stale){setRendered({...value,key:renderKey});setSelected(n=>Math.min(n,value.pages.length-1));}
    }).catch(e=>{if(!stale)setError(String(e));}).finally(()=>{if(!stale)setWorking(false);}),250);
    return()=>{stale=true;clearTimeout(timer);};
  },[source,renderKey]);
  const imageKey=rendered?`${rendered.id}:${selected}`:'';
  useEffect(()=>{
    if(!rendered||!fresh)return;
    let stale=false;
    void invoke<{image:string}>('note_cards_call',{method:'page',params:{id:rendered.id,index:selected}}).then(value=>{if(!stale)setFull({key:imageKey,image:value.image});}).catch(e=>{if(!stale)setError(String(e));});
    return()=>{stale=true;};
  },[imageKey,fresh]);
  function change(next:Breaks){setBreaks(next);setNotice('');if(source)try{localStorage.setItem(source.storageKey,JSON.stringify(next));}catch{setNotice(tr("分页调整仅在本次预览中保留。"));}}
  async function exportImages(){
    if(!fresh||!rendered||working||exporting||error)return;
    const started=current.current;setExporting(true);setNotice('');
    try{const result=await invoke<{directory:string;count:number}|null>('note_cards_export',{id:rendered.id,sourceHash:rendered.sourceHash,format,platform});if(result&&current.current===started)setNotice(tr("已导出 {{count}} 张图片：{{directory}}", {count: result.count, directory: result.directory}));}
    catch(e){if(current.current===started)setError(String(e));}finally{setExporting(false);}
  }
  const page=rendered?.pages[selected];
  return <section className="note-cards" aria-label={tr("图文笔记预览")} aria-busy={working}>
    <header className="note-cards-toolbar"><span className="note-cards-size">3:4 <small>1080 × 1440</small></span><button aria-pressed={inspector} onClick={()=>setInspector(v=>!v)}>{tr("调整分页")}</button><button disabled={working||exporting} onClick={()=>setRetry(n=>n+1)}>{tr("重新生成")}</button><button aria-pressed={zoom} onClick={()=>setZoom(v=>!v)}>{zoom?tr("适合整页"):tr("放大查看")}</button><div className="note-cards-export"><select aria-label={tr("图片使用平台")} value={platform} disabled={exporting} onChange={e=>setPlatform(e.target.value)}><option value="xiaohongshu">{tr("小红书")}</option><option value="douyin">{tr("抖音")}</option></select><select aria-label={tr("图片导出格式")} value={format} disabled={exporting} onChange={e=>setFormat(e.target.value)}><option value="png">{tr("PNG · 清晰")}</option><option value="jpeg">{tr("JPG · 较小")}</option></select><button className="note-cards-primary" disabled={!fresh||working||exporting||!!error} onClick={()=>void exportImages()}>{exporting?tr("正在导出…"):tr("导出图片")}</button></div></header>
    <p className="note-cards-hint">{tr("每个子标题另起一页，长内容自动续页。分页调整仅用于图片；当前编辑内容也可直接预览。")}</p>
    {error&&<p role="alert" className="note-cards-message">{error}<button disabled={working||exporting} onClick={()=>setRetry(n=>n+1)}>{tr("重试")}</button></p>}
    {notice&&<p role="status" className="note-cards-message">{notice}</p>}
    {fresh&&rendered?.warnings?.map(message=><p key={message} role="status" className="note-cards-message">{message}</p>)}
    <div className={`note-cards-workspace${inspector?' has-inspector':''}`}>
      <nav className="note-cards-thumbs" aria-label={tr("图文笔记页码")}>{rendered?.pages.map((p,i)=><button key={i} disabled={!fresh||exporting} aria-current={selected===i?'page':undefined} aria-label={tr("第 {{value}} 页：{{value2}}", {value: i+1, value2: p.heading||tr('正文')})} onClick={()=>setSelected(i)}><img src={p.thumbnail} alt=""/><span>{String(i+1).padStart(2,'0')}</span></button>)}</nav>
      <div ref={stage} className={`note-cards-stage${zoom?'':' is-fit'}`}>{page&&<img ref={paper} className="note-cards-paper" src={full.key===imageKey?full.image:page.thumbnail} alt={tr("第 {{value}} 页，{{value2}}", {value: selected+1, value2: page.heading||tr('正文')})} style={{opacity:fresh?1:.35}}/>}{page&&rendered&&<CardPreviewInternalNotes articleId={articleId} version={rendered.sourceHash} stage={stage} image={paper} blocks={rendered.blocks} positions={page.positions||[]} width={rendered.width||1080} height={rendered.height||1440} firstPage={selected===0} visible={fresh&&!working}/>}{working&&<div className="note-cards-progress" role="status">{tr("正在测量分页并生成图片…")}</div>}{!rendered&&!working&&!error&&<p>{tr("暂无可排版内容")}</p>}<footer>{fresh&&rendered?tr("第 {{value}} / {{pages}} 页 · {{value2}}", {value: selected+1, pages: rendered.pages.length, value2: page?.heading||tr('正文')}):tr("预览准备中")}</footer></div>
      {inspector&&<aside className="note-cards-pagination" aria-label={tr("分页设置")}><div><strong>{tr("从哪里开始新页")}</strong><button disabled={!fresh||exporting||!Object.keys(breaks).length} onClick={()=>change({})}>{tr("恢复默认")}</button></div><p>{tr("选择段落后调整起页位置。接上页后，放不下的内容仍会自动续页。")}</p>{rendered?.blocks.map(block=><label key={block.id} className={block.heading?'is-heading':undefined}><span title={block.label}>{block.label}</span><select aria-label={tr("分页：{{label}}", {label: block.label})} value={breaks[block.id]||'auto'} disabled={!fresh||exporting} onChange={e=>{const next={...breaks};if(e.target.value==='auto')delete next[block.id];else next[block.id]=e.target.value as 'page'|'flow';change(next);}}><option value="auto">{block.heading?tr("默认 · 新页"):tr("默认 · 连续")}</option><option value="page">{tr("从此分页")}</option><option value="flow">{tr("接上页")}</option></select></label>)}</aside>}
    </div>
  </section>;
}
