import {createInterface} from 'node:readline';

// Cache terminal events: a fast run can finish before its RPC response arrives.
export function createBridgeClient(child,{onEvent=()=>{},callTimeout=30000,runTimeout=40*60e3}={}){
 let seq=0,failure;
 const pending=new Map(),waiters=new Map(),states=new Map();
 const key=(taskId,runId)=>JSON.stringify([taskId,runId]);
 const settle=(map,id,error,value)=>{const p=map.get(id);if(!p)return;map.delete(id);clearTimeout(p.timer);error?p.reject(error):p.resolve(value);};
 const fail=error=>{failure??=error;for(const id of pending.keys())settle(pending,id,failure);for(const id of waiters.keys())settle(waiters,id,failure);};
 const lines=createInterface({input:child.stdout});
 lines.on('line',line=>{
  let value;try{value=JSON.parse(line);}catch{return;}
  if(value.event){
   const e=value.event;
   if(e.type==='task_state'&&e.state?.runId&&!e.state.busy){
    const id=key(e.taskId,e.state.runId);states.set(id,e.state);
    if(states.size>128)states.delete(states.keys().next().value);
    settle(waiters,id,null,e.state);
   }
   onEvent(e);return;
  }
  settle(pending,value.id,value.error?Error(value.error):null,value.result);
 });
 child.on('error',fail);child.stdin.on('error',fail);
 child.on('exit',(code,signal)=>fail(Error('bridge exited: '+(signal||code))));
 function wait(map,id,timeout){return new Promise((resolve,reject)=>{
  if(failure){reject(failure);return;}
  const timer=setTimeout(()=>settle(map,id,Error(map===pending?'bridge response timeout':'run timeout')),timeout);
  map.set(id,{resolve,reject,timer});
 });}
 return {
  call(method,params={}){
   const id=++seq,result=wait(pending,id,callTimeout);
   if(!failure)try{child.stdin.write(JSON.stringify({id,method,params})+'\n');}catch(error){fail(error);}
   return result;
  },
  idleOf(taskId,runId){const id=key(taskId,runId);return states.has(id)?Promise.resolve(states.get(id)):wait(waiters,id,runTimeout);},
  async close(){
   // Let the bridge close its worker pipes before terminating it.
   if(child.exitCode!==null||child.signalCode!==null)return;
   await new Promise(resolve=>{
    const timer=setTimeout(()=>{child.kill();resolve();},2500);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
    child.stdin.end();
   });
   lines.close();
  },
 };
}
