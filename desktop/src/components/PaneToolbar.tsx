import {createContext,useContext,useLayoutEffect,useRef,useState,type ReactElement,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {tr} from '../uiText';

export const WindowChromeContext=createContext<{host:HTMLElement|null;workspace:string;collapsed:boolean;toggle:()=>void}|null>(null);
export const useWindowChrome=()=>useContext(WindowChromeContext);
export function SidebarTitle({children,actions}:{children:ReactNode;actions?:ReactNode}){
 const chrome=useWindowChrome();
 return chrome?<header className="workspace-sidebar-heading"><strong>{children}</strong>{actions}</header>:null;
}
/** Business controls stay in their column. Only extension toggles and tabs
 * belong in the window strip, measured from the pane that owns them. */
const TAB_SCROLLERS='.manager-tabstrip,.gallery-tabstrip,.reader-tabs,.task-tabs';
/** Title-bar tab strips have no room for a scrollbar: it covered the tabs and
 * fought the window drag region. The wheel scrolls sideways instead, and
 * arrow buttons appear only while tabs overflow. */
function useTabScroll(host:HTMLElement|null){
 const [edges,setEdges]=useState({start:false,end:false}),scroller=useRef<HTMLElement|null>(null);
 useLayoutEffect(()=>{
  if(!host)return;
  let el:HTMLElement|null=null;
  const update=()=>{const next=host.querySelector<HTMLElement>(TAB_SCROLLERS);if(next!==el){el?.removeEventListener('scroll',update);el=next;scroller.current=el;el?.addEventListener('scroll',update,{passive:true});if(el)ro.observe(el);}
   const start=!!el&&el.scrollLeft>1,end=!!el&&el.scrollLeft+el.clientWidth<el.scrollWidth-1;
   setEdges(old=>old.start===start&&old.end===end?old:{start,end});};
  const wheel=(e:WheelEvent)=>{const target=scroller.current;if(!target||e.ctrlKey||Math.abs(e.deltaX)>=Math.abs(e.deltaY)||target.scrollWidth<=target.clientWidth)return;e.preventDefault();target.scrollLeft+=e.deltaY*(e.deltaMode===1?16:1);};
  const ro=new ResizeObserver(update),mo=new MutationObserver(update);
  ro.observe(host);mo.observe(host,{childList:true,subtree:true});host.addEventListener('wheel',wheel,{passive:false});update();
  return()=>{ro.disconnect();mo.disconnect();host.removeEventListener('wheel',wheel);el?.removeEventListener('scroll',update);scroller.current=null;};
 },[host]);
 const step=(direction:1|-1)=>{const el=scroller.current;if(el)el.scrollBy({left:direction*Math.max(120,el.clientWidth*.7),behavior:'smooth'});};
 return {edges,step};
}
export default function PaneToolbar({children,active=true,alignTo,endBefore,placement='content',endInset=0}:{children:ReactElement<{className?:string}>;active?:boolean;alignTo?:string;endBefore?:string;placement?:'content'|'tabs'|'toggle';endInset?:number}){
 const chrome=useWindowChrome(),anchor=useRef<HTMLDivElement>(null);
 const [box,setBox]=useState<{left:number;width:number}|null>(null),[portal,setPortal]=useState<HTMLDivElement|null>(null);
 const {edges,step}=useTabScroll(placement==='tabs'?portal:null);
 useLayoutEffect(()=>{
  if(placement==='content'||!chrome?.host||!anchor.current)return;
  const el=anchor.current,host=chrome.host;
  const aligned=alignTo?el.parentElement?.querySelector<HTMLElement>(alignTo):null;
  const boundary=endBefore?el.parentElement?.querySelector<HTMLElement>(endBefore):null;
  const measure=()=>{
   const r=(aligned||el).getBoundingClientRect(),h=host.getBoundingClientRect();
   const scale=h.width/(host.offsetWidth||h.width||1);
   const visible=active&&r.width>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('[inert],.is-inactive');
   const min=document.documentElement.dataset.platform==='mac'?Math.max(206/scale,96/scale+96):110;
   const right=boundary?Math.min(r.right,boundary.getBoundingClientRect().left):r.right;
   const left=Math.max(min,(r.left-h.left)/scale),width=Math.max(0,(right-h.left)/scale-left-Math.max(0,endInset));
   setBox(old=>!visible?old===null?old:null:old?.left===left&&old?.width===width?old:{left,width});
  };
  const ro=new ResizeObserver(measure),mo=new MutationObserver(measure);
  for(let node:HTMLElement|null=el;node&&node!==document.body;node=node.parentElement){ro.observe(node);mo.observe(node,{attributes:true,attributeFilter:['class','style','inert']});}
  if(boundary){ro.observe(boundary);mo.observe(boundary,{attributes:true,attributeFilter:["class","style"]});}
  if(aligned)ro.observe(aligned);ro.observe(host);window.addEventListener('resize',measure);measure();
  return()=>{ro.disconnect();mo.disconnect();window.removeEventListener('resize',measure);};
 },[chrome?.host,chrome?.workspace,chrome?.collapsed,active,alignTo,endBefore,placement,endInset]);
 if(!chrome||placement==='content')return children;
 return <><div ref={anchor} className={(children.props.className||'')+' pane-toolbar-anchor'} aria-hidden="true"/>{active&&chrome.host&&box&&box.width>0&&createPortal(<div ref={setPortal} className="window-pane-toolbar" data-placement={placement} style={box} data-tauri-drag-region="deep">{children}{(edges.start||edges.end)&&<div className="pane-tab-scroll"><button aria-label={tr("向左滚动标签页")} title={tr("向左滚动标签页")} disabled={!edges.start} onClick={()=>step(-1)}>‹</button><button aria-label={tr("向右滚动标签页")} title={tr("向右滚动标签页")} disabled={!edges.end} onClick={()=>step(1)}>›</button></div>}</div>,chrome.host)}</>;
}
