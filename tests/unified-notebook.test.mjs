import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {openNotebook,reloadNotebookDraft,checkNotebook,exportNotebook,importNotebookImage} from '../desktop/scripts/agent/notebook-store.mjs';
import {notebookMarkdown,validateNotebook} from '../desktop/scripts/agent/notebook.mjs';
import {createAgentTools} from '../desktop/scripts/agent/tools.mjs';
import {createDraft,readDraft,saveDraft} from '../scripts/editorial-workspace.mjs';
import {flowPermission} from '../desktop/scripts/agent/workflow.mjs';
import {profiles} from '../scripts/site-config.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-notebook-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));return {root,store:new TaskStore(root)};}
const source={id:'source-1',title:'原始资料',summary:'事实依据',url:'https://example.org/original',acquiredVia:'rss',rssId:'123',reviewed:true};
test('rejected source registration explains missing fields and permits retrying prose with its private notes',async t=>{
 const {store}=await fixture(t);
 const task=await openNotebook(store,(await store.create({mode:'observation'})).id);
 const body={...task.notebook.blocks[0],text:'原始资料中的事实。',state:'ready',sourceIds:['source-1']};
 const notes={[body.id]:{notes:{verification:'作者已读取原始资料；登记失败时继续修正字段。'}}};
 const candidate={...task.notebook,blocks:[body],blockNotes:notes,sources:[{id:'source-1',title:'原始资料',url:source.url,reviewed:false}]};
 await assert.rejects(store.update(task.id,{notebook:candidate},task.revision,{agent:true}),error=>{
  assert.match(error.message,/sources\.0/);assert.match(error.message,/summary/);assert.match(error.message,/acquiredVia/);return true;
 });
 const unchanged=await store.get(task.id);
 assert.equal(unchanged.revision,task.revision);assert.deepEqual(unchanged.notebook,task.notebook);
 candidate.sources=[{...candidate.sources[0],summary:'已读原文的事实摘要。',acquiredVia:'web'}];
 const saved=await store.update(task.id,{notebook:candidate},task.revision,{agent:true});
 assert.equal(saved.notebook.blocks[0].text,body.text);
 assert.deepEqual(saved.notebook.blocks[0].sourceIds,['source-1']);
 assert.equal(saved.notebook.blockNotes[body.id].notes.verification,notes[body.id].notes.verification);
});
async function ready(store,{mode='observation',skill='essay'}={}){let t=await openNotebook(store,(await store.create({mode,skill})).id);return store.update(t.id,{notebook:{...t.notebook,sectionId:'observations',title:'可用文章',blocks:[{id:'body',type:'paragraph',text:'作者自己的完整观点，篇幅由内容需要决定。',state:'ready',sourceIds:[]}]}},t.revision);}
test('working drafts persist without creating manuscripts; human save exports the same stable ID',async t=>{const {root,store}=await fixture(t);let a=await openNotebook(store,(await store.create({mode:'observation',skill:'essay'})).id);assert.equal((await checkNotebook(store,a)).ready,false);await assert.rejects(exportNotebook(store,a.id,a.revision),/占位/);assert.deepEqual(JSON.parse(await readFile(join(root,'_ops/inventory/article-index.json'),'utf8')).articles,{});a=await store.update(a.id,{notebook:{...a.notebook,sectionId:'observations',title:'我的文章',blocks:[{...a.notebook.blocks[0],text:'个人短文也可以是完整文章。',state:'ready'}]}},a.revision);const b=await exportNotebook(store,a.id,a.revision);assert.ok(b.completedAt);assert.equal((await readDraft(a.articleId,root)).markdown,notebookMarkdown(a.notebook));assert.equal((await exportNotebook(store,a.id,a.revision)).articleId,a.articleId);assert.equal(Object.keys(JSON.parse(await readFile(join(root,'_ops/inventory/article-index.json'),'utf8')).articles).length,1);});
test('agent can fill unprotected placeholders but cannot remove rows, alter protected prose, review sources, switch skills or create a manuscript',async t=>{const {root,store}=await fixture(t);let a=await openNotebook(store,(await store.create({mode:'observation'})).id),n={...a.notebook,title:'新闻',blocks:a.notebook.blocks.map(b=>({...b,text:'已核实事实',state:'ready'})),sources:[{...source,reviewed:false}]};a=await store.update(a.id,{notebook:n},a.revision,{agent:true});await assert.rejects(store.update(a.id,{notebook:{...n,sources:[source]}},a.revision,{agent:true}),/用户核对/);assert.throws(()=>validateNotebook({...n,blocks:[]},n,{agent:true}),/删除/);assert.throws(()=>validateNotebook({...n,skills:['essay']},n,{agent:true}),/用户挂载/);a=await store.update(a.id,{notebook:{...n,blocks:n.blocks.map(b=>({...b,locked:true}))}},a.revision);await assert.rejects(store.update(a.id,{notebook:{...a.notebook,blocks:a.notebook.blocks.map(b=>({...b,text:'被覆盖'}))}},a.revision,{agent:true}),/锁定/);const tools=createAgentTools({root,taskId:a.id,taskStore:store,approve:async()=>true});await assert.rejects(tools('draft_create',{id:a.articleId,title:'x',markdown:'# x'}),/用户保存/);assert.equal(flowPermission({...a,workflow:{authorized:true}},{title:'scholay-workbench-draft_create: draft_create'}),false);});
test('source review is optional; placeholder image format and stale revisions still block completion',async t=>{const {store}=await fixture(t);let a=await ready(store,{skill:'encyclopedia'});assert.equal((await checkNotebook(store,a)).ready,true);const old=a.revision;a=await store.update(a.id,{notebook:{...a.notebook,sources:[{...source,reviewed:false}]}},a.revision);await assert.rejects(store.update(a.id,{notebook:a.notebook},old),/CONFLICT/);a=await store.update(a.id,{notebook:{...a.notebook,sources:[source],blocks:[...a.notebook.blocks,{id:'image',type:'image',state:'placeholder',text:'',sourceIds:[]}]}},a.revision);assert.equal((await checkNotebook(store,a)).ready,false);});
test('real image import is validated, previewed and copied into the final article without requiring two images',async t=>{const {root,store}=await fixture(t);let a=await ready(store);await assert.rejects(importNotebookImage(store,a.id,{data:Buffer.from('not an image').toString('base64')}));const data=(await sharp({create:{width:20,height:20,channels:3,background:'#aabbcc'}}).png().toBuffer()).toString('base64');const image=await importNotebookImage(store,a.id,{data});a=await store.update(a.id,{notebook:{...a.notebook,blocks:[...a.notebook.blocks,{id:'img',type:'image',text:image.path,state:'ready',sourceIds:[]}]}},a.revision);assert.equal((await checkNotebook(store,a)).ready,true);const done=await exportNotebook(store,a.id,a.revision);assert.ok((await readFile(join(root,done.delivery.canonicalPath,'..',image.path))).length);});
test('legacy manuscripts and board remain intact on open; concurrent library edits are never overwritten',async t=>{const {root,store}=await fixture(t);let a=await store.create({mode:'observation'});const markdown='# 旧标题\n\n## 小节\n\n正文\n\n```js\nconst a=1;\n```\n';const draft=await createDraft({id:a.articleId,title:'旧标题',column:'学者观察',markdown},root);a=await store.generated(a.id,a.articleId,draft.sha256);const original=JSON.stringify(a.board);a=await openNotebook(store,a.id);assert.equal(JSON.stringify(a.board),original);assert.equal((await readDraft(a.articleId,root)).markdown,markdown);assert.equal(a.notebook.blocks[0].type,'markdown');await saveDraft({id:a.articleId,markdown:markdown+'\n作者更新\n',expectedSha256:draft.sha256},root);await assert.rejects(exportNotebook(store,a.id,a.revision),/已有变化|已变化/);assert.match((await readDraft(a.articleId,root)).markdown,/作者更新/);const loaded=await reloadNotebookDraft(store,a.id,a.revision);assert.match(loaded.notebook.blocks[0].text,/作者更新/);assert.equal(loaded.notebook.baseSha,(await readDraft(a.articleId,root)).sha256);assert.ok(await readFile(join(store.dir(a.id),'notebook-before-reload-'+a.revision+'.json')));});
test('uncertain export resumes the exact manuscript without a second index entry',async t=>{const {root,store}=await fixture(t);let a=await ready(store);const original=store.save.bind(store);let fail=true;store.save=async v=>{if(v.completedAt&&fail){fail=false;throw Error('simulated stop');}return original(v);};await assert.rejects(exportNotebook(store,a.id,a.revision),/simulated/);const done=await exportNotebook(store,a.id,a.revision);assert.ok(done.completedAt);assert.equal(Object.keys(JSON.parse(await readFile(join(root,'_ops/inventory/article-index.json'),'utf8')).articles).length,1);});
test('pending cloud receipts survive and prevent a new local completion',async t=>{const {root,store}=await fixture(t);const a=await ready(store);const dir=join(root,'.local/today',a.articleId);await mkdir(dir,{recursive:true});const value={status:'unknown',requestKey:'keep-original'};await writeFile(join(dir,'receipt.json'),JSON.stringify(value));await assert.rejects(exportNotebook(store,a.id,a.revision),/原请求/);assert.deepEqual(JSON.parse(await readFile(join(dir,'receipt.json'),'utf8')),value);});
for(const site of profiles)test(site.id+' exports plain, calendar/annual, history and resource records through its own existing profile',async t=>{
 const {root}=await fixture(t),config=join(root,'.site.json');await writeFile(config,JSON.stringify(site));
 const script=`
 import assert from 'node:assert/strict';
 import {TaskStore} from './desktop/scripts/agent/task-store.mjs';
 import {openNotebook,reloadNotebookDraft,checkNotebook,exportNotebook} from './desktop/scripts/agent/notebook-store.mjs';
 import {recordHeadings} from './scripts/editorial-record.mjs';
 import {readDraft} from './scripts/editorial-workspace.mjs';
 const site=JSON.parse(process.env.SCHOLAY_SITE_JSON),store=new TaskStore(process.env.TEST_ROOT);
 for(const mode of ['observation','xiwen','calendar','history','opensource']){
 let a=await openNotebook(store,(await store.create({mode})).id),n=a.notebook;
 n.sectionId=(await import('./contracts/site-sections.mjs')).sectionsForSite(site)[0].id;n.title='测试文章 '+mode;n.sources=[${JSON.stringify(source)}];
 n.blocks=n.kind==='article'?[{id:'p',type:'paragraph',text:'原始事实与已核实信息。',state:'ready',sourceIds:['source-1']}]:recordHeadings(n.kind).flatMap((text,i)=>[{id:'h'+i,type:'heading',text,level:2,state:'ready',sourceIds:[]},{id:'p'+i,type:'paragraph',text:'有来源的事实与背景说明。',state:'ready',sourceIds:['source-1']}]);
 n.fields=mode==='calendar'?{start:'2026-10-13',category:site.yearCategories[0],tags:[],dateBasis:'机构正式日程',sourceName:'机构',sourceUrl:'https://example.org/original',provenance:'已核验',recurrence:{frequency:'yearly',monthDay:'10-13',leapDay:'skip'}}:mode==='history'?{year:1950,dateKey:'10-13',domain:site.domain,eventType:'历史事件',importance:'B',preciseToDay:true}:mode==='opensource'?{date:'2026-10-13',category:site.sourceCategories[0],url:'https://example.org/original'}:{};
 a=await store.update(a.id,{notebook:n},a.revision);const c=await checkNotebook(store,a);assert.equal(c.ready,true,JSON.stringify(c.issues));const done=await exportNotebook(store,a.id,a.revision);assert.ok(done.completedAt);assert.equal((await readDraft(a.articleId,store.root)).archiveCategory,site.columns[['xiwen','observation','opensource','calendar','history'].indexOf(mode)]);
 }
 `;
 const out=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,TEST_ROOT:root,SCHOLAY_EDITORIAL_ROOT:root,SCHOLAY_SITE_JSON:JSON.stringify(site),SCHOLAY_SITE_CONFIG:config,SCHOLAY_SITE_ID:site.id}});assert.equal(out.status,0,out.stderr);
});
test('existing structured metadata has its own conflict guard even when Markdown is unchanged',async t=>{
 const {root,store}=await fixture(t);let a=await store.create({mode:'history'});
 const draft=await createDraft({id:a.articleId,sectionId:'observations',title:'史实',column:'昔日学术',archiveCategory:'昔日学术',markdown:'# 史实\n\n## 事实摘要\n\n有来源的事实。\n\n## 学术意义\n\n历史意义。\n',record:{kind:'history',fields:{year:1950,dateKey:'10-13',domain:'科技',eventType:'发现',importance:'B',preciseToDay:true,sources:[{label:'史料',url:source.url}]}}},root);
 const bindingFile=join(root,'.local/today',a.articleId,'record.json'),oldBinding=JSON.parse(await readFile(bindingFile,'utf8'));oldBinding.fields.id='history:legacy-event';await writeFile(bindingFile,JSON.stringify(oldBinding));
 await store.generated(a.id,a.articleId,draft.sha256);a=await openNotebook(store,a.id);
 a=await store.update(a.id,{notebook:{...a.notebook,sectionId:'observations',sources:[source]}},a.revision);
 const file=join(root,'.local/today',a.articleId,'record.json'),bound=JSON.parse(await readFile(file,'utf8'));bound.fields.year=1951;await writeFile(file,JSON.stringify(bound));
 const c=await checkNotebook(store,a);assert.equal(c.ready,false);assert.ok(c.issues.some(x=>x.includes('发布字段已修改')));await assert.rejects(exportNotebook(store,a.id,a.revision),/发布字段已修改/);assert.equal(JSON.parse(await readFile(file,'utf8')).fields.year,1951);
 const fresh=await reloadNotebookDraft(store,a.id,a.revision);assert.equal(fresh.notebook.fields.year,1951);await exportNotebook(store,a.id,fresh.revision);assert.equal(JSON.parse(await readFile(file,'utf8')).fields.id,'history:legacy-event');
});


