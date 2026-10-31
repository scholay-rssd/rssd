import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import EditorialIcon from './EditorialIcon';
import {LOCATION_LABELS,PUBLICATION_LABELS,localDraftDate,type Work} from './contentLibrary';
import {SYNC_LABELS} from '../publications/websitePublishing';
import { tr } from "../uiText";

export function workDisplayDate(work:Work){
  const full=localDraftDate(work.local)||work.cloud?.dateLabel||work.date||tr('日期未提供');
  // Parse calendar components directly: never convert an event date to another timezone.
  const match=full.match(/(?<!\d)(?:\d{4}\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?!\d)/);
  return {full,short:match&&Number(match[1])>=1&&Number(match[1])<=12&&Number(match[2])>=1&&Number(match[2])<=31?`${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`:'—'};
}
export function fittingTagCount(widths:number[],available:number,moreWidth:number,gap=4){
  if(!widths.length)return 0;
  let used=0,count=0;
  for(let i=0;i<widths.length;i++){
    const next=used+(i?gap:0)+widths[i];
    if(next+(i<widths.length-1?gap+moreWidth:0)>available)break;
    used=next;count++;
  }
  return Math.max(1,count);
}
export default function WorkListRow({work,selected,disabled,onSelect}:{work:Work;selected:boolean;disabled:boolean;onSelect:()=>void}){
  const date=workDisplayDate(work),id=useId(),row=useRef<HTMLButtonElement>(null),tagsRef=useRef<HTMLSpanElement>(null),measure=useRef<HTMLSpanElement>(null);
  const [count,setCount]=useState(1),[tip,setTip]=useState<{left:number;top:number;above:boolean}|null>(null);
  const tags=[{key:'category',label:work.category,className:''},...(work.status?[{key:'status',label:tr(PUBLICATION_LABELS[work.status]),className:work.status==='public'?'is-published':''}]:[]),...work.locations.map(location=>({key:location,label:tr(LOCATION_LABELS[location]),className:'work-location-icon',location})),...(work.local&&['local_changed','conflict','remote_changed','publishing'].includes(work.local.sync?.state||'')?[{key:'sync',label:tr(SYNC_LABELS[work.local.sync!.state]),className:'library-sync'}]:[])];
  const signature=tags.map(x=>x.key+':'+x.label).join('|');
  useLayoutEffect(()=>{
    const el=tagsRef.current,m=measure.current;if(!el||!m)return;
    const update=()=>{const children=Array.from(m.children) as HTMLElement[];const more=children.pop()!;setCount(fittingTagCount(children.map(x=>x.offsetWidth),el.clientWidth,more.offsetWidth));};
    update();const observer=new ResizeObserver(update);observer.observe(el);observer.observe(m);return()=>observer.disconnect();
  },[signature]);
  useEffect(()=>{if(!tip)return;const close=()=>setTip(null);window.addEventListener('scroll',close,true);window.addEventListener('resize',close);return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};},[tip]);
  function show(){const rect=row.current?.getBoundingClientRect();if(!rect)return;const above=window.innerHeight-rect.bottom<210;setTip({left:Math.max(8,Math.min(rect.left,window.innerWidth-368)),top:above?rect.top-7:rect.bottom+7,above});}
  function tagNode(tag:typeof tags[number]){return <span key={tag.key} className={tag.className} {...('location'in tag?{role:'img','aria-label':tag.label}:{})}>{'location'in tag?<EditorialIcon name={tag.location}/>:tag.label}</span>;}
  return <><button ref={row} className="library-work" aria-current={selected?'true':undefined} aria-label={`${work.title}；${date.full}；${tags.map(x=>x.label).join('、')}`} aria-describedby={tip?id:undefined} disabled={disabled} onClick={onSelect} onMouseEnter={show} onMouseLeave={()=>setTip(null)} onFocus={show} onBlur={()=>setTip(null)} onKeyDown={e=>{if(e.key==='Escape')setTip(null);}}>
    <time className="library-work-date">{date.short}</time><strong>{work.title}</strong>
    <span className="library-row-tags" ref={tagsRef}><span className="work-tags">{tags.slice(0,count).map(tagNode)}{count<tags.length&&<span className="library-tag-more">+{tags.length-count}</span>}</span><span className="work-tags library-tag-measure" ref={measure} aria-hidden="true">{tags.map(tagNode)}<span className="library-tag-more">+{tags.length}</span></span></span>
  </button>{tip&&createPortal(<div id={id} role="tooltip" className="work-row-tooltip" style={{left:tip.left,top:tip.top,transform:tip.above?'translateY(-100%)':undefined}}><strong>{work.title}</strong><time>{date.full}</time><div className="work-tags">{tags.map(tag=><span key={tag.key}>{tag.label}</span>)}</div></div>,document.body)}</>;
}
