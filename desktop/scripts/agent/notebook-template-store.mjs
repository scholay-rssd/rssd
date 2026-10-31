import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {withFileLock} from '../../../scripts/editorial-lock.mjs';
import {optionalJson} from '../../../scripts/editorial-sync.mjs';
import {publicationDirectory,siteForWorkspace} from '../../../scripts/site-config.mjs';
import {recordHeadings} from '../../../scripts/editorial-record.mjs';
import {defaultDays} from './task-types.mjs';
import {validateNotebook,stampNotebook} from './notebook.mjs';
import {selectTemplate,stampTemplateBaseline,templateKind,templateTaskMode,validateTemplate} from './notebook-templates.mjs';

const snapshot=t=>structuredClone({notebook:t.notebook,articleId:t.articleId,mode:t.mode,writingSkill:t.writingSkill,days:t.days,templateBase:t.templateBase});
export async function changeNotebookTemplate(store,id,p){return withFileLock(join(store.dir(id),'task.lock'),async()=>{
 const t=await store.get(id),site=siteForWorkspace(store.root);
 if(!t.notebook||t.completedAt||t.runtime?.busy||t.runtime?.queued)throw Error('请先等待当前操作完成，再修改模板');
 if(t.revision!==p.expectedRevision)throw Error('CONFLICT: 文章板已有新版，模板未变更');
 if(p.spaceId!==site.spaceId||t.spaceId!==site.spaceId)throw Error('工作空间已变化，请重新打开模板库');
 const before=snapshot(t);
 const bound=!!(t.notebookExport||t.notebook.baseSha||t.notebook.baseRecordHash||t.notebook.exportedSha||t.workIds.includes(t.articleId)||await optionalJson(join(publicationDirectory(store.root),t.articleId,'record.json')));
 if(p.undo){
  if(!t.templateUndo||t.templateUndo.revision!==t.revision)throw Error('文章已有后续修改，不能撤销这次模板操作');
  if(bound&&(t.templateUndo.before.articleId!==t.articleId||t.templateUndo.before.notebook.kind!==t.notebook.kind))throw Error('已有稿件的记录类型保持不变，不能撤销为另一种记录类型');
  const restoredNote=t.templateUndo.before.notebook;
  const pristine=new Set((restoredNote.templateSelection?.baseline.blocks||[]).filter(base=>restoredNote.blocks.find(b=>b.id===base.id)?.revision===base.revision).map(b=>b.id));
  Object.assign(t,structuredClone(t.templateUndo.before));delete t.templateUndo;
  t.notebook=stampNotebook(t.notebook,before.notebook,{documentId:t.articleId,actor:'author'});
  // Undo restores ownership baselines as well as content; only untouched nodes
  // get their new revision baseline. Previously edited nodes remain protected.
  const s=t.notebook.templateSelection;
  if(s)s.baseline.blocks=s.baseline.blocks.map(base=>pristine.has(base.id)?structuredClone(t.notebook.blocks.find(b=>b.id===base.id)||base):base);
  t.templateNotice='已撤销模板操作。';
 }else{
  const template=p.template===null?null:validateTemplate(p.template);
  if(bound&&template&&templateKind(template.mode)!==t.notebook.kind)throw Error('已有稿件的记录类型保持不变，请新建创作使用此模板');
  if(!t.templateBase)t.templateBase={mode:t.mode,writingSkill:t.writingSkill,days:t.days};
  const input=structuredClone(t.notebook);
  if(bound&&input.templateSelection)input.templateSelection.before.kind=input.kind;
  const result=selectTemplate(input,template,{spaceId:site.spaceId,makeId:randomUUID,headings:template?recordHeadings(templateKind(template.mode)):[]});
  let n=validateNotebook(result.note); // Type changes are allowed only here, before binding.
  if(bound&&n.kind!==t.notebook.kind)throw Error('已有稿件的记录类型保持不变');
  if(!bound)t.mode=template?templateTaskMode(template.mode):t.templateBase.mode;
  t.writingSkill=template?.mode||t.templateBase.writingSkill;
  t.days=template?(template.days||defaultDays(t.mode)):t.templateBase.days;
  // Before first export, only the compatibility prefix changes; the UUID and
  // task stay stable. Existing files and published record IDs never move.
  if(!bound)t.articleId=(n.kind==='article'?'draft-':'record-')+t.articleId.replace(/^(draft-|record-)/,'');
  t.notebook=stampNotebook(n,t.notebook,{documentId:t.articleId,actor:'template'});
  if(template)stampTemplateBaseline(t.notebook);else delete t.templateBase;
  t.templateUndo={revision:t.revision+1,before};
  t.templateNotice=(template?'已选中「'+template.name+'」':'已取消模板')+'；移除 '+result.removed+' 个预设，保留 '+result.retained+' 处已编辑内容。';
 }
 t.notebook.meta.documentId=t.articleId;t.revision++;t.updatedAt=new Date().toISOString();
 return store.save(t);
});}
