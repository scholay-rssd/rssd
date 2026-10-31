import {watch} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {withFileLock} from './editorial-lock.mjs';

// A filesystem notification wakes the existing Postiz transport, never an AI.
// Only unresolved provider acknowledgements receive bounded, backed-off reads.
export async function watchPostiz({directory,tick,emit=console.log,signal}){
 await mkdir(join(directory,'outbox'),{recursive:true,mode:0o700});
 return withFileLock(join(directory,'watch.lock'),async()=>{
  let busy=false,again=false,timer,previous='',delay=15000;
  const schedule=ms=>{clearTimeout(timer);timer=setTimeout(run,ms);};
  async function run(){
   if(signal?.aborted)return;if(busy){again=true;return;}busy=true;
   try{const results=await tick(),summary=results.map(r=>({id:r.id,status:r.status,delivery:r.delivery?.mode,url:r.status==='draft_saved'?undefined:r.url,...(r.status==='draft_saved'?{complete:true,public:false}:r.status==='verified'?{complete:true,public:true}:{}),error:r.error||r.readbackError})),state=JSON.stringify(summary);
    if(state!==previous){emit(state);previous=state;}
    const pending=results.filter(r=>['unknown','submitted','deferred'].includes(r.status));
    if(pending.length){const onlyTimed=pending.every(r=>r.status==='deferred'&&r.retryAt);schedule(onlyTimed?Math.max(1000,Math.min(...pending.map(r=>r.retryAt-Date.now()),300000)):delay);delay=Math.min(delay*2,300000);}else delay=15000;
   }catch(e){emit(JSON.stringify({status:'deferred',error:e.message}));schedule(300000);}finally{busy=false;if(again){again=false;schedule(1000);}}
  }
  const watcher=watch(join(directory,'outbox'),(_event,name)=>{if(!name||String(name).endsWith('.json'))schedule(1000);});
  // Some platforms coalesce events while the native watcher starts. One
  // catch-up scan closes that window; an idle watcher has no repeating scan.
  const startup=setTimeout(run,1000);
  const stopped=new Promise(resolve=>{if(signal?.aborted)resolve();else signal?.addEventListener('abort',resolve,{once:true});});
  try{await run();await stopped;}finally{watcher.close();clearTimeout(startup);clearTimeout(timer);while(busy)await new Promise(resolve=>setTimeout(resolve,20));}
 },{timeout:100});
}
