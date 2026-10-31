import type {Work} from './contentLibrary';
import type {WorkbenchTask} from './taskWorkbench';

export type CreationRecord=Pick<WorkbenchTask,'id'|'title'|'completedAt'|'updatedAt'>;

// Titles can change or repeat. Use only persisted article bindings, including
// delivery receipts that survive retirement of the local editing copy.
export function creationHistory(work:Work,tasks:WorkbenchTask[]):CreationRecord[]{
 const ids=new Set([work.id,work.cloud?.articleId].filter(Boolean));
 return tasks.filter(task=>!task.deleted&&task.mode!=='image'&&task.mode!=='rss'&&
  [task.articleId,...task.workIds,task.delivery?.articleId].some(id=>ids.has(id)))
  .sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')||a.id.localeCompare(b.id))
  .map(({id,title,completedAt,updatedAt})=>({id,title,completedAt,updatedAt}));
}
