// Opt-in runtime orchestration. The caller owns the authenticated Center
// client, verified per-site configuration and scoped work-mode implementation.
// Default invocation never contacts a service or starts a loop.
import {join} from 'node:path';
import {withFileLock} from './editorial-lock.mjs';
import {captureScheduleTick,dispatchScheduledSlot,runNextScheduledWork,reconcileScheduledWork,checkScheduledPublication} from './rssd-multisite-scheduler.mjs';

const sleep=(ms,signal)=>new Promise(resolve=>{
 if(signal.aborted)return resolve();const timer=setTimeout(done,ms);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});
});

export async function runMultisiteSupervisor({enabled=false,plan,configs,profiles,connection,home,adapter,runWork,reconcileWork,inspectPublication,signal,clock=Date.now,captureEveryMs=30000,dispatchEveryMs=5000,workEveryMs=5000,publicationEveryMs=30000,onEvent=()=>{}}={}){
 if(enabled!==true)return {state:'disabled'};
 if(!signal||typeof signal.addEventListener!=='function'||typeof home!=='string'||!home||!adapter||!['ready','lookup','enqueue','prepare'].every(k=>typeof adapter[k]==='function')||typeof runWork!=='function'||typeof onEvent!=='function')throw Error('Explicit scheduler, readiness, work-mode and cancellation are required');
 for(const value of [captureEveryMs,dispatchEveryMs,workEveryMs,publicationEveryMs])if(!Number.isSafeInteger(value)||value<1000||value>300000)throw Error('Invalid scheduler interval');
 if(signal.aborted)return {state:'cancelled'};
 const inner=new AbortController(),cancel=()=>inner.abort();signal.addEventListener('abort',cancel,{once:true});
 // A stop immediately ends capture and dispatch but lets an already-running
 // article finish and retain its original submission identity.
 const activeWork=new AbortController();
 const common={plan,configs,profiles,connection,home,clock,signal:inner.signal};
 try{return await withFileLock(join(home,'multisite-supervisor.lock'),async()=>{
  const loop=async(type,interval,action)=>{let previous='';while(!inner.signal.aborted){
   const result=await action();const event={type,state:result.state||null,id:result.id||null,reason:result.reason||null,captured:result.captured?.length,missed:result.missed?.length};const signature=JSON.stringify(event);
   if(signature!==previous){onEvent(event);previous=signature;}if(!inner.signal.aborted)await sleep(interval,inner.signal);
  }};
  const tasks=[
   loop('capture',captureEveryMs,()=>captureScheduleTick(common)),
   loop('dispatch',dispatchEveryMs,()=>dispatchScheduledSlot({...common,ready:adapter.ready,lookup:adapter.lookup,enqueue:adapter.enqueue,prepare:adapter.prepare})),
   loop('work',workEveryMs,async()=>{
    const result=await runNextScheduledWork({connection,home,clock,signal:inner.signal,workSignal:activeWork.signal,runWork});
    if(result.reason==='previous_work_needs_reconciliation'&&typeof reconcileWork==='function'){
     const reconciled=await reconcileScheduledWork({connection,home,clock,signal:inner.signal,inspect:reconcileWork});return reconciled.state==='idle'?result:reconciled;
    }
    return result;
   }),
   ...(typeof inspectPublication==='function'?[loop('publication',publicationEveryMs,()=>checkScheduledPublication({connection,home,clock,signal:inner.signal,inspect:inspectPublication}))]:[]),
  ].map(task=>task.catch(error=>{inner.abort();throw error;}));
  const results=await Promise.allSettled(tasks),failed=results.find(x=>x.status==='rejected');if(failed)throw failed.reason;return {state:'stopped'};
 },{timeout:100});}finally{signal.removeEventListener('abort',cancel);}
}