test('saved skill snapshots replace execution modes without changing destination or body',async t=>{
 const {root,store}=await fixture(t);
 for(const skills of [['encyclopedia'],['documentation','design'],['essay'],[]]){
  let a=await ready(store);a=await store.update(a.id,{notebook:{...a.notebook,skills,sources:[source]}},a.revision);
  const done=await exportNotebook(store,a.id,a.revision),draft=await readDraft(done.articleId,root);
  assert.equal(draft.type,skills[0]||'unskilled');assert.deepEqual(draft.writingSkills,skills);
  assert.equal(draft.archiveCategory,'学者观察');assert.equal(draft.markdown,notebookMarkdown(a.notebook));
  assert.equal(done.delivery.destination,'local');assert.equal(done.articleId,a.articleId);
 }
});
test('reopened drafts save the current writing type and title without moving the manuscript',async t=>{
 const {root,store}=await fixture(t);let a=await ready(store,{skill:'xiwen'});
 a=await exportNotebook(store,a.id,a.revision);const old=await readDraft(a.articleId,root);
 a=await reloadNotebookDraft(store,a.id,a.revision,{reopen:true});
 a=await store.update(a.id,{notebook:{...a.notebook,title:'新的事件标题',skills:['observation','documentation']}},a.revision);
 const done=await exportNotebook(store,a.id,a.revision),draft=await readDraft(a.articleId,root);
 assert.equal(draft.type,'observation');assert.deepEqual(draft.writingSkills,['observation','documentation']);
 assert.equal(draft.shortTitle,'新的事件标题');assert.match(draft.markdown,/^# 新的事件标题\n/);
 assert.equal(draft.canonicalPath,old.canonicalPath);assert.equal(draft.archiveCategory,old.archiveCategory);
 assert.equal(done.notebook.baseWritingHash,done.notebookExport.writingHash);
 const fresh=await reloadNotebookDraft(store,a.id,done.revision,{reopen:true});
 assert.equal((await checkNotebook(store,fresh)).ready,true);
});
test('concurrent writing metadata edits block completion and cannot be bypassed by a submitted base hash',async t=>{
 const {root,store}=await fixture(t);let a=await ready(store);
 a=await exportNotebook(store,a.id,a.revision);a=await reloadNotebookDraft(store,a.id,a.revision,{reopen:true});
 const original=a.notebook.baseWritingHash,file=join(root,'_ops/inventory/article-index.json');
 const index=JSON.parse(await readFile(file,'utf8'));index.articles[a.articleId].type='design';index.articles[a.articleId].writingSkills=['design'];
 await writeFile(file,JSON.stringify(index));
 a=await store.update(a.id,{notebook:{...a.notebook,baseWritingHash:undefined}},a.revision);
 assert.equal(a.notebook.baseWritingHash,original);
 await assert.rejects(exportNotebook(store,a.id,a.revision),/标题或文章类型已变化/);
 assert.equal((await readDraft(a.articleId,root)).type,'design');
 const fresh=await reloadNotebookDraft(store,a.id,a.revision);assert.deepEqual(fresh.notebook.skills,['design']);
});
test('unified task tools expose only actual board images and never invent defaults',async t=>{
 const {root,store}=await fixture(t);let a=await ready(store);
 const tools=createAgentTools({root,taskId:a.id,taskStore:store,approve:async()=>true});
 let payload=await tools('task_read');assert.equal(Object.hasOwn(payload,'imageSlots'),false);
 assert.equal(payload.notebook.blocks.filter(b=>b.type==='image').length,0);
 a=await store.update(a.id,{notebook:{...a.notebook,blocks:[...a.notebook.blocks,{id:'author-image',type:'image',state:'placeholder',text:'',sourceIds:[]}]}},a.revision);
 payload=await tools('task_read');assert.equal(Object.hasOwn(payload,'imageSlots'),false);
 assert.equal(payload.notebook.blocks.filter(b=>b.type==='image').length,1);
 assert.equal((await checkNotebook(store,a)).ready,false);
});

test('heading tool records AI choice, uses literal RSS titles and rejects stale revisions',async t=>{
 const {root,store}=await fixture(t);let a=await ready(store);a=await store.update(a.id,{notebook:{...a.notebook,sources:[{...source,reviewed:false}],blocks:[{id:'h',type:'heading',level:2,text:'',state:'placeholder',sourceIds:[source.id]},...a.notebook.blocks]}},a.revision);
 await store.runtime(a.id,{notebookAction:{action:'revise',targetIds:['h'],allowTitle:false,allowFields:false}});
 const tools=createAgentTools({root,taskId:a.id,taskStore:store,approve:async()=>true});
 const r=await tools('notebook_heading_apply',{expectedRevision:a.revision,mode:'source',entries:[{id:'h',sourceId:source.id}],reason:'独立来源条目'});
 assert.equal(r.updatedBlocks[0].text,source.title);assert.equal(r.headingPolicy.selected,'source');
 await assert.rejects(tools('notebook_heading_apply',{expectedRevision:a.revision,mode:'source',entries:[{id:'h',sourceId:source.id}]}),/CONFLICT/);
 const latest=await store.get(a.id);assert.deepEqual(latest.notebook.blocks.slice(1),a.notebook.blocks.slice(1));
});
