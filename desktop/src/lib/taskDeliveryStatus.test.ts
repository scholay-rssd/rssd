import {expect,it} from 'vitest';
import {taskStatus} from '../editorial/TaskHistoryList';
import type {WorkbenchTask} from '../editorial/taskWorkbench';
const task={id:'task-1',articleId:'draft-1',mode:'observation',stage:'draft',workIds:['draft-1'],board:{sections:[],titles:[]},outline:{blocks:[]},runtime:{busy:false,lastRunStatus:'已完成',status:'连接已结束，可继续'}} as unknown as WorkbenchTask;
it('separates a finished Cursor turn from the whole manuscript task',()=>{
 expect(taskStatus(task)).toBe('编辑 · 待交稿');
 expect(taskStatus({...task,workIds:[]})).toBe('编辑 · 待继续');
 expect(taskStatus({...task,completedAt:'done'})).toBe('已结束 · 完成');
});
it('keeps retirement and blocked cleanup visible until cloud delivery is complete',()=>{
 const delivery={destination:'cloud' as const,articleId:'draft-1',at:'now'};
 expect(taskStatus({...task,delivery:{...delivery,phase:'retiring'}})).toBe('交稿 · 回收中');
 expect(taskStatus({...task,delivery:{...delivery,phase:'cleanup_blocked',error:'人工编辑冲突'}})).toBe('交稿 · 待回收');
 expect(taskStatus({...task,completedAt:'done',delivery:{...delivery,phase:'complete'}})).toBe('已结束 · 完成');
});
