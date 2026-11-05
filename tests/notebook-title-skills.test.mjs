import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writingCatalog,resolveSkillMounts} from '../desktop/scripts/agent/writing-skill-catalog.mjs';
import {notebookPromptScope,validateNotebook,notebookInstructions,notebookIssues} from '../desktop/scripts/agent/notebook.mjs';
import {notebookPreparation} from '../desktop/scripts/agent/notebook-completion.mjs';
import {selectTemplate} from '../desktop/scripts/agent/notebook-templates.mjs';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {openNotebook,beginNotebookPrompt,checkNotebook} from '../desktop/scripts/agent/notebook-store.mjs';
import {ACTIVE_SITE} from '../scripts/site-profile.mjs';
import {createAgentTools} from '../desktop/scripts/agent/tools.mjs';
const titleTemplate={id:'summary',name:'概括全文',requirement:'依据全文，生成简洁、准确的标题。'};
const note=()=>({version:2,title:'',titleTemplate,kind:'article',sectionId:'observations',skills:[],fields:{},sources:[],groups:[],mounts:{templates:[],brands:[]},blocks:[{id:'body',type:'paragraph',text:'作者已写的正文。',state:'ready',locked:true,sourceIds:[]}]});
test('title placeholders pass preparation but cannot be exported without actual title text',()=>{
 const n=note();assert.equal(notebookPreparation(n).find(c=>c.id==='title').ok,true);assert.ok(notebookIssues(n).some(c=>c.startsWith('title')));
 assert.equal(notebookPromptScope(n,{action:'complete'}).allowTitle,true);
 assert.match(notebookInstructions({notebook:n}),/notebook:\{title:生成的标题\}/);
});
test('title-only generation cannot rewrite existing titles, prose, sources or title instructions',()=>{
 const n=note(),scope=notebookPromptScope(n,{action:'title',targetIds:['body']});assert.deepEqual(scope.targetIds,[]);
 const next={...n,title:'正文的标题'};assert.doesNotThrow(()=>validateNotebook(next,n,{agent:true,scope}));
 assert.throws(()=>notebookPromptScope(next,{action:'title'}),/已有标题/);
 assert.throws(()=>validateNotebook({...next,titleTemplate:{...titleTemplate,requirement:'改动要求'}},n,{agent:true,scope}),/作者选择/);
 assert.throws(()=>validateNotebook({...next,blocks:[{...n.blocks[0],text:'篡改'}]},n,{agent:true,scope}),/锁定|委派/);
 const source={id:'s',title:'来源',url:'https://example.org',summary:'摘要',reviewed:false,acquiredVia:'web'};
 assert.throws(()=>validateNotebook({...next,sources:[source]},n,{agent:true,scope}),/不修改素材/);
 for(const action of ['fill','revise','image','research']){if(action==='image')continue;assert.equal(notebookPromptScope({...n,blocks:[]},{action}).allowTitle,false);}
});
test('article template selection and cancellation preserve the independent title and title template',()=>{
 const n={...note(),title:'人工标题'};let i=0;
 const selected=selectTemplate(n,{id:'article',name:'文章预设',mode:'essay',prompt:'补充说明',kind:'article'},{spaceId:'pets',makeId:()=>String(++i)}).note;
 const cancelled=selectTemplate(selected,null).note;
 assert.equal(cancelled.title,n.title);assert.deepEqual(cancelled.titleTemplate,titleTemplate);assert.deepEqual(cancelled.blocks,n.blocks);
});
test('agent title updates use the real task update path and retain placeholders across revisions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-title-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root);let task=await openNotebook(store,(await store.create({mode:'observation'})).id);
 task=await store.update(task.id,{notebook:note()},task.revision);task=await beginNotebookPrompt(store,task.id,{action:'title',expectedRevision:task.revision});
 const call=createAgentTools({root,taskId:task.id,taskStore:store,approve:()=>false});
 await call('task_update',{expectedRevision:task.revision,notebook:{title:'生成的文章标题'}});
 const saved=await store.get(task.id);assert.equal(saved.notebook.title,'生成的文章标题');assert.deepEqual(saved.notebook.titleTemplate,titleTemplate);assert.equal(saved.notebook.blocks[0].text,'作者已写的正文。');
 await assert.rejects(call('task_update',{expectedRevision:task.revision,notebook:{title:'过期标题'}}),/CONFLICT/);
});
test('catalog merges bundled skills into every workspace, deduplicates local overrides and retains mounted snapshots',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-skills-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const folder=join(root,'.agents/skills/humanizer');await mkdir(folder,{recursive:true});
 await writeFile(join(folder,'SKILL.md'),'---\nname: 本空间写作\ndescription: 本空间的规则\n---\n保留作者原文');
 const catalog=await writingCatalog(root),local=catalog.skills.find(s=>s.id==='humanizer');
 assert.ok(catalog.skills.length>=17);assert.equal(catalog.skills.filter(s=>s.id==='humanizer').length,1);assert.equal(local.name,'本空间写作');assert.ok(catalog.skills.some(s=>s.id==='copy-editing'));
 assert.deepEqual(await resolveSkillMounts(root,[catalog.skills.find(s=>s.id==='copy-editing')]),[catalog.skills.find(s=>s.id==='copy-editing')]);
 await writeFile(join(folder,'SKILL.md'),'---\nname: 更新规则\n---\n第二版');assert.deepEqual(await resolveSkillMounts(root,[local],[local]),[local]);
 await assert.rejects(resolveSkillMounts(root,[local]),/已变化/);
});
for(const [mode,sectionId,fields] of [
 ['calendar','calendar',{start:'2026-10-16',category:ACTIVE_SITE.yearCategories[0],dateBasis:'机构日程',sourceName:'机构',sourceUrl:'https://example.org/event'}],
 ['opensource','resources',{date:'2026-10-16',category:ACTIVE_SITE.sourceCategories[0],url:'https://example.org/project'}],
 ['history','observations',{year:2020,dateKey:'10-16',domain:'自然科学',eventType:'学术事件',importance:'A'}],
])test(mode+' checks title placeholders as preparation only without weakening metadata checks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-title-record-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new TaskStore(root);let task=await openNotebook(store,(await store.create({mode})).id);
 task=await store.update(task.id,{notebook:{...task.notebook,title:'',titleTemplate,sectionId,fields,sources:[{id:'source',title:'机构原文',url:'https://example.org',summary:'摘要',acquiredVia:'web',reviewed:false}],blocks:task.notebook.blocks.map(b=>b.state==='placeholder'?{...b,requirement:'依照原文整理本节'}:b)}},task.revision);
 const result=await checkNotebook(store,task,{preparing:true});assert.deepEqual(result.issues,[]);
 assert.equal((await checkNotebook(store,task)).ready,false);assert.equal((await store.get(task.id)).notebook.title,'');
});
test('automatically supplied title placeholders are removed only while still untouched',()=>{
 const n=note();delete n.titleTemplate;let i=0;const options={spaceId:'pets',makeId:()=>String(++i)},template={id:'article',name:'文章',mode:'essay',prompt:'写作要求'};
 const applied=selectTemplate(n,template,options).note;assert.ok(applied.titleTemplate);assert.equal(selectTemplate(applied,null).note.titleTemplate,undefined);
 const authored={...applied,title:'作者写入的标题'};assert.equal(selectTemplate(authored,null).note.title,'作者写入的标题');
 const customized={...applied,titleTemplate:{...titleTemplate,name:'我的要求'}};assert.deepEqual(selectTemplate(customized,null).note.titleTemplate,customized.titleTemplate);
});
