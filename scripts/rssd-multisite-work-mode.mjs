// One original Center demand through the existing worker implementation. This
// does not start a scheduler or enable any site. Caller supplies a scoped
// authenticated client and the same live readiness verifier as the scheduler.
import {join} from 'node:path';
import {withFileLock} from './editorial-lock.mjs';
import {runProductionTurn} from './rssd-production-worker.mjs';
import {produceCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';
import {compileSchedule} from './rssd-multisite-scheduler.mjs';
import {CenterOutbox} from './rssd-center-client.mjs';
import protocol from '../contracts/rssd-v1.cjs';

async function originalReceipts({client,home,slot,workId}){
 const outbox=new CenterOutbox({directory:join(home,'outbox'),client}),entries=await outbox.list(),publications=[];
 for(const locale of slot.requiredLocales){
  const matches=entries.filter(e=>e.state==='accepted'&&e.packet.demandId===slot.id&&e.packet.workId===workId&&e.packet.workspaceId===slot.workspaceId&&e.packet.sectionId===slot.sectionId&&e.packet.editions.length===1&&e.packet.editions[0].locale===locale);
  if(matches.length!==1)return null;
  const e=matches[0],r=e.receipt,edition=e.packet.editions[0],received=r?.editions?.[0];
  if(r?.status!=='accepted'||r.requestId!==e.requestId||r.workId!==workId||r.workspaceId!==slot.workspaceId||!Array.isArray(r.editions)||r.editions.length!==1||received?.locale!==locale||received.hash!==protocol.hash(edition)||received.revision!==e.packet.baseRevisions[locale]+1||!Array.isArray(r.publicationIds)||r.publicationIds.length!==1)return null;
  publications.push({id:protocol.id(r.publicationIds[0]),locale,revision:received.revision,contentHash:received.hash,requestId:e.requestId});
 }
 return publications;
}

export function createScopedWorkModeAdapter({client,home,plan,configs,profiles,ready,producer=produceCenterEdition,turn=runProductionTurn,imageStageFactory,sourceStage,daemonLockHeld=false}){
 if(!client||typeof home!=='string'||!home||![ready,producer,turn].every(x=>typeof x==='function')||imageStageFactory!==undefined&&typeof imageStageFactory!=='function')throw Error('Explicit guarded work-mode dependencies are required');
 const entries=compileSchedule(plan,configs,profiles);
 return async({slot,signal,stopSignal})=>{
  if(signal?.aborted)return {state:'cancelled',demandId:slot?.id};
  const config=entries.find(c=>c.siteId===slot?.siteId&&c.workspaceId===slot?.workspaceId&&c.sectionId===slot?.sectionId);
  if(!config||config.configHash!==slot.configHash||config.destinationId!==slot.destinationId||config.contentMode!==slot.contentMode||JSON.stringify(config.requiredLocales)!==JSON.stringify(slot.requiredLocales))return {state:'blocked',demandId:slot?.id};
  const productionScope={siteId:slot.siteId,workspaceId:slot.workspaceId,sectionId:slot.sectionId,destinationId:slot.destinationId,demandId:slot.id,agentId:'codex',modelId:'gpt-6.1-terra',requiredLocales:slot.requiredLocales,imagePlanRequired:true};
  // The same daemon lock is used by RSSD's installed continuous worker. It
  // prevents this worker from stealing an active or idle desktop session.
  const writingSkillScope={siteId:slot.siteId,workspaceId:slot.workspaceId,sectionId:slot.sectionId,mode:slot.contentMode};
  const scopedProducer=async args=>{
   let dependencies;
   if(args.imagePlanRequired&&imageStageFactory){
    const imageStage=await imageStageFactory({siteId:slot.siteId,workspaceId:slot.workspaceId,sectionId:slot.sectionId,jobId:args.claim.id});
    if(imageStage?.origin!==client.origin||typeof imageStage?.prepare!=='function')throw Error('配图服务与中心范围不匹配');
    dependencies={imageStage};
   }
   return producer({...args,writingSkillScope},dependencies);
  };
  const task=()=>turn({client,home,agentId:'codex',workspaceIds:[slot.workspaceId],sectionIds:[slot.sectionId],demandId:slot.id,productionScope,writingSkillScope,sourceStage,
   verifyReady:({phase,signal:checkSignal})=>{if(phase==='before_claim'&&stopSignal?.aborted)throw Error('已停止领取，原需求保留');return ready({slot,config,phase,signal:checkSignal});},producer:scopedProducer,signal});
  const result=daemonLockHeld?await task():await withFileLock(join(home,'daemon.lock'),task,{timeout:100});
  const submissions=result?.submissions;
  if(result?.state==='accepted'&&result.demandId===slot.id&&typeof result.workId==='string'&&Array.isArray(submissions)&&submissions.length&&submissions.every(x=>x.state==='accepted'&&x.receipt?.status==='accepted')&&submissions.some(x=>x.receipt?.demandState==='completed')){
   const publications=await originalReceipts({client,home,slot,workId:result.workId});
   if(!publications)return {state:'uncertain',demandId:slot.id};
   return {state:'submitted',demandId:slot.id,workId:result.workId,requestIds:publications.map(x=>x.requestId),publicationIds:publications.map(x=>x.id),publications};
  }
  return {state:result?.state==='blocked'?'blocked':'uncertain',demandId:slot.id};
 };
}

// No writes to Center: after taking the desktop's daemon lock, query the
// original receipt or prove that the original demand is still unclaimed and
// there is no unresolved outbox. Ambiguity remains blocked.
export function createWorkRecoveryAdapter({client,home,lookup,daemonLockHeld=false}){
 if(!client||typeof client.activeClaim!=='function'||typeof client.submission!=='function'||typeof lookup!=='function'||typeof home!=='string'||!home)throw Error('Explicit original work inspector required');
 return async({slot,demand,signal})=>{const inspect=async()=>{
  if(signal?.aborted)throw Error('Recovery cancelled');
  const claim=await client.activeClaim(),outbox=new CenterOutbox({directory:join(home,'outbox'),client}),entries=await outbox.list();
  const related=entries.filter(e=>e.packet.demandId===slot.id);
  const completed=related.filter(e=>e.state==='accepted'&&e.receipt?.demandState==='completed');
  if(completed.length===1){
   const entry=completed[0],receipt=await client.submission(entry.requestId);
   if(receipt?.status==='accepted'&&receipt.demandState==='completed'&&receipt.requestId===entry.requestId&&receipt.workId===entry.packet.workId&&receipt.workspaceId===slot.workspaceId&&protocol.hash(receipt)===protocol.hash(entry.receipt)&&Array.isArray(receipt.editions)&&receipt.editions.length===entry.packet.editions.length&&entry.packet.editions.every(e=>receipt.editions.some(r=>r.locale===e.locale&&r.hash===protocol.hash(e)&&r.revision===entry.packet.baseRevisions[e.locale]+1))){
    const publications=await originalReceipts({client,home,slot,workId:entry.packet.workId});if(publications)return {state:'submitted',demandId:slot.id,workId:entry.packet.workId,requestIds:publications.map(x=>x.requestId),publicationIds:publications.map(x=>x.id),publications};
   }
   return {state:'blocked'};
  }
  if(claim||entries.some(e=>e.state!=='accepted'))return {state:'blocked'};
  const found=await lookup(slot.id,{slot,signal});
  if(found?.state==='found'&&found.demand?.state==='queued'&&protocol.hash(protocol.demand(found.demand.payload))===protocol.hash(demand))return {state:'retry',demandId:slot.id};
  return {state:'blocked'};
 };return daemonLockHeld?inspect():withFileLock(join(home,'daemon.lock'),inspect,{timeout:100});};
}
