import {expect,it} from 'vitest';
import {creationHistory} from '../editorial/creationHistory';
import type {Work} from '../editorial/contentLibrary';
import type {WorkbenchTask} from '../editorial/taskWorkbench';

const work={id:'article-one',title:'相同标题',cloud:{articleId:'article-one'}} as Work;
const task=(id:string,patch:Partial<WorkbenchTask>={}):WorkbenchTask=>({id,title:id,articleId:'unrelated',workIds:[],mode:'observation',updatedAt:'2026-10-24',...patch} as WorkbenchTask);
it('finds all related conversations by stable IDs after publication and local retirement',()=>{
 const tasks=[task('first',{articleId:work.id,completedAt:'2026-10-23',updatedAt:'2026-10-23'}),task('revision',{workIds:[work.id]}),task('delivered',{delivery:{articleId:work.id,destination:'cloud',at:'2026-10-24'}}),task('same-title',{title:work.title})];
 expect(creationHistory(work,tasks).map(t=>t.id)).toEqual(['delivered','revision','first']);
 expect(creationHistory(work,tasks).at(-1)?.completedAt).toBe('2026-10-23');
 expect(tasks.map(t=>t.id)).toEqual(['first','revision','delivered','same-title']);
});
it('does not include deleted conversations, discovery or image tasks, or duplicate a multi-bound record',()=>{
 expect(creationHistory(work,[task('removed',{articleId:work.id,deleted:true}),task('images',{articleId:work.id,mode:'image'}),task('sources',{articleId:work.id,mode:'rss'}),task('kept',{articleId:work.id,workIds:[work.id]})]).map(t=>t.id)).toEqual(['kept']);
 expect(creationHistory(work,[])).toEqual([]);
});
