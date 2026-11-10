import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withFileLock} from '../../scripts/editorial-lock.mjs';
import {replenishTopics} from '../../scripts/rssd-topic-maintainer.mjs';

const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));

export function assertAutomaticTopicScope(params){
  if(params.autoTopics!==true)return false;
  if(params.agentId!=='codex'||params.once||params.demandId||params.workspaceIds?.length!==1||params.workspaceIds[0]!=='metho'||params.sectionIds?.length!==1||params.sectionIds[0]!=='methods')throw Error('自动选题仅支持研究方法的方法百科栏目和 Codex 连续工作模式');
  return true;
}

// Called only after the worker finds no claimable demand. A file lock and
// saved intent make the limit durable across worker/process restarts.
export async function automaticTopicTick({client,home,shouldStop=async()=>false,clock=Date.now},{replenish=replenishTopics,adapters}={}){
  const time=()=>{const value=clock();if(!Number.isFinite(value))throw Error('自动选题时间无效');return value;};
  return withFileLock(join(home,'topic-auto.lock'),async()=>{
    const saved=await read(join(home,'topic-maintainer.json'));
    if(saved&&(saved.version!==1||saved.workspaceId!=='metho'||saved.sectionId!=='methods'||!Array.isArray(saved.entries)))throw Error('自动选题状态范围不匹配');
    const entries=saved?.entries||[];
    if(entries.some(e=>!['pending','accepted'].includes(e.status)||!Number.isFinite(Date.parse(e.createdAt))))throw Error('自动选题状态损坏，请核对原请求');
    const pending=entries.some(e=>e.status==='pending');
    const started=time();let used=entries.filter(e=>day(e.createdAt)===day(started)).length;
    // Always reconcile the original pending request, even when today's quota
    // is exhausted. Never allocate another ID for an uncertain request.
    if(!pending&&used>=2)return {state:'daily_limit',used};
    if(await shouldStop())return {state:'stopped',used};
    const guardedClient={...client,createDemand:async payload=>{if(await shouldStop())throw Error('自动选题已停止，原请求保留待核对');return client.createDemand(payload);}};
    let dependencies={};
    if(!pending){
      const factory=adapters||((await import('../../scripts/rssd-topic-adapters.mjs')).createTopicAdapters);
      dependencies=await factory({home});
    }
    const checked=time();if(checked<started)throw Error('自动选题时间发生回退，请核对系统时间');
    used=entries.filter(e=>day(e.createdAt)===day(checked)).length;
    if(!pending&&used>=2)return {state:'daily_limit',used};
    // The model and evidence checks can cross midnight. Recheck inside the
    // maintainer lock immediately before staging, using the same clock as the
    // persisted creation timestamp. Recovery of an existing ID bypasses this.
    const beforeStage=async({entries:current})=>{
      const stagedAt=time();if(stagedAt<checked)throw Error('自动选题时间发生回退，请核对系统时间');
      if(!Array.isArray(current)||current.some(e=>!['pending','accepted'].includes(e.status)||!Number.isFinite(Date.parse(e.createdAt))))throw Error('自动选题状态损坏，请核对原请求');
      if(current.filter(e=>day(e.createdAt)===day(stagedAt)).length>=2)throw Error('当日自动选题已达到上限');
      used=current.filter(e=>day(e.createdAt)===day(stagedAt)).length;
      return new Date(stagedAt).toISOString();
    };
    const result=await replenish({client:guardedClient,home,workspaceId:'metho',sectionId:'methods',requiredLocales:['zh-CN'],count:1,...dependencies,now:checked,beforeStage});
    return {state:pending?'recovered':'created',used:pending?used:used+1,result};
  },{timeout:100});
}
