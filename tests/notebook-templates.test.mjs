import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {openNotebook,checkNotebook,exportNotebook,reloadNotebookDraft} from '../desktop/scripts/agent/notebook-store.mjs';
import {changeNotebookTemplate} from '../desktop/scripts/agent/notebook-template-store.mjs';
import {selectTemplate,releaseTemplate} from '../desktop/scripts/agent/notebook-templates.mjs';
import {readDraft} from '../scripts/editorial-workspace.mjs';
import {recordHeadings} from '../scripts/editorial-record.mjs';
const template=(mode='essay',id=mode)=>({id,mode,name:mode,prompt:'核对原始出处',kind:'article',materials:[{name:'背景',prompt:'说明背景'},{name:'分析',prompt:'根据事实分析'}]});
const source={id:'s',title:'来源',summary:'原始事实',url:'https://example.org/source',acquiredVia:'web',reviewed:true};
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'today-template-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));
 await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));
 const store=new TaskStore(root);const task=await openNotebook(store,(await store.create({mode:'observation',skill:'unskilled'})).id);
 const choose=(a,template,extra={})=>changeNotebookTemplate(store,a.id,{spaceId:a.spaceId,expectedRevision:a.revision,template,...extra});
 return {root,store,task,choose};
}
test('selection, switching, cancellation and reopen share one persisted state without changing the draft UUID',async t=>{
 const {store,task,choose}=await fixture(t),uuid=task.articleId.replace('draft-','');
 let a=await choose(task,template());assert.equal(a.notebook.templateSelection.template.id,'essay');assert.equal(a.notebook.blocks.length,4);
 a=await choose(a,template('calendar'));assert.equal(a.mode,'calendar');assert.equal(a.notebook.kind,'year');assert.equal(a.articleId,'record-'+uuid);assert.equal(a.notebook.mounts.templates.length,1);
 assert.equal((await openNotebook(store,a.id)).revision,a.revision);
 a=await choose(a,null);assert.equal(a.articleId,task.articleId);assert.equal(a.mode,'observation');assert.equal(a.notebook.kind,'article');assert.deepEqual(a.notebook.skills,[]);assert.equal(a.notebook.blocks.length,0);assert.equal(a.notebook.templateSelection,undefined);
});
test('cancellation preserves authored/generated content, changed requirements, group headings, sources and legacy mounts',async t=>{
 const {store,task,choose}=await fixture(t);
 let a=await store.update(task.id,{notebook:{...task.notebook,skills:['documentation','design'],sources:[source],blocks:[{id:'author',type:'paragraph',text:'作者正文',state:'ready',sourceIds:['s'],locked:true}],mounts:{...task.notebook.mounts,templates:[{id:'old',name:'旧自定义',version:'1',blockIds:['author']}]}}},task.revision);
 a=await choose(a,template());const owned=a.notebook.templateSelection.baseline.blocks;
 a=await store.update(a.id,{notebook:{...a.notebook,blocks:a.notebook.blocks.map(b=>b.id===owned[1].id?{...b,text:'已经生成并核实的正文',state:'ready'}:b.id===owned[3].id?{...b,requirement:'作者修改的要求'}:b)}},a.revision);
 a=await choose(a,null);
 assert.equal(a.notebook.blocks.find(b=>b.id==='author').text,'作者正文');assert.ok(a.notebook.blocks.some(b=>b.text==='已经生成并核实的正文'));assert.ok(a.notebook.blocks.some(b=>b.requirement==='作者修改的要求'));
 assert.ok(a.notebook.blocks.some(b=>b.id===owned[0].id));assert.deepEqual(a.notebook.sources,[source]);assert.deepEqual(a.notebook.skills,['documentation','design']);assert.equal(a.notebook.mounts.templates[0].id,'old');
});
test('movement, author locks, and edits later reverted to identical text remain protected',async t=>{
 const {store,task,choose}=await fixture(t);let a=await choose(task,template());
 const first=a.notebook.blocks[0].id;
 a=await store.update(a.id,{notebook:{...a.notebook,blocks:a.notebook.blocks.map(b=>b.id===first?{...b,requirement:'changed'}:b)}},a.revision);
 a=await store.update(a.id,{notebook:{...a.notebook,blocks:a.notebook.blocks.map(b=>b.id===first?{...b,requirement:a.notebook.templateSelection.baseline.blocks[0].requirement}:b)}},a.revision);
 a=await choose(a,null);assert.ok(a.notebook.blocks.some(b=>b.id===first));
 const n={version:2,title:'',kind:'article',skills:[],fields:{},sources:[],blocks:[],groups:[],mounts:{templates:[],brands:[]}};
 let serial=0;const applied=selectTemplate(n,template(),{spaceId:'academic',makeId:()=>String(++serial)}).note;
 applied.blocks=[...applied.blocks.slice(2),...applied.blocks.slice(0,2)];assert.equal(releaseTemplate(applied).note.blocks.length,4);
});
test('atomic undo restores the selection and its retractable presets; later edits prevent stale undo',async t=>{
 const {store,task,choose}=await fixture(t);let a=await choose(task,template());a=await choose(a,template('calendar'));a=await choose(a,null,{undo:true});
 assert.equal(a.notebook.templateSelection.template.mode,'essay');assert.equal(a.mode,'observation');assert.equal(a.articleId,task.articleId);
 a=await choose(a,null);assert.equal(a.notebook.blocks.length,0);
 a=await choose(a,template());a=await store.update(a.id,{notebook:{...a.notebook,title:'后续填写'}},a.revision);
 await assert.rejects(choose(a,null,{undo:true}),/后续修改/);assert.equal((await store.get(a.id)).notebook.title,'后续填写');
});
test('stale, busy, wrong-space and forged selection writes cannot partially apply',async t=>{
 const {store,task,choose}=await fixture(t);let a=await choose(task,template());
 await assert.rejects(choose(task,null),/CONFLICT/);await assert.rejects(choose(a,null,{spaceId:'pets'}),/工作空间/);
 await assert.rejects(store.update(a.id,{notebook:{...a.notebook,templateSelection:undefined}},a.revision),/模板选中/);
 await assert.rejects(store.update(a.id,{notebook:{...a.notebook,templateSelection:undefined}},a.revision,{agent:true}),/模板选中/);
 await store.runtime(a.id,{busy:true});await assert.rejects(choose(a,null),/等待/);assert.equal((await store.get(a.id)).notebook.templateSelection.template.id,'essay');
});
for(const mode of ['essay','xiwen','opensource','calendar','history'])test(mode+' template exports through the existing manuscript/record contract',async t=>{
 const {root,store,task,choose}=await fixture(t);let a=await choose(task,template(mode));
 const fields=mode==='calendar'?{start:'2026-10-17',category:'学术会议',tags:[],dateBasis:'机构日程',sourceName:'机构',sourceUrl:source.url,provenance:'已核验'}:mode==='history'?{year:1950,dateKey:'10-17',domain:'学术',eventType:'历史事件',importance:'B',preciseToDay:true}:mode==='opensource'?{date:'2026-10-17',category:'文献与写作',url:source.url}:{};
 const headings=recordHeadings(a.notebook.kind);
 const blocks=headings.length?headings.flatMap((text,i)=>[{id:'h'+i,type:'heading',level:2,text,state:'ready',sourceIds:[]},{id:'p'+i,type:'paragraph',text:'已核实的事实与说明。',state:'ready',sourceIds:['s']}]):[{id:'p',type:'paragraph',text:'作者已经完成的正文。',state:'ready',sourceIds:['s']}];
 a=await store.update(a.id,{notebook:{...a.notebook,sectionId:'observations',title:'模板文章',blocks,groups:[],fields,sources:[source]}},a.revision);
 assert.deepEqual((await checkNotebook(store,a)).issues,[]);const done=await exportNotebook(store,a.id,a.revision);assert.ok(done.completedAt);assert.equal((await readDraft(done.articleId,root)).id,done.articleId);
 assert.equal(Object.keys(JSON.parse(await readFile(join(root,'_ops/inventory/article-index.json'),'utf8')).articles).length,1);
 const reopened=await reloadNotebookDraft(store,a.id,done.revision,{reopen:true});
 const cancelled=await choose(reopened,null);
 assert.equal(cancelled.articleId,done.articleId);assert.equal(cancelled.notebook.kind,done.notebook.kind);
 assert.deepEqual(cancelled.notebook.blocks,reopened.notebook.blocks);
});

test('an uncertain export binds the identifier and kind before completion',async t=>{
 const {store,task,choose}=await fixture(t);let a=await choose(task,template('calendar'));
 a.notebookExport={key:'pending-export'};await store.save(a);
 await assert.rejects(choose(a,template('essay')),/记录类型/);
 await assert.rejects(choose(a,null,{undo:true}),/记录类型/);
 const cancelled=await choose(a,null);assert.equal(cancelled.articleId,a.articleId);assert.equal(cancelled.notebook.kind,'year');
});
test('an imported manuscript rejects cross-kind templates and never rewrites its identifier',async t=>{
 const {store,task,choose}=await fixture(t);let a=await choose(task,template());
 a.notebook.baseSha='existing';await store.save(a);await assert.rejects(choose(a,template('calendar')),/记录类型/);
 a=await choose(a,template('documentation'));assert.equal(a.articleId,task.articleId);assert.equal(a.notebook.baseSha,'existing');
});
