import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {authoringQueueJob,recoverQueuedTask} from './task-queue.mjs';
const json=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return null;}};
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
// Read only: no TaskStore migrations, credential access, bridge launch or AI.
export async function authoringQueueSnapshot(data){
 const registry=await json(join(data,'spaces.json')),jobs=[];
 for(const site of registry?.sites||[]){
  if(typeof site.spaceId!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(site.spaceId))continue;
  const state=site.legacy?data:join(data,'spaces',site.spaceId),preference=await json(join(state,'editorial-workspace.json'));
  const workspace=typeof preference?.path==='string'?preference.path:join(state,'workspace');
  const tasks=join(workspace,'.local','workbench','tasks');
  for(const id of await readdir(tasks).catch(()=>[])){
   if(!/^[a-zA-Z0-9-]{3,100}$/.test(id))continue;
   const admission=await json(join(tasks,id,'queue-admission.json'));
   const task=await json(join(tasks,id,'task.json'))||await json(join(tasks,id,'recovery.json'))||admission?.taskSnapshot;if(!task||task.id!==id||task.deleted||task.archived)continue;
   const runtime=task.runtime||{};let state={};
   if((runtime.busy||runtime.queued||admission)&&!alive(runtime.coordinatorPid)){
    const session=await json(join(tasks,id,'cursor','session.json')),recovery=recoverQueuedTask(task,session,admission);
    if(recovery)state=recovery.kind==='queued'?{runId:recovery.runId,busy:false,queued:true,status:'排队中，打开此空间后继续'}:
     recovery.kind==='settled'?{runId:recovery.runId,busy:false,queued:false,status:recovery.status,recoveryRequired:false}:
     {runId:recovery.runId,busy:false,queued:false,status:recovery.status,recoveryRequired:true};
   }
   const job=authoringQueueJob(task,state,{spaceId:site.spaceId,siteId:site.id,spaceName:site.name});if(job)jobs.push(job);
  }
 }
 return {jobs};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 authoringQueueSnapshot(resolve(process.argv[2])).then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
