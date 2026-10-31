import {selectCreativeSpace,SpaceSwitchBlockedError,waitForSpacePreparation} from '../lib/spaceTransition';
import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject} from 'react';
import {invoke, isTauri} from '../lib/nativeCore';
import {useDismiss} from '../hooks/useDismiss';
import {useMenuKeyboard} from '../hooks/useMenuKeyboard';
import {clampToViewport} from '../lib/viewport';
import Icon from './Icon';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import profiles from '../../../sites/profiles.json';
import branding from '../../../sites/branding/manifest.json';

import { tr } from "../uiText";
const images = import.meta.glob('../../../sites/branding/*.{png,jpg,webp,svg}', {eager:true, query:'?url', import:'default'}) as Record<string,string>;
type Space = {id:string;siteId:string;name:string;domain:string;origin:string};
export function spaceLogo(siteId:string){
 const brand=branding[siteId as keyof typeof branding];
 return brand ? images['../../../sites/branding/'+brand.file] : undefined;
}

// Use the existing save/flush contract. No writing workflow or publishing action
// is started by selecting a space; the active runtime is switched in this window.
export async function openCreativeSpace(spaceId:string){
 const promises:Promise<unknown>[]=[];
 window.dispatchEvent(new CustomEvent('scholay-workbench-flush',{detail:{promises}}));
 window.dispatchEvent(new CustomEvent('scholay-space-will-switch',{detail:{promises}}));
 await waitForSpacePreparation(()=>Promise.all(promises),tr('保存当前空间超时，尚未切换。请等保存或创作任务结束后重试。'));
 await selectCreativeSpace(spaceId);
}

function SpaceMark({space}:{space:Space}){
 const logo=spaceLogo(space.siteId);
 return logo?<img className={space.siteId==='scholay-today'?'space-logo-academic':'space-logo-site'} src={logo} alt="" width="28" height="28"/>:<span aria-hidden="true">{space.name.slice(0,1)}</span>;
}

function SpaceMenu({id,spaces,container,trigger,onClose,onChoose}:{id:string;spaces:Space[];container:RefObject<HTMLDivElement|null>;trigger:RefObject<HTMLButtonElement|null>;onClose:()=>void;onChoose:(space:Space)=>void}){
 const ref=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState({left:0,top:0});
 useDismiss(container,onClose,{onFocusOut:true});
 const onKeyDown=useMenuKeyboard(ref);
 useLayoutEffect(()=>{
  const positionMenu=()=>{
   if(!ref.current||!trigger.current)return;
   const anchor=trigger.current.getBoundingClientRect(),menu=ref.current.getBoundingClientRect();
   const scale=Number.parseFloat(getComputedStyle(document.documentElement).zoom)||1;
   setPosition(clampToViewport({x:anchor.right/scale+8,y:anchor.top/scale,width:menu.width/scale,height:menu.height/scale,viewportWidth:window.innerWidth/scale,viewportHeight:window.innerHeight/scale}));
  };
  positionMenu();
  window.addEventListener('resize',positionMenu);
  return()=>window.removeEventListener('resize',positionMenu);
 },[trigger,spaces]);
 // The shared overlay observer suspends native reader pages for .ctx-menu.
 return <div id={id} ref={ref} className="ctx-menu space-switch-menu" role="menu" aria-label={tr("切换创作空间")} style={position} onKeyDown={onKeyDown}>
  <div className="space-switch-heading">{tr("切换创作空间")}</div>
  {spaces.map(space=><button key={space.id} type="button" className="space-switch-option" role="menuitem" tabIndex={-1} aria-current={space.id===ACTIVE_SITE.spaceId?true:undefined} onClick={()=>onChoose(space)}>
   <span className="space-switch-logo"><SpaceMark space={space}/></span>
   <span className="space-switch-info"><strong>{space.name}</strong><small>{new URL(space.origin).hostname}</small></span>
   {space.id===ACTIVE_SITE.spaceId&&<span className="space-switch-current"><Icon name="check" size={15}/><span className="workspace-rail-label">{tr("当前空间")}</span></span>}
  </button>)}
 </div>;
}

export default function SpaceEntrances({disabled}:{disabled:boolean}){
 const current:Space={id:ACTIVE_SITE.spaceId,siteId:ACTIVE_SITE.id,name:ACTIVE_SITE.name,domain:ACTIVE_SITE.domain,origin:ACTIVE_SITE.origin};
 const [spaces,setSpaces]=useState<Space[]>(()=>isTauri()?[current]:profiles.map(s=>({id:s.spaceId,siteId:s.id,name:s.name,domain:s.domain,origin:s.origin})));
 const [open,setOpen]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const switching=useRef(false);
 const blockedError=useRef(false);
 const container=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const menuId=useId();
 const active=spaces.find(space=>space.id===current.id)??current;
 const menuOpen=open&&!disabled&&!busy;
 const closeMenu=useCallback(()=>setOpen(false),[]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{const unblocked=()=>{if(blockedError.current){blockedError.current=false;setError('');}};window.addEventListener('scholay-space-switch-unblocked',unblocked);return()=>window.removeEventListener('scholay-space-switch-unblocked',unblocked);},[]);
 useEffect(()=>{
  if(!isTauri())return;
  let disposed=false;
  const refresh=()=>{void invoke<{spaces:Space[]}>('space_context').then(c=>{if(!disposed)setSpaces(c.spaces);}).catch(e=>{if(!disposed)setError(String(e));});};
  refresh();window.addEventListener('scholay-spaces-changed',refresh);
  return()=>{disposed=true;window.removeEventListener('scholay-spaces-changed',refresh);};
 },[]);
 async function choose(space:Space){
  if(disabled||switching.current)return;
  closeMenu();
  if(space.id===ACTIVE_SITE.spaceId)return;
  switching.current=true;setBusy(true);setError('');
  try{await openCreativeSpace(space.id);}catch(e){blockedError.current=e instanceof SpaceSwitchBlockedError;setError(tr("切换未完成：{{value}}", {value: (e instanceof Error?e.message:String(e))}));}finally{switching.current=false;setBusy(false);}
 }
 return <div ref={container} className="space-entrances" role="group" aria-label={tr("创作空间")}>
  <button ref={trigger} type="button" className="space-entrance" aria-label={tr("{{name}} · 切换创作空间", {name: active.name})}
   aria-controls={menuId} aria-haspopup="menu" aria-expanded={menuOpen}
   data-tooltip={menuOpen?undefined:tr('{{name}} · 切换创作空间',{name:active.name})}
   disabled={disabled||busy} onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);}}}>
   <SpaceMark space={active}/>
   <span className="space-current-name">{active.name}</span>
   <span className="space-switch-indicator"><Icon name="chevron-down" size={9}/></span>
   <span className="workspace-rail-label">{tr("切换创作空间")}</span>
  </button>
  {menuOpen&&<SpaceMenu id={menuId} spaces={spaces} container={container} trigger={trigger} onClose={closeMenu} onChoose={space=>void choose(space)}/>}
  {busy&&<span className="workspace-rail-label" role="status">{tr("正在保存并切换空间…")}</span>}
  {error&&<div className="space-switch-error" role="alert">{error}<button type="button" onClick={()=>setError('')}>{tr("关闭")}</button></div>}
 </div>;
}
