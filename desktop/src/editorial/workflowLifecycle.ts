import type {TaskMode,TaskRunState,WorkbenchTask,WorkflowCheck,WorkflowPending,WorkflowStep} from './taskWorkbench';
import {taskType} from '../../scripts/agent/task-types.mjs';
import { tr, trKey } from "../uiText";

export function pendingRunPhase(pending:WorkflowPending,run:TaskRunState,allowPrevious=false):'waiting'|'complete'|'failed'|'replaced'{
 if(!run.runId)return 'waiting';
 if(run.runId!==pending.runId)return allowPrevious&&run.runId===pending.previousRunId?'waiting':'replaced';
 if(run.busy||run.queued)return 'waiting';
 const status=run.lastRunStatus||run.status||'';
 if(status==='已完成')return 'complete';
 return /停止|异常|失败|error|超时|中断|断开|连接已结束/i.test(status)?'failed':'waiting';
}

// The run ending is insufficient: verify the persisted artifact belongs to the
// confirmation that started it. Image placeholders remain valid during editing.
export function workflowArtifactReady(pending:WorkflowPending,task:WorkbenchTask,check?:WorkflowCheck):boolean{
 if(task.completedAt)return false;
 if(pending.action==='outline'){
  const titles=task.outline.titleCandidates,selected=task.outline.selectedTitle??0;
  return !!task.topicConfirmed&&(!pending.confirmation||task.topicConfirmed===pending.confirmation)&&task.revision>pending.revision&&!!titles?.length&&!!titles[selected]?.trim()&&task.outline.blocks.some(b=>b.type==='paragraph'&&!!b.text.trim())&&task.outline.blocks.every(b=>!b.stale&&!!b.text.trim());
 }
 const generated=task.generated;
 return !!task.outlineConfirmed&&(!pending.confirmation||task.outlineConfirmed===pending.confirmation)&&!task.draftStale&&task.workIds.includes(task.articleId)&&!!generated?.sha&&!!generated.at&&generated.at!==pending.generatedAt&&generated.revision>=pending.revision&&check?.sha256===generated.sha&&!!check.checks.find(c=>c.key==='body')?.ok&&check.checks.filter(c=>c.key==='record').every(c=>c.ok);
}

export function pendingStageMessage(pending:WorkflowPending,invalid=false){
 return tr(invalid?(pending.action==='outline'?'本次未返回完整大纲，现有内容已保留；请重试。':'本次未返回完整正文，现有内容已保留；请重试。'):(pending.action==='outline'?'生成未完成，现有内容已保留；请重试。':'正文未完成，现有内容已保留；请重试。'));
}

export function workflowPlaceholderLabels(mode:TaskMode,step:WorkflowStep):string[]{
 const record=taskType(mode)?.recordLabels||null;
 if(step==='outline')return record?[trKey('标题候选'),...record]:[trKey('标题候选'),trKey('摘要'),trKey('正文结构'),trKey('插图占位')];
 if(step==='draft')return record||[trKey('正文编辑'),trKey('配图占位')];
 if(step==='review')return record||[trKey('正文编辑'),trKey('配图占位')];
 return [trKey('稿件预览'),trKey('保存位置')];
}

export type StageGate={title:string;detail:string;checks:{label:string;ok:boolean}[];primary?:{label:string;generate?:'outline'|'draft';go?:WorkflowStep;disabled?:boolean}};
/** What an empty 生成/编辑/交稿 stage should say and offer, derived from the same gates the toolbar buttons use. */
export function workflowStageGate(task:WorkbenchTask,step:WorkflowStep,loading:boolean):StageGate{
 const topic=!!task.topicConfirmed,outline=!!task.outlineConfirmed,authorized=!!task.workflow?.authorized;
 if(step==='outline'){
  const checks=[{label:trKey('选题已确认'),ok:topic},{label:trKey('已授权 AI 生成'),ok:authorized}];
  if(loading)return {title:trKey('正在生成大纲'),detail:trKey('根据已确认的选题生成标题候选和正文结构，完成后自动显示在这里。'),checks};
  if(!topic)return {title:trKey('先确认选题'),detail:trKey('在选题步骤确认素材后，会自动生成大纲。'),checks,primary:{label:trKey('回到选题'),go:'topic'}};
  return {title:trKey('大纲尚未生成'),detail:trKey('选题已确认，可以生成大纲；已有选题不会被改动。'),checks,primary:{label:trKey('生成大纲'),generate:'outline',disabled:!authorized}};
 }
 if(step==='draft'||step==='review'){
  const checks=[{label:trKey('选题已确认'),ok:topic},{label:trKey('大纲已确认'),ok:outline},{label:trKey('已授权 AI 生成'),ok:authorized}];
  if(loading)return {title:trKey('正在生成正文'),detail:trKey('根据已确认的大纲生成正文与配图占位，完成后自动进入编辑。'),checks};
  if(!topic)return {title:trKey('先确认选题'),detail:trKey('正文依据大纲生成，而大纲依据选题生成。'),checks,primary:{label:trKey('回到选题'),go:'topic'}};
  if(!outline)return {title:trKey('先确认大纲'),detail:trKey('在生成步骤核对并确认大纲后，会自动生成正文。'),checks,primary:{label:trKey('回到生成'),go:'outline'}};
  return {title:trKey('正文尚未生成'),detail:trKey('大纲已确认，可以生成正文；之后在这里编辑并保存。'),checks,primary:{label:trKey('生成正文'),generate:'draft',disabled:!authorized}};
 }
 return {title:trKey('还没有可交稿的正文'),detail:trKey('交稿会检查并保存已有正文；请先在编辑步骤生成并保存正文。'),checks:[{label:trKey('正文已生成并保存'),ok:false}],primary:{label:trKey('去编辑'),go:'draft'}};
}

/** The empty slots a stage shows before AI fills it — the same arrangement as the finished stage, so the page does not reflow when content arrives. */
export function workflowSlotLayout(mode:TaskMode,step:WorkflowStep):{titles:number;blocks:string[];columns:string[];images:number}{
 const record=taskType(mode)?.recordLabels||null;
 if(step==='outline')return {titles:3,blocks:record||[trKey('摘要'),trKey('小标题'),trKey('段落'),trKey('段落'),trKey('插图'),trKey('参考资料')],columns:[],images:0};
 if(step==='draft'||step==='review')return {titles:0,blocks:[],columns:[trKey('正文'),trKey('预览')],images:record?0:2};
 return {titles:0,blocks:[],columns:[trKey('稿件预览')],images:0};
}
