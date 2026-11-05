import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {TaskStore,taskInstructions} from '../desktop/scripts/agent/task-store.mjs';
import {createAgentTools} from '../desktop/scripts/agent/tools.mjs';
import {workflowPrompt,workflowCheck,flowPermission,workflowInstructions} from '../desktop/scripts/agent/workflow.mjs';
import {articleImages,replaceImageSlot} from '../desktop/scripts/agent/image-library.mjs';
import {readDraft,saveDraft} from '../scripts/editorial-workspace.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'scholay-business-flow-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));
 await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:['学界犀闻','学者观察','学术开源','学术情报','昔日学术']}));
 return {root,store:new TaskStore(root)};
}
const modes=[
 {mode:'xiwen',category:'学界犀闻'},
 {mode:'observation',category:'学者观察'},
 {mode:'calendar',category:'学术情报',kind:'year',fields:{title:'科研事项',start:'2026-10-19',end:'2026-10-25',category:'学术会议',tags:['会议'],dateBasis:'官网活动日期',sourceName:'主办机构',sourceUrl:'https://example.org/event',provenance:'已核验官网',reviewedAt:'2026-10-04T00:00:00Z'},headings:['摘要','正文']},
 {mode:'history',category:'昔日学术',kind:'history',fields:{title:'科研史料',dateKey:'02-29',year:2000,domain:'科研软件史',eventType:'论文发表',importance:'B',sources:[{label:'出版社',url:'https://example.org/history'}],preciseToDay:true},headings:['事实摘要','学术意义']},
 {mode:'opensource',category:'学术开源',kind:'openSource',fields:{title:'科研开源项目',date:'2026-10-04',category:'基础设施',url:'https://example.org/project',status:'资料核验，未安装实测'},headings:['项目简介','学术价值']},
];

