import {describe,expect,it} from 'vitest';
import type {WorkbenchTask,WorkflowCheck,WorkflowPending} from '../editorial/taskWorkbench';
import {pendingRunPhase,workflowArtifactReady,workflowPlaceholderLabels,workflowSlotLayout,workflowStageGate} from '../editorial/workflowLifecycle';

const pending:WorkflowPending={runId:'current-run',previousRunId:'old-run',action:'draft',source:'outline',target:'draft',revision:4,confirmation:'outline-hash',generatedAt:'old-save'};
const task={articleId:'draft-one',workIds:['draft-one'],revision:4,topicConfirmed:'topic-hash',outlineConfirmed:'outline-hash',outline:{titleCandidates:['编排标题'],selectedTitle:0,blocks:[{id:'p',type:'paragraph',text:'事实'}]},generated:{revision:4,sha:'new-sha',at:'new-save'}} as WorkbenchTask;
const check:WorkflowCheck={ready:false,images:0,reviewed:false,sha256:'new-sha',checks:[{key:'body',label:'正文已保存',ok:true,detail:''},{key:'images',label:'占位图尚未替换',ok:false,detail:''}]};

describe('persisted workflow generation gates',()=>{
 it('does not accept an old success, a queued run, or an interrupted current run',()=>{
  expect(pendingRunPhase(pending,{runId:'old-run',status:'已完成'},true)).toBe('waiting');
  expect(pendingRunPhase(pending,{runId:'current-run',status:'已完成',queued:true})).toBe('waiting');
  expect(pendingRunPhase(pending,{runId:'current-run',status:'连接已结束，可继续',lastRunStatus:'已完成'})).toBe('complete');
  expect(pendingRunPhase(pending,{runId:'current-run',status:'已停止',lastRunStatus:'已停止'})).toBe('failed');
  expect(pendingRunPhase(pending,{runId:'other-run',busy:true})).toBe('replaced');
  expect(pendingRunPhase(pending,{runId:'old-run',status:'已完成'})).toBe('replaced');
  expect(pendingRunPhase(pending,{runId:'other-run',status:'已停止'},true)).toBe('replaced');
 });
 it('requires a newly saved draft and verifies its actual checksum, while allowing image placeholders',()=>{
  expect(workflowArtifactReady(pending,task,check)).toBe(true);
  expect(workflowArtifactReady(pending,{...task,generated:{...task.generated!,at:'old-save'}},check)).toBe(false);
  expect(workflowArtifactReady(pending,task,{...check,sha256:'edited-by-someone-else'})).toBe(false);
  expect(workflowArtifactReady(pending,{...task,outlineConfirmed:'new-outline'},check)).toBe(false);
  expect(workflowArtifactReady(pending,{...task,draftStale:true},check)).toBe(false);
  expect(workflowArtifactReady(pending,{...task,workIds:[]},check)).toBe(false);
  expect(workflowArtifactReady(pending,task,{...check,checks:[...check.checks,{key:'record',label:'事项字段',ok:false,detail:'缺日期'}]})).toBe(false);
 });
 it('requires a newer complete outline from the same topic confirmation',()=>{
  const outline:WorkflowPending={...pending,action:'outline',target:'outline',source:'topic',confirmation:'topic-hash'};
  expect(workflowArtifactReady(outline,task)).toBe(false);
  expect(workflowArtifactReady(outline,{...task,revision:5})).toBe(true);
  expect(workflowArtifactReady(outline,{...task,revision:5,topicConfirmed:'changed-topic'})).toBe(false);
  expect(workflowArtifactReady(outline,{...task,revision:5,outline:{blocks:[{id:'p',type:'paragraph',text:'只返回一块'}]}})).toBe(false);
  expect(workflowArtifactReady(outline,{...task,revision:5,outline:{titleCandidates:['标题'],selectedTitle:0,blocks:[{id:'t',type:'title',text:'标题'}]}})).toBe(false);
  expect(workflowArtifactReady(outline,{...task,revision:5,outline:{blocks:[{id:'p',type:'paragraph',text:'',stale:false}]}})).toBe(false);
  expect(workflowArtifactReady(outline,{...task,revision:5,outline:{blocks:[{id:'p',type:'paragraph',text:'旧事实',stale:true}]}})).toBe(false);
 });
 it('shows targeted empty panels for each atomic business mode',()=>{
  expect(workflowPlaceholderLabels('calendar','draft')).toContain('事项日期');
  expect(workflowPlaceholderLabels('history','draft')).toContain('事件日期');
  expect(workflowPlaceholderLabels('opensource','draft')).toContain('许可证与来源');
  expect(workflowPlaceholderLabels('xiwen','draft')).toContain('配图占位');
 });
});

describe('workflowStageGate',()=>{
 const task=(over:object={})=>({mode:'xiwen',topicConfirmed:undefined,outlineConfirmed:undefined,workflow:{authorized:true},...over}) as unknown as WorkbenchTask;
 it('sends 生成 back to 选题 until the topic is confirmed, then offers outline generation',()=>{
  const blocked=workflowStageGate(task(),'outline',false);expect(blocked.primary).toMatchObject({go:'topic'});expect(blocked.checks[0]).toMatchObject({ok:false});
  const ready=workflowStageGate(task({topicConfirmed:'t1'}),'outline',false);expect(ready.primary).toMatchObject({generate:'outline',disabled:false});
  expect(workflowStageGate(task({topicConfirmed:'t1',workflow:{authorized:false}}),'outline',false).primary?.disabled).toBe(true);
 });
 it('gates 编辑 on topic then outline, and generates the body only when both are confirmed',()=>{
  expect(workflowStageGate(task(),'draft',false).primary).toMatchObject({go:'topic'});
  expect(workflowStageGate(task({topicConfirmed:'t1'}),'draft',false).primary).toMatchObject({go:'outline'});
  const ready=workflowStageGate(task({topicConfirmed:'t1',outlineConfirmed:'o1'}),'draft',false);expect(ready.primary).toMatchObject({generate:'draft'});expect(ready.checks.every(c=>c.ok)).toBe(true);
 });
 it('shows progress without actions while generating, and sends an empty 交稿 back to 编辑',()=>{
  const busy=workflowStageGate(task({topicConfirmed:'t1',outlineConfirmed:'o1'}),'draft',true);expect(busy.title).toBe('正在生成正文');expect(busy.primary).toBeUndefined();
  expect(workflowStageGate(task({topicConfirmed:'t1'}),'outline',true).title).toBe('正在生成大纲');
  expect(workflowStageGate(task(),'deliver',false).primary).toMatchObject({go:'draft'});
 });
});

describe('workflowSlotLayout',()=>{
 it('mirrors the finished stage: outline blocks, two-column editor with image slots, single preview for delivery',()=>{
  expect(workflowSlotLayout('xiwen','outline')).toMatchObject({titles:3,blocks:['摘要','小标题','段落','段落','插图','参考资料']});
  expect(workflowSlotLayout('calendar','outline').blocks).toEqual(['事项日期','申报或会议信息','来源资料']);
  expect(workflowSlotLayout('xiwen','draft')).toMatchObject({columns:['正文','预览'],images:2});
  expect(workflowSlotLayout('history','draft')).toMatchObject({columns:['正文','预览'],images:0});
  expect(workflowSlotLayout('xiwen','deliver').columns).toEqual(['稿件预览']);
 });
});
