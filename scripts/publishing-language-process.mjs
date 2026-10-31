import {spawn} from 'node:child_process';

// One private process group per translation. Never signal the producer's group
// or find processes by name: other authenticated agent sessions may be active.
export function languageProcess(command,args,options){
 const child=spawn(command,args,{...options,detached:process.platform!=='win32',windowsHide:true,stdio:['pipe','pipe','pipe']});
 let closed=false;
 const completion=new Promise(resolve=>{child.once('close',()=>{closed=true;resolve();});});
 child.on('error',()=>{});child.stdin.on('error',()=>{});
 const wait=ms=>new Promise(resolve=>{
  if(closed)return resolve(true);
  const timer=setTimeout(()=>resolve(false),ms);
  completion.then(()=>{clearTimeout(timer);resolve(true);});
 });
 async function signal(force){
  if(!child.pid)return;
  if(process.platform==='win32'){
   if(child.exitCode!==null||child.signalCode!==null)return;
   await new Promise(resolve=>{
    const killer=spawn('taskkill',['/PID',String(child.pid),'/T',...(force?['/F']:[])],{windowsHide:true,stdio:'ignore'});
    killer.once('error',resolve);killer.once('close',resolve);
   });
  }else{
   try{process.kill(-child.pid,force?'SIGKILL':'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
 }
 let stopping;
 return {child,stop({graceMs=3000,termMs=1000}={}){
  return stopping??=(async()=>{
   // ACP owns worker-server and language servers. EOF lets it close those
   // children itself; killing the launcher first can orphan them for minutes.
   child.stdin.end();
   if(await wait(graceMs))return {method:'eof'};
   await signal(false);
   if(await wait(termMs))return {method:'terminate'};
   await signal(true);
   if(!await wait(1000))throw Error('Language agent did not close after termination');
   return {method:'kill'};
  })();
 }};
}
