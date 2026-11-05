// The task lifecycle as host-independent rules. A task is planned as a Center demand (`brief`), then produced
// through topic, outline, draft and deliver. It moves forward only through two confirmations, and a stage counts
// as done only when a saved artifact from the run that the confirmation started passes its checks: an agent
// saying "done" is never evidence. Ported from the desktop workbench (desktop/src/editorial/workflowLifecycle.ts,
// TaskCanvas.tsx and topicSlots.ts), which still enforces the same rules in its UI.
import {isSingleTopicMode} from './task-modes.mjs';

export const STEPS=Object.freeze(['brief','topic','outline','draft','deliver']);
// Old tasks stored a separate review stage; review now happens while editing.
const LEGACY_STEPS={review:'draft'};

export function normalizeStep(step){
 const value=LEGACY_STEPS[step]||step;
 if(!STEPS.includes(value))throw Error('Unknown workflow step: '+step);
 return value;
}
/** An ended task is read-only; continuing means a new task. */
export const isReadOnly=task=>!!task?.completedAt;

const chosen=item=>item.selected??!item.excluded;
/** Smart slots that no material has filled yet. */
export const pendingSmartSlots=board=>(board?.sections||[]).reduce((n,s)=>n+(s.slots||[]).filter(slot=>slot.mode==='smart'&&!s.items.some(i=>i.id===slot.id)).length,0);
export const chosenMaterialCount=board=>(board?.sections||[]).reduce((n,s)=>n+s.items.filter(chosen).length,0);

/** Confirming the topic: at least one chosen material (exactly one for single-topic modes) and every smart slot filled or deleted. */
export function topicGate(task){
 if(isReadOnly(task))return {ok:false,reasons:['read_only']};
 const reasons=[],count=chosenMaterialCount(task.board);
 if(pendingSmartSlots(task.board))reasons.push('pending_smart_slots');
 if(!count)reasons.push('no_material');
 else if(isSingleTopicMode(task.mode)&&count>1)reasons.push('too_many_materials');
 return {ok:!reasons.length,reasons};
}
/** Confirming the outline needs a confirmed topic and at least one block. */
export function outlineGate(task){
 if(isReadOnly(task))return {ok:false,reasons:['read_only']};
 const reasons=[];
 if(!task.topicConfirmed)reasons.push('topic_unconfirmed');
 if(!task.outline?.blocks?.length)reasons.push('empty_outline');
 return {ok:!reasons.length,reasons};
}
/** Whether generation of `target` may start; both generations also need the task's AI authorization. */
export function generationGate(task,target){
 if(isReadOnly(task))return {ok:false,reasons:['read_only']};
 const reasons=[];
 if(!task.topicConfirmed)reasons.push('topic_unconfirmed');
 if(target==='draft'&&!task.outlineConfirmed)reasons.push('outline_unconfirmed');
 if(!task.workflow?.authorized)reasons.push('not_authorized');
 return {ok:!reasons.length,reasons};
}

/**
 * Whether the run that a confirmation started has left a valid saved artifact. `pending` records that run
 * (action, confirmation, revision and, for a draft, the previous generation time); `check` is the saved
 * manuscript's validation. Image placeholders stay valid while editing.
 */
export function artifactReady(pending,task,check){
 if(isReadOnly(task))return false;
 if(pending.action==='outline'){
  const titles=task.outline.titleCandidates,selected=task.outline.selectedTitle??0;
  return !!task.topicConfirmed&&(!pending.confirmation||task.topicConfirmed===pending.confirmation)&&task.revision>pending.revision
   &&!!titles?.length&&!!titles[selected]?.trim()
   &&task.outline.blocks.some(b=>b.type==='paragraph'&&!!b.text.trim())&&task.outline.blocks.every(b=>!b.stale&&!!b.text.trim());
 }
 const generated=task.generated;
 return !!task.outlineConfirmed&&(!pending.confirmation||task.outlineConfirmed===pending.confirmation)&&!task.draftStale
  &&task.workIds.includes(task.articleId)&&!!generated?.sha&&!!generated.at&&generated.at!==pending.generatedAt&&generated.revision>=pending.revision
  &&check?.sha256===generated.sha&&!!check.checks.find(c=>c.key==='body')?.ok&&check.checks.filter(c=>c.key==='record').every(c=>c.ok);
}
