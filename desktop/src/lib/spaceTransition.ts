import {invoke} from './nativeCore';
import { tr } from "../uiText";

export class SpaceSwitchBlockedError extends Error {}
export function spaceSwitchBlockReason(editors:{dirty:boolean;busy?:boolean}[],_runs:{busy?:boolean;queued?:boolean}[]){
 if(editors.some(editor=>editor.dirty))return tr('请先保存正在编辑的稿件，再切换空间。');
 if(editors.some(editor=>editor.busy))return tr('当前有保存、官网操作或待确认事项，请完成或取消后再切换空间。');
 return '';
}

let transition:((spaceId:string)=>Promise<void>)|undefined;
let pending:Promise<void>|undefined;
export function configureSpaceTransition(handler:(spaceId:string)=>Promise<void>){transition=handler;}
export function selectCreativeSpace(spaceId:string):Promise<void>{
 if(pending)return pending;
 pending=(transition?transition(spaceId):invoke<void>('space_select',{spaceId})).finally(()=>{pending=undefined;});
 return pending;
}

/** Only bound preparation: after native selection starts we must await its
 * outcome, otherwise a late commit could leave the UI in the previous space. */
export async function waitForSpacePreparation<T>(work:()=>Promise<T>,message:string,timeoutMs=15_000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([
   work(),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new SpaceSwitchBlockedError(message)),timeoutMs);}),
  ]);
 }finally{clearTimeout(timer);}
}

/** Drain IPC before swapping state. This intercepts the app-owned transport
 * used by workspace commands, including streamed operations. */
export function trackNativeWork(internals:{invoke:(...args:any[])=>Promise<any>}){
 const original=internals.invoke.bind(internals),work=new Set<Promise<unknown>>();
 let paused=false,epoch=0;
 internals.invoke=(command:string,...args:any[])=>{
  const [params,options]=args;
  const globalQueue=(command==='website_publish_call'&&params?.method==='queue_resume_pending')||
   (command==='cursor_agent_call'&&params?.method==='queue_status');
  if(paused&&!globalQueue&&!command.startsWith('plugin:')&&!['space_select','space_quiesce'].includes(command))return Promise.reject(Error('正在切换空间'));
  const headers=new Headers(options?.headers);if(!globalQueue)headers.set("x-today-space-epoch",String(epoch));
  const promise=original(command,params,{...options,headers});
  if(!globalQueue&&!command.startsWith('plugin:')&&!['space_select','space_quiesce'].includes(command)){
   work.add(promise);void promise.then(()=>work.delete(promise),()=>work.delete(promise));
  }
  return promise;
 };
 return {
  setEpoch(value:number){epoch=value;},
  pause(){paused=true;},resume(){paused=false;},
  async drain(){
   await waitForSpacePreparation(async()=>{
    while(work.size)await Promise.allSettled([...work]);
   },tr('当前空间仍有任务正在处理，请等任务完成后再切换'));
   // Let promise continuations finish while new app operations remain blocked.
   await new Promise(resolve=>setTimeout(resolve,0));
  },
 };
}
