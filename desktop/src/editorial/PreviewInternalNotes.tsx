import {useEffect,useLayoutEffect,useRef,useState,type HTMLAttributes,type RefObject} from 'react';
import type {PrivateEditorialData,BlockInternalNotes} from '../../../contracts/article-internal-notes.mjs';
import {invoke} from '../lib/nativeCore';
import {useHtmlMarkup} from '../lib/htmlMarkup';
import NotebookInternalNotes from './NotebookInternalNotes';
import {locatePreviewNotes,matchesPreviewAnchor,previewElementMatches,type PreviewAnchor} from './previewNoteAnchors';
import {tr} from '../uiText';
import './preview-internal-notes.css';

type CloudNotes={source:'local'|'cloud'|'unsupported';revision:number|null;privateEditorial:PrivateEditorialData|null};
/** A cloud work's notes come through the publisher, which reads this Mac's file
 *  or the site's private archive written by any machine. */
export function usePrivateNotes(articleId:string,version:unknown,cloudRevision?:number){
 const [state,setState]=useState<{id:string;version:unknown;data:PrivateEditorialData|null;error:string;notice?:string;cloudRevision?:number}>();
 useEffect(()=>{
  if(!articleId)return;
  let obsolete=false;
  const load=cloudRevision===undefined
   ?invoke<PrivateEditorialData|null>('editorial_call',{method:'draft_private_notes',params:{id:articleId}}).then(data=>({data,notice:''}))
   :invoke<CloudNotes>('website_publish_call',{method:'private_notes',params:{id:articleId,revision:cloudRevision}}).then(x=>({data:x.privateEditorial,notice:x.source==='unsupported'?tr('官网暂不支持读取其他设备的作者备注'):x.source==='cloud'&&x.revision&&x.revision!==cloudRevision?tr('作者备注来自 v{{revision}}',{revision:x.revision}):''}));
  void load.then(({data,notice})=>{
   if(!obsolete)setState({id:articleId,version,cloudRevision,data:data&&(data.internalNotes||data.blockNotes||data.modelSignatures)?data:null,error:'',notice});
  }).catch(error=>{if(!obsolete)setState({id:articleId,version,cloudRevision,data:null,error:/Article not found/.test(String(error))?'':String(error)});});
  return()=>{obsolete=true;};
 },[articleId,version,cloudRevision]);
 return state&&state.id===articleId&&state.version===version&&state.cloudRevision===cloudRevision?state:undefined;
}
type Point={id:string;left:number;top:number;notes?:BlockInternalNotes[string]['notes']};
type Placement={key:unknown;points:Point[];unplaced:BlockInternalNotes};
function NotesError({error,inline=false}:{error?:string;inline?:boolean}){
 return error?<span className={'preview-internal-error'+(inline?' is-inline':'')} role="status" title={error}>{tr('内部备注读取失败：{{error}}',{error})}</span>:null;
}
function Overlay({data,error,placement}:{data?:PrivateEditorialData|null;error?:string;placement?:Placement}){
 return <div className="preview-internal-overlay" data-visibility="private">
  <NotesError error={error}/>
  {data&&placement?.points.map(point=><span className="preview-internal-position" key={point.id} data-preview-note-id={point.id} style={{left:point.left,top:point.top}}><NotebookInternalNotes label={tr(point.id==='__title'?'作者备注':'行间备注')} notes={point.id==='__title'?data.internalNotes:point.notes} signatures={point.id==='__title'?data.modelSignatures:undefined} unplaced={point.id==='__title'?placement.unplaced:undefined}/></span>)}
 </div>;
}
function observeLayout(element:HTMLElement,measure:()=>void){
 const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(element);
 element.addEventListener('load',measure,true);window.addEventListener('resize',measure);
 return()=>{observer?.disconnect();element.removeEventListener('load',measure,true);window.removeEventListener('resize',measure);};
}

/** The annotation layer is a sibling of the public HTML. Copy/export keep using
 * the original HTML string, and the popovers live outside the article DOM. */
export default function PrivateHtmlPreview({articleId,html,cloudRevision,className='',...props}:{articleId:string;html:string;cloudRevision?:number}&HTMLAttributes<HTMLDivElement>){
 const host=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null),markup=useHtmlMarkup(html);
 const state=usePrivateNotes(articleId,html,cloudRevision),[placement,setPlacement]=useState<Placement>();
 useLayoutEffect(()=>{
  if(!state?.data||!host.current||!content.current)return;
  const parent=host.current,body=content.current;
  const targets=[...body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,blockquote,ul,ol,li,table,figure,figcaption,img')];
  const {located,unplaced}=locatePreviewNotes(state.data,targets,previewElementMatches);
  const measure=()=>{
   const base=parent.getBoundingClientRect();
   const point=(id:string,target:Element,notes?:Point['notes']):Point=>{const r=target.getBoundingClientRect();return {id,left:r.left-base.left-22,top:r.top-base.top+2,notes};};
   setPlacement({key:state,unplaced,points:[point('__title',body.querySelector('h1')||body),...located.map(({id,entry,target})=>point(id,target,entry.notes))]});
  };
  measure();return observeLayout(body,measure);
 },[state,html]);
 return <div {...props} ref={host} className={'private-preview-shell '+className}><NotesError error={state?.error} inline/>{state?.notice&&<span className="preview-internal-notice" role="status">{state.notice}</span>}<div ref={content} className="private-preview-content" dangerouslySetInnerHTML={markup}/><Overlay data={state?.data} placement={placement?.key===state?placement:undefined}/></div>;
}

export type CardPreviewBlock={id:string;tag?:string;text?:string;src?:string;heading:boolean};
export type CardPreviewPosition={id:string;left:number;top:number};
export function CardPreviewInternalNotes({articleId,version,stage,image,blocks,positions,width,height,firstPage,visible}:{articleId:string;version:string;stage:RefObject<HTMLDivElement|null>;image:RefObject<HTMLImageElement|null>;blocks:CardPreviewBlock[];positions:CardPreviewPosition[];width:number;height:number;firstPage:boolean;visible:boolean}){
 const state=usePrivateNotes(articleId,version),[placement,setPlacement]=useState<Placement>();
 useLayoutEffect(()=>{
  if(!state?.data||!stage.current||!image.current||!visible)return;
  const parent=stage.current,paper=image.current;
  const {located,unplaced}=locatePreviewNotes(state.data,blocks,(anchor:PreviewAnchor,target)=>!!target.tag&&matchesPreviewAnchor(anchor,{tag:target.tag,text:target.text||'',src:target.src}));
  const measure=()=>{
   const base=parent.getBoundingClientRect(),r=paper.getBoundingClientRect(),sx=r.width/width,sy=r.height/height;
   const at=(id:string,left:number,top:number,notes?:Point['notes']):Point=>({id,left:r.left-base.left+parent.scrollLeft+left*sx-22,top:r.top-base.top+parent.scrollTop+top*sy,notes});
   const points:Point[]=firstPage?[at('__title',70,136)]:[];
   for(const {id,entry,target} of located){const position=positions.find(p=>p.id===target.id);if(position)points.push(at(id,position.left,position.top,entry.notes));}
   setPlacement({key:state,unplaced,points});
  };
  measure();const stop=observeLayout(parent,measure),observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(paper);
  return()=>{stop();observer?.disconnect();};
 },[state,positions,blocks,width,height,firstPage,visible,stage,image]);
 return <Overlay data={visible?state?.data:null} error={state?.error} placement={placement?.key===state?placement:undefined}/>;
}