for(const spec of modes)test(spec.mode+': selected material → incremental outline → confirmed draft → manual images → versioned review',async t=>{
 const {root,store}=await fixture(t);let task=await store.create({mode:spec.mode});
 task=await store.workflow(task.id,{action:'configure',sources:'combined',authorized:true,expectedRevision:task.revision});
 const call=createAgentTools({root,taskId:task.id,taskStore:store,approve:async()=>{throw Error('Unexpected external permission');}});
 await assert.rejects(call('draft_create',{id:task.articleId,title:'过早初稿',markdown:'# 过早初稿'}),/两次确认/);
 task=await store.update(task.id,{board:{titles:[],sections:[{id:'section',title:'人工分栏',slotCount:1,slots:[{id:'news',mode:'manual'}],items:[{id:'news',title:'已核实事件',summary:'研究机构的已核实事实',url:'https://example.org/source',publisher:'研究机构',date:'2026-10-04',acquiredVia:'rss',rssId:'42',selected:true,locked:true,excluded:false}]}]}},task.revision);
 task=await store.confirm(task.id,'topic',task.revision);
 const first={titleCandidates:['标题甲','标题乙','标题丙'],selectedTitle:0,blocks:[{id:'summary',type:'summary',text:'正文摘要',sourceIds:['news']}]};
 task=await call('task_update',{expectedRevision:task.revision,outline:first});
 const outline={...first,blocks:[...first.blocks,{id:'body',type:'paragraph',text:'正文解释',sourceIds:['news']},{id:'image-one',type:'image',text:'事实关系示意图',sourceIds:['news']},{id:'image-two',type:'image',text:'适用范围示意图',sourceIds:['news']}]};
 task=await call('task_update',{expectedRevision:task.revision,outline});
 task=await store.confirm(task.id,'outline',task.revision);
 const title=spec.fields?.title||'已确认稿件';
 const markdown=spec.kind?'# '+title+'\n\n## '+spec.headings[0]+'\n\n简短事实。\n\n## '+spec.headings[1]+'\n\n学术解释。':'# '+title+'\n\n'+('经核实的研究事实与具体边界。'.repeat(14))+'\n\n[来源](https://example.org/source)';
 // The agent supplies the post and its verified fields only. A column or record kind it sends anyway is dropped:
 // the destination profile files the draft by task type.
 if(spec.kind)await assert.rejects(call('draft_create',{id:task.articleId,title,markdown}),/结构化稿件需要/);
 const created=await call('draft_create',{id:task.articleId,title,markdown,column:'软广告',archiveCategory:'学界犀闻',record:{kind:'news'},...(spec.kind?{fields:spec.fields}:{})});
 assert.equal(created.archiveCategory,spec.category);assert.equal(created.type,spec.mode);assert.ok(created.canonicalPath.startsWith('articles/annex/'+spec.category+'/'));
 if(spec.kind)assert.equal(JSON.parse(await readFile(join(root,'.local/today',task.articleId,'record.json'),'utf8')).kind,spec.kind);
 assert.equal((await call('task_read')).annexColumns,undefined);
 await store.releaseOwner(task.id);task=await store.get(task.id);
 const pending=await workflowCheck(root,task);
 assert.equal(pending.draftReady,true);assert.equal(pending.ready,false);assert.equal(pending.checks.find(c=>c.key==='images').ok,false);assert.equal(pending.sha256,task.generated.sha);
 if(spec.kind)assert.equal(pending.checks.find(c=>c.key==='record').ok,true);
 await assert.rejects(call('asset_register',{path:'does-not-exist.png'}),/图库/);
 assert.throws(()=>workflowPrompt(task,{action:'image',target:'image-one'}),/本地图库/);
 const before=await readDraft(task.articleId,root);await saveDraft({id:task.articleId,markdown:before.markdown+'\n\n人工保留内容。',expectedSha256:before.sha256},root);
 const bytes=await sharp({create:{width:40,height:30,channels:3,background:'blue'}}).png().toBuffer();
 for(let i=0;i<2;i++){
  const info=await articleImages(store,task.articleId);
  await replaceImageSlot(store,{articleId:task.articleId,slotPath:info.slots[0].path,expectedSha:info.sha,data:(i?await sharp(bytes).tint('green').png().toBuffer():bytes).toString('base64')});
 }
 const ready=await workflowCheck(root,task);assert.equal(ready.ready,true);assert.equal(ready.images,2);assert.match((await readDraft(task.articleId,root)).markdown,/人工保留内容/);
 task=await store.workflow(task.id,{action:'review',expectedRevision:task.revision,fingerprint:ready.fingerprint});assert.equal((await workflowCheck(root,task)).reviewed,true);
 if(spec.kind){
  const path=join(root,'.local/today',task.articleId,'record.json'),record=JSON.parse(await readFile(path,'utf8'));
  if(spec.kind==='year')record.fields.start='2026-10-20';else if(spec.kind==='history')record.fields.year=2004;else record.fields.date='2026-10-05';
  await writeFile(path,JSON.stringify(record));assert.equal((await workflowCheck(root,task)).reviewed,false);
  if(spec.kind==='history'){
   record.fields.year=1900;await writeFile(path,JSON.stringify(record));const invalid=await workflowCheck(root,task);
   assert.equal(invalid.draftReady,false);assert.equal(invalid.checks.find(c=>c.key==='record').ok,false);
  }
  record.kind=spec.kind==='history'?'year':'history';await writeFile(path,JSON.stringify(record));assert.equal((await workflowCheck(root,task)).checks.find(c=>c.key==='record').ok,false);
 }
});

test('RSS and gallery conversations cannot mutate the other business surfaces',async t=>{
 const {root,store}=await fixture(t),rss=await store.create({mode:'rss'}),image=await store.create({mode:'image'});
 const tools=id=>createAgentTools({root,taskId:id,taskStore:store,approve:async()=>true});
 for(const name of ['draft_create','draft_save','cloud_prepare','cloud_submit','asset_register'])await assert.rejects(tools(rss.id)(name,{}),/RSS|图库/);
 await assert.rejects(tools(rss.id)('task_update',{outline:{blocks:[]},expectedRevision:rss.revision}),/大纲/);
 for(const name of ['draft_create','cloud_submit','task_update','draft_read'])await assert.rejects(tools(image.id)(name,{}),/图库/);
 const permitted={...rss,workflow:{authorized:true}};assert.throws(()=>workflowPrompt(permitted,{action:'outline'}),/RSS/);assert.equal(flowPermission(permitted,{title:'scholay-workbench-draft_create: draft_create'}),false);
 assert.equal(flowPermission({...image,workflow:{authorized:true}},{title:'Generate Image',kind:'other',rawInput:{_toolName:'GenerateImage'}}),true);
 assert.match(taskInstructions(image),/本地图库对话/);assert.match(taskInstructions(rss),/不生成大纲/);assert.match(taskInstructions({...rss,mode:'history'}),/历史事件年月日/);
});

