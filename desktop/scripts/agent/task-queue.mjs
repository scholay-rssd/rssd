// The task record is the queue. Never replay a prompt that might have reached
// an agent: tools may already have written a draft or submitted a publication.
export function recoverQueuedTask(task,session,admission){
 const runtime=task.runtime||{},prompt=runtime.pendingPrompt||admission?.prompt;
 if(task.deleted||task.archived||task.completedAt)return null;
 if(admission&&(admission.version!==1||admission.taskId!==task.id||typeof admission.runId!=='string'||!admission.runId||!['admitted','dispatched','cancelled'].includes(admission.phase)||typeof admission.prompt?.text!=='string'||admission.runId!==admission.prompt?.runId||runtime.pendingPrompt&&runtime.pendingPrompt.runId!==admission.runId||runtime.runId&&runtime.runId!==admission.runId))return {kind:'attention',runId:runtime.runId||admission.runId,status:'任务入队记录与执行记录不一致，请查看原记录'};
 if(!prompt?.runId)return runtime.busy||runtime.queued?{kind:'attention',runId:runtime.runId,status:'上次执行已中断，请查看记录后继续'}:null;
 const history=session?.history||[];
 const turn=history.findLast(entry=>entry.role==='turn'&&(entry.turnId||entry.id)===prompt.runId&&entry.finishedAt);
 if(turn)return {kind:'settled',status:turn.status||'已中断',runId:prompt.runId};
 if(admission?.phase==='cancelled')return {kind:'settled',status:'已停止',runId:admission.runId};
 if(admission?.phase==='dispatched')return {kind:'attention',runId:admission.runId,status:'上次执行可能已处理，请查看原会话后继续'};
 const began=history.some(entry=>entry.turnId===prompt.runId);
 if(admission?.phase==='admitted'&&!began)return {kind:'queued',params:admission.prompt,runId:admission.runId};
 if(['queued','connecting'].includes(runtime.queuePhase)&&!began)return {kind:'queued',params:prompt,runId:prompt.runId};
 return {kind:'attention',runId:prompt.runId,status:'上次执行已中断，请查看记录后继续'};
}

export function authoringQueueJob(task,state={},space={}){
 const runtime={...task.runtime,...state};
 if(!runtime.runId&&!runtime.pendingPrompt)return null;
 const status=runtime.queued?'queued':runtime.busy?(runtime.pending?'attention':'running'):
  runtime.recoveryRequired||/中断|失败|异常|超时|断开|错误|Error/i.test(runtime.status||'')?'attention':
  runtime.status==='已完成'||task.completedAt?'complete':runtime.status==='已停止'?'stopped':'idle';
 if(status==='idle')return null;
 return {id:'authoring:'+task.id+':'+(runtime.runId||runtime.pendingPrompt?.runId),taskId:task.id,
  articleId:task.articleId,title:task.title||'写作任务',...space,status,
  phase:runtime.pending?'等待你的确认':runtime.status||'等待处理',
  updatedAt:runtime.queueUpdatedAt||task.updatedAt,source:'authoring',runId:runtime.runId,
  ...(runtime.recoveryRequired?{error:runtime.status}:{}),
 };
}
