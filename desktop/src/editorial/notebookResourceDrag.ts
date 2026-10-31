import type {ResourceDrop} from './notebookResources';

export type ResourceDragState={x:number;y:number;drop:ResourceDrop|null;line:number};
/** External resources use pointer capture so a long press also works in WebKit. */
export function startResourceDrag({event,handle,paper,units,onChange,onDrop}:{event:PointerEvent;handle:HTMLElement;paper:HTMLElement;units:string[][];onChange:(state:ResourceDragState|null)=>void;onDrop:(drop:ResourceDrop)=>void}){
 const doc=paper.ownerDocument,win=doc.defaultView!;
 let x=event.clientX,y=event.clientY,active=false,finished=false,frame=0,drop:ResourceDrop|null=null;
 function update(){
  const bounds=paper.getBoundingClientRect(),scale=bounds.height/(paper.clientHeight||bounds.height||1);
  drop=null;let line=16;
  if(x>=bounds.left&&x<=bounds.right&&y>=bounds.top&&y<=bounds.bottom){
   const rows=new Map([...paper.querySelectorAll<HTMLElement>('[data-block-id]')].map(row=>[row.dataset.blockId!,row]));
   const boxes=units.flatMap(unit=>{const first=rows.get(unit[0]),last=rows.get(unit.at(-1)!);return first&&last?[{unit,top:first.getBoundingClientRect().top,bottom:last.getBoundingClientRect().bottom}]:[];});
   const box=boxes.find(box=>y<box.bottom)||boxes.at(-1);
   if(box){const before=y<(box.top+box.bottom)/2;drop={id:before?box.unit[0]:box.unit.at(-1),edge:before?'before':'after'};line=((before?box.top:box.bottom)-bounds.top)/scale+paper.scrollTop;}
   else if(!units.length){drop={edge:'after'};line=64;}
  }
  onChange({x,y,drop,line});
 }
 function tick(){
  if(finished||!active)return;
  if(!paper.isConnected||!handle.isConnected){finish(false);return;}
  const r=paper.getBoundingClientRect(),edge=Math.min(48,r.height/4);
  if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom){const delta=y<r.top+edge?-Math.ceil((r.top+edge-y)/4):y>r.bottom-edge?Math.ceil((y-r.bottom+edge)/4):0;if(delta)paper.scrollTop+=delta;}
  update();frame=win.requestAnimationFrame(tick);
 }
 function activate(){if(active||finished)return;active=true;update();frame=win.requestAnimationFrame(tick);}
 const timer=win.setTimeout(activate,300);
 function move(e:PointerEvent){if(e.pointerId!==event.pointerId)return;if(e.buttons===0){finish(false);return;}x=e.clientX;y=e.clientY;if(!active&&Math.hypot(x-event.clientX,y-event.clientY)>=6)activate();if(active){e.preventDefault();update();}}
 function up(e:PointerEvent){if(e.pointerId!==event.pointerId)return;x=e.clientX;y=e.clientY;if(active){e.preventDefault();update();}finish(true);}
 function cancel(e:PointerEvent){if(e.pointerId===event.pointerId)finish(false);}
 function key(e:KeyboardEvent){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}}
 const blur=()=>finish(false);
 function finish(commit:boolean){
  if(finished)return;finished=true;win.clearTimeout(timer);win.cancelAnimationFrame(frame);
  doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',cancel,true);handle.removeEventListener('lostpointercapture',cancel);win.removeEventListener('keydown',key,true);win.removeEventListener('blur',blur);
  try{if(handle.hasPointerCapture?.(event.pointerId))handle.releasePointerCapture(event.pointerId);}catch{/* WebKit may already have released capture. */}
  onChange(null);if(commit&&active&&drop)onDrop(drop);
 }
 doc.addEventListener('pointermove',move,{capture:true,passive:false});doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',cancel,true);handle.addEventListener('lostpointercapture',cancel);win.addEventListener('keydown',key,true);win.addEventListener('blur',blur);
 try{handle.setPointerCapture?.(event.pointerId);}catch{/* No native pointer in DOM tests. */}
 return ()=>finish(false);
}