test('all modes load the shared workflow and older user workspaces can omit the new optional reference',async t=>{
 const {root}=await fixture(t);await mkdir(join(root,'.agents/skills/scholay-xiwen/references'),{recursive:true});
 await writeFile(join(root,'AGENTS.md'),'工作区规范');await writeFile(join(root,'README.md'),'操作说明');
 for(const name of ['scholay-seo-writing','scholay-xiwen','scholay-scholar-observation','scholay-academic-calendar','scholay-academic-history','scholay-academic-opensource']){await mkdir(join(root,'.agents/skills',name),{recursive:true});await writeFile(join(root,'.agents/skills',name,'SKILL.md'),'模式规范');}
 await writeFile(join(root,'.agents/skills/scholay-xiwen/references/local-draft-contract.md'),'保留稳定作品');
 assert.match(await workflowInstructions(root,'history'),/模式规范/);
 assert(!((await workflowInstructions(root,'rss')).includes('scholay-seo-writing')),'RSS discovery must not load prose-writing instructions');
 await writeFile(join(root,'.agents/skills/scholay-xiwen/references/structured-workflow.md'),'板子逐槽运行');
 for(const {mode} of modes)assert.match(await workflowInstructions(root,mode),/板子逐槽运行/);
});

test('requested rhino gallery guidance is loaded without imposing its style on other images',async t=>{
 const {root}=await fixture(t),dir=join(root,'.agents/skills/scholay-rhino-illustration');
 await mkdir(dir,{recursive:true});await writeFile(join(dir,'SKILL.md'),'角色锚点必须作为真实参考图，检查版权与图注。');
 const generic=await workflowInstructions(root,'image',{brief:'画一片星空'});
 assert(!generic.includes('角色锚点'));assert.match(generic,/不创建文章/);
 const rhino=await workflowInstructions(root,'image',{brief:'给文章配犀牛手绘图'});
 assert.match(rhino,/角色锚点必须作为真实参考图/);assert.match(rhino,/不创建文章/);
 const task={mode:'rss',workflow:{authorized:true,sources:'web'}};
 assert.equal(flowPermission(task,{title:'scholay-rss-feed_read: feed_read'}),true);
 assert.equal(flowPermission({...task,workflow:{authorized:true,sources:'rss'}},{title:'scholay-rss-feed_read: feed_read'}),false);
 assert.equal(flowPermission({...task,mode:'image'},{title:'scholay-rss-feed_read: feed_read'}),false);
});

test('completed article outlines expose two stable image plans before confirmation; partial outlines stay incomplete',async t=>{
 const {store}=await fixture(t);
 for(const {mode} of modes){
  let task=await store.create({mode});task=await store.update(task.id,{board:{titles:[],sections:[{id:'s',title:'人工分栏',items:[{id:'n',title:'事实',summary:'已核实来源',url:'https://example.org/'+mode,publisher:'机构',date:'2026-10-04',selected:true}]}]}},task.revision);
  task=await store.confirm(task.id,'topic',task.revision);
  task=await store.update(task.id,{outline:{titleCandidates:['甲','乙','丙'],selectedTitle:0,blocks:[{id:'summary',type:'summary',text:'仅有部分内容'}]}},task.revision,{agent:true});
  assert.equal((await store.completeOutline(task.id,task.revision)).outline.blocks.filter(b=>b.type==='image').length,0);
  task=await store.update(task.id,{outline:{...task.outline,blocks:[...task.outline.blocks,{id:'body',type:'paragraph',text:'正式正文编排',sourceIds:['n'],locked:true},{id:'refs',type:'references',text:'来源'}]}},task.revision,{agent:true});
  const complete=await store.completeOutline(task.id,task.revision);assert.equal(complete.outline.blocks.filter(b=>b.type==='image').length,2);assert.equal(complete.outline.blocks.at(-1).id,'refs');assert.equal(complete.outline.blocks.find(b=>b.id==='body').locked,true);
  assert.equal((await store.completeOutline(task.id,complete.revision)).revision,complete.revision,'completion is idempotent');
  await assert.rejects(store.completeOutline(task.id,task.revision),/编排已修改/);
  const confirmed=await store.confirm(task.id,'outline',complete.revision);assert.equal((await store.completeOutline(task.id,confirmed.revision)).revision,confirmed.revision,'a confirmed layout is immutable');
 }
});
