// The selected target belongs to the task, not to the current catalog order or
// defaults. Recheck before continuing an agent run or exporting/publishing it.
export function assertHeadlessTarget(task,{siteId,sectionId,mode},{allowMissingNotebook=false}={}){
 if(task.siteId&&task.siteId!==siteId)throw Error('headless site does not match saved task');
 if(task.mode!==mode)throw Error('headless mode does not match saved task');
 if(!task.notebook&&allowMissingNotebook)return task;
 if(task.notebook?.sectionId!==sectionId)throw Error('headless section does not match saved task');
 const kind={calendar:'year',history:'history',opensource:'openSource'}[mode]||'article';
 if(task.notebook.kind!==kind)throw Error('headless record kind does not match saved task mode');
 return task;
}
