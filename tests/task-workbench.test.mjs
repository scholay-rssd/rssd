import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,copyFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {TaskStore,cursorImageSource} from '../desktop/scripts/agent/task-store.mjs';
import {Conversations} from '../desktop/scripts/agent/session-state.mjs';
import {createAgentTools} from '../desktop/scripts/agent/tools.mjs';
import {articleImages,replaceImageSlot} from '../desktop/scripts/agent/image-library.mjs';
import {createDraft,readDraft,saveDraft,packedDraft} from '../scripts/editorial-workspace.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'scholay-tasks-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:['新闻聚合','学界犀闻']}));return {root,store:new TaskStore(root)};}
const board=()=>({titles:['标题一','标题二','标题三'],sections:[{id:'section-1',title:'方法',items:[{id:'news-1',title:'真实事件',summary:'事实摘要',url:'https://example.org/primary',publisher:'机构',date:'2026-10-02',eventKey:'event-1'}]}]});
const outline=()=>({blocks:[{id:'paragraph-1',type:'paragraph',text:'核心事实',sourceIds:['news-1']},{id:'image-1',type:'image',text:'说明核心事实的配图'}]});
test('run outcome survives idle disconnect and restart; a new run clears the old success',async t=>{
 const {root,store}=await fixture(t),task=await store.create({mode:'observation'});
 await store.runtime(task.id,{busy:false,status:'已完成'});
 await store.runtime(task.id,{busy:false,status:'连接已结束，可继续'});
 assert.equal((await new TaskStore(root).get(task.id)).runtime.lastRunStatus,'已完成');
 await store.runtime(task.id,{busy:true,queued:true,status:'排队中'});
 await store.runtime(task.id,{busy:true,queued:false,status:'正在处理'});
 assert.equal((await new TaskStore(root).get(task.id)).runtime.lastRunStatus,null);
 await store.runtime(task.id,{busy:false,status:'任务连接已中断，可重新连接继续'});
 await store.runtime(task.id,{status:'连接已结束，可继续'});
 assert.match((await new TaskStore(root).get(task.id)).runtime.lastRunStatus,/中断/);
 await store.runtime(task.id,{busy:true,queued:true,status:'排队中'});
 await store.runtime(task.id,{busy:false,queued:false,status:'已停止'});
 await store.runtime(task.id,{status:'连接已结束，可继续'});
 assert.equal((await new TaskStore(root).get(task.id)).runtime.lastRunStatus,'已停止');
});
test('legacy run recovery requires a finished last turn and never rewrites the original history',async t=>{
 const {root,store}=await fixture(t),task=await store.create({mode:'observation'}),dir=join(store.dir(task.id),'cursor');await mkdir(dir);
 await store.save({...task,runtime:{busy:false,status:'连接已结束，可继续'}});
 const history={history:[{role:'user',text:'生成初稿'},{role:'turn',status:'已完成',finishedAt:123}]},file=join(dir,'session.json');
 const original=JSON.stringify(history);await writeFile(file,original);
 assert.equal((await new TaskStore(root).get(task.id)).runtime.lastRunStatus,'已完成');assert.equal(await readFile(file,'utf8'),original);
 history.history.push({role:'user',text:'新一轮尚未结束'});await writeFile(file,JSON.stringify(history));
 assert.equal((await new TaskStore(root).get(task.id)).runtime.lastRunStatus,undefined);
});
test('task UI survives reload; immutable mode, recovery, trash and old history migration preserve content',async t=>{const {root,store}=await fixture(t);let task=await store.create({mode:'xiwen',title:'A'});await store.update(task.id,{ui:{composer:'未发送中文',scrollTop:42,tabs:[{id:'board',kind:'board'}]}});await assert.rejects(store.update(task.id,{mode:'observation'}));task=await store.update(task.id,{title:'B',pinned:true,deleted:true,workIds:['article-1']});assert.deepEqual(task.workIds,['article-1']);await store.update(task.id,{deleted:false});const fresh=new TaskStore(root);assert.equal((await fresh.get(task.id)).ui.composer,'未发送中文');await writeFile(join(store.dir(task.id),'task.json'),'{broken');assert.equal((await fresh.get(task.id)).recovered,true);const c=new Conversations(root);await c.save({sessionId:'historic',history:[{role:'user',text:'检索关键词'}]});const original=await readFile(join(root,'.local/cursor/session.json'),'utf8');await store.migrate();await store.migrate();assert.equal((await store.list('检索关键词')).length,1);assert.equal((await store.list('检索关键词'))[0].mode,'legacy');assert.equal(await readFile(join(root,'.local/cursor/session.json'),'utf8'),original);});
test('optimistic planning versions, two human gates, locked items and syndicated-event dedup are enforced',async t=>{const {store}=await fixture(t);let task=await store.create({mode:'xiwen'});await assert.rejects(store.confirm(task.id,'topic',task.revision));task=await store.update(task.id,{board:board()},task.revision,{agent:true});const revision=task.revision;await store.update(task.id,{ui:{composer:'不应让生成失效'}});task=await store.update(task.id,{board:{...board(),titles:['新标题']}},revision);await assert.rejects(store.update(task.id,{board:board()},revision,{agent:true}),/CONFLICT/);await assert.rejects(store.update(task.id,{outline:outline()},task.revision,{agent:true}),/先在选题板/);task=await store.confirm(task.id,'topic',task.revision);task=await store.update(task.id,{outline:outline()},task.revision,{agent:true});task=await store.confirm(task.id,'outline',task.revision);assert.ok(task.outlineConfirmed);const locked=board();locked.sections[0].items[0].locked=true;task=await store.update(task.id,{board:locked},task.revision);assert.equal(task.outlineConfirmed,null);assert.ok(task.outline.blocks[0].stale);const modified=structuredClone(locked);modified.sections[0].items[0].summary='覆盖';await assert.rejects(store.update(task.id,{board:modified},task.revision,{agent:true}),/锁定/);const dup=board();dup.sections[0].items.push({...dup.sections[0].items[0],id:'copy',url:'https://other.example/repost'});await assert.rejects(store.update(task.id,{board:dup},task.revision),/同一事件/);});
test('parallel task writes retain both index entries; human edits and another writer block stale save',async t=>{const {root,store}=await fixture(t);const [a,b]=await Promise.all([store.create({mode:'observation'}),store.create({mode:'observation'})]);const tools=id=>createAgentTools({root,taskId:id,taskStore:store,approve:async()=>false});const ta=tools(a.id),tb=tools(b.id);await Promise.all([ta('draft_create',{id:a.articleId,title:'A',markdown:'# A'}),tb('draft_create',{id:b.articleId,title:'B',markdown:'# B'})]);const index=JSON.parse(await readFile(join(root,'_ops/inventory/article-index.json'),'utf8'));assert.equal(Object.keys(index.articles).length,2);const old=await readDraft(a.articleId,root);await assert.rejects(tb('draft_save',{id:a.articleId,expectedSha256:old.sha256,markdown:'# Wrong'}),/另一个/);await store.releaseOwner(a.id);await store.lease(a.articleId,'editor-human');await assert.rejects(ta('draft_save',{id:a.articleId,expectedSha256:old.sha256,markdown:'# Wrong'}),/编辑器/);await store.releaseOwner('editor-human');await saveDraft({id:a.articleId,expectedSha256:old.sha256,markdown:'# Human'},root);await assert.rejects(ta('draft_save',{id:a.articleId,expectedSha256:old.sha256,markdown:'# Stale'}),/CONFLICT/);assert.equal((await readDraft(a.articleId,root)).markdown,'# Human');});
test('xiwen draft tool cannot bypass the two confirmations',async t=>{const {root,store}=await fixture(t);let task=await store.create({mode:'xiwen'});const tool=createAgentTools({root,taskId:task.id,taskStore:store,approve:async()=>false});await assert.rejects(tool('draft_create',{id:task.articleId,title:'稿件',markdown:'# 正文'}),/两次确认/);await assert.rejects(tool('draft_create',{id:'alternate',title:'绕过',markdown:'# 正文'}),/两次确认/);task=await store.update(task.id,{board:board()},task.revision);task=await store.confirm(task.id,'topic',task.revision);task=await store.update(task.id,{outline:outline()},task.revision);task=await store.confirm(task.id,'outline',task.revision);await assert.rejects(tool('draft_create',{id:'alternate',title:'重复',markdown:'# 正文'}),/固定/);await tool('draft_create',{id:task.articleId,title:'稿件',markdown:'# 正文'});assert.deepEqual((await store.get(task.id)).workIds,[task.articleId]);});
test('images require real decodable files, replace by version and retain originals; packing does not watermark twice',async t=>{const {root,store}=await fixture(t);const task=await store.create({mode:'xiwen'});await createDraft({id:task.articleId,title:'配图测试',markdown:'# 图片'},root);await assert.rejects(store.asset(task.id,{path:'missing.png'}));await assert.rejects(store.asset(task.id,{data:Buffer.from('not an image').toString('base64')}));assert.equal((await store.get(task.id)).assets.length,0);const bytes=await sharp({create:{width:200,height:120,channels:3,background:'#467f65'}}).png().toBuffer();const a=await store.asset(task.id,{data:bytes.toString('base64'),name:'真实测试图片'});let draft=await readDraft(task.articleId,root);await saveDraft({id:task.articleId,expectedSha256:draft.sha256,markdown:'# 图片\n\n![图]('+a.path+')'},root);const alternate=await sharp(bytes).tint('#b54433').png().toBuffer();const b=await store.asset(task.id,{data:alternate.toString('base64'),replaceId:a.id});assert.match((await readDraft(task.articleId,root)).markdown,new RegExp(b.path));const restored=await store.asset(task.id,{restoreId:a.id,replaceId:b.id});assert.equal(restored.path,a.path);assert.equal((await store.get(task.id)).assets.length,3);assert.match((await store.assetRead(task.id,restored.id)).src,/^data:image\/webp;base64,/);const pack=await packedDraft(task.articleId,root);const onDisk=await readFile(join(root,draft.canonicalPath.replace(/正文.md$/,''),a.path));assert.deepEqual(Buffer.from(pack.assets[0].data,'base64'),onDisk);});
test('task-scoped assets reject unrelated replacements and inline uploads update the real Markdown',async t=>{const {root,store}=await fixture(t);const task=await store.create({mode:'xiwen'});await createDraft({id:task.articleId,title:'图文',markdown:'# 图文'},root);const data=(await sharp({create:{width:180,height:100,channels:3,background:'#e5efef'}}).png().toBuffer()).toString('base64');await assert.rejects(store.asset(task.id,{data,replaceId:'not-this-task'}),/不存在/);const asset=await store.asset(task.id,{data,insert:true,name:'手选图片'});assert.ok((await readDraft(task.articleId,root)).markdown.includes(asset.path));});
test('locked content equality ignores JSON key order; changed task scope invalidates an old generation',async t=>{const {store}=await fixture(t);let task=await store.create({mode:'xiwen'});const b=board();b.sections[0].items[0].locked=true;task=await store.update(task.id,{board:b},task.revision);const reordered=board();reordered.sections[0].items[0]=Object.fromEntries(Object.entries(b.sections[0].items[0]).reverse());task=await store.update(task.id,{board:reordered},task.revision,{agent:true});const before=task.revision;task=await store.update(task.id,{brief:'换一个范围'},task.revision);assert.ok(task.revision>before);await assert.rejects(store.update(task.id,{board:b},before,{agent:true}),/CONFLICT/);});

test('Cursor image import allows only the current project cache and rejects other projects',async t=>{
 const {root}=await fixture(t),home=join(root,'home'),slug=root.replace(/[^a-zA-Z0-9]/g,'-').replace(/^-+/,'');
 const assets=join(home,'.cursor/projects',slug,'assets');await mkdir(assets,{recursive:true});const file=join(assets,'image.png');await writeFile(file,'qa');
 // Use a workspace sibling so this checks the Cursor-cache exception, not the normal root.
 const workspace=join(root,'workspace');await mkdir(workspace);const project=workspace.replace(/[^a-zA-Z0-9]/g,'-').replace(/^-+/,'');const current=join(home,'.cursor/projects',project,'assets');await mkdir(current,{recursive:true});const own=join(current,'image.png');await writeFile(own,'qa');
 assert.equal(await cursorImageSource(workspace,own,home),await realpath(own));await assert.rejects(cursorImageSource(workspace,file,home),/图片不在/);
 const hidden=join(workspace,'.local','qa');await mkdir(hidden,{recursive:true});const collapsed=hidden.replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+/,'');
 const hiddenAssets=join(home,'.cursor/projects',collapsed,'assets');await mkdir(hiddenAssets,{recursive:true});const generated=join(hiddenAssets,'actual-generated.jpg');await writeFile(generated,'qa');
 assert.equal(await cursorImageSource(hidden,generated,home),await realpath(generated));
 await assert.rejects(cursorImageSource(workspace,generated,home),/图片不在/);
});

test('replacing with an image already used elsewhere does not alter that other image when restored',async t=>{
 const {root,store}=await fixture(t),task=await store.create({mode:'xiwen'});await createDraft({id:task.articleId,title:'Two images',markdown:'# Two'},root);
 const bytes=async background=>(await sharp({create:{width:120,height:100,channels:3,background}}).png().toBuffer()).toString('base64');
 const a=await store.asset(task.id,{data:await bytes('#abcdef')}),b=await store.asset(task.id,{data:await bytes('#fedcba')});
 const d=await readDraft(task.articleId,root);const md=`# Two\n\n![one](${a.path})\n\n![two](${b.path})`;await saveDraft({id:d.id,expectedSha256:d.sha256,markdown:md},root);
 const replaced=await store.asset(task.id,{data:await bytes('#fedcba'),replaceId:a.id});assert.notEqual(replaced.path,b.path);
 await store.asset(task.id,{restoreId:a.id,replaceId:replaced.id});assert.equal((await readDraft(d.id,root)).markdown,md);
});

test('image replacement follows a cloud-pulled reference by content without dropping the original',async t=>{
 const {root,store}=await fixture(t),task=await store.create({mode:'xiwen'});await createDraft({id:task.articleId,title:'Cloud image',markdown:'# Image'},root);
 const data=async background=>(await sharp({create:{width:120,height:100,channels:3,background}}).png().toBuffer()).toString('base64');const a=await store.asset(task.id,{data:await data('#abcdef')});const d=await readDraft(task.articleId,root),base=join(root,d.canonicalPath,'..');await mkdir(join(base,'assets/cloud'),{recursive:true});await copyFile(join(base,a.path),join(base,'assets/cloud/remote.webp'));await saveDraft({id:d.id,expectedSha256:d.sha256,markdown:'# Image\n\n![remote](assets/cloud/remote.webp)'},root);
 const b=await store.asset(task.id,{data:await data('#fedcba'),replaceId:a.id});assert.ok((await readDraft(d.id,root)).markdown.includes(b.path));
});

test('an ACP imported candidate becomes one replacement while originals stay recoverable',async t=>{
 const {root,store}=await fixture(t),task=await store.create({mode:'observation'});
 await createDraft({id:task.articleId,title:'Image recovery',markdown:'# Image recovery'},root);
 const data=async background=>(await sharp({create:{width:120,height:100,channels:3,background}}).png().toBuffer()).toString('base64');
 const old=await store.asset(task.id,{data:await data('#abcdef'),insert:true});
 const replacement=await data('#fedcba'),candidate=await store.asset(task.id,{data:replacement});
 const registered=await store.asset(task.id,{data:replacement,replaceId:old.id});
 const assets=(await store.get(task.id)).assets;
 assert.deepEqual(assets.map(a=>a.id),[old.id,registered.id]);
 const draft=await readDraft(task.articleId,root);assert.ok(draft.markdown.includes(registered.path));
 assert.ok(await readFile(join(root,draft.canonicalPath,'..',candidate.originalPath)));
 await store.asset(task.id,{restoreId:old.id,replaceId:registered.id});
 assert.ok((await readDraft(task.articleId,root)).markdown.includes(old.path));
});


test('title-text selections migrate on edit, invalid selections are rejected, and draft stage follows actual creation',async t=>{
 const {root,store}=await fixture(t);let task=await store.create({mode:'xiwen'});
 task=await store.update(task.id,{board:{...board(),selectedTitle:'标题二'}},task.revision);assert.equal(task.board.selectedTitle,1);
 await assert.rejects(store.update(task.id,{board:{...board(),selectedTitle:'不存在'}},task.revision),/selectedTitle/);
 await assert.rejects(store.update(task.id,{board:{...board(),selectedTitle:3}},task.revision),/selectedTitle/);
 const single=await store.create({mode:'observation'});assert.equal(single.stage,'topic');
 const tool=createAgentTools({root,taskId:single.id,taskStore:store,approve:async()=>false});await tool('draft_create',{id:single.articleId,title:'实际初稿',markdown:'# 实际初稿'});
 assert.equal((await store.get(single.id)).stage,'draft');
});

test('ending a conversation is durable and forbids generation mutations while keeping its work and view state',async t=>{
 const {root,store}=await fixture(t),task=await store.create({mode:'observation'});
 const tools=createAgentTools({root,taskId:task.id,taskStore:store,approve:async()=>false});
 await tools('draft_create',{id:task.articleId,title:'留下稿件',markdown:'# 留下稿件'});
 await store.runtime(task.id,{busy:true,status:'执行中'});await assert.rejects(store.finish(task.id),/先停止/);
 await store.runtime(task.id,{busy:false,status:'已完成'});
 assert.equal((await store.get(task.id)).completedAt,undefined,'one run finishing is not the whole task finishing');
 const session=join(store.dir(task.id),'cursor','session.json');await mkdir(join(store.dir(task.id),'cursor'),{recursive:true});
 const history=JSON.stringify({sessionId:'retained',history:[{id:'user-1',role:'user',text:'保留创作过程'}]});await writeFile(session,history);
 const ended=await store.finish(task.id);assert.ok(ended.completedAt);
 const restored=await new TaskStore(root).get(task.id);assert.equal(restored.completedAt,ended.completedAt);
 assert.ok((await new TaskStore(root).list()).some(t=>t.id===task.id&&t.completedAt));assert.ok(restored.workIds.includes(task.articleId));assert.equal(await readFile(session,'utf8'),history);
 assert.equal((await store.finish(task.id)).completedAt,ended.completedAt);
 assert.ok((await readDraft(task.articleId,root)).markdown.includes('留下稿件'));
 await assert.rejects(store.update(task.id,{board:board()},restored.revision),/对话已结束/);
 await assert.rejects(tools('draft_save',{id:task.articleId,markdown:'# overwrite',expectedSha256:(await readDraft(task.articleId,root)).sha256}),/对话已结束/);
 await store.update(task.id,{title:'可重命名',ui:{flowLogScroll:24}},restored.revision);
 assert.equal((await store.get(task.id)).ui.flowLogScroll,24);
});
test('delivery closure requires a confirmed receipt and does not close an unsubmitted draft',async t=>{
 const {root,store}=await fixture(t),task=await store.create({mode:'observation'});
 const tools=createAgentTools({root,taskId:task.id,taskStore:store,approve:async()=>false});
 await tools('draft_create',{id:task.articleId,title:'还没交稿',markdown:'# 等待交稿'});
 await assert.rejects(store.finish(task.id,{delivered:true}),/尚未确认|配图占位/);
 assert.equal((await store.get(task.id)).completedAt,undefined);
});

async function publicDeliveryFixture(t){
 const {root}=await fixture(t);let releaseCount=0,detail;
 const client={inspect:async()=>detail,releaseLocal:async()=>{releaseCount++;return {...detail,localReleased:true};}};
 const store=new TaskStore(root,{publisher:()=>client});let task=await store.create({mode:'observation'});
 task=await store.update(task.id,{board:board()},task.revision);task=await store.confirm(task.id,'topic',task.revision);task=await store.update(task.id,{outline:outline()},task.revision);task=await store.confirm(task.id,'outline',task.revision);
 await createDraft({id:task.articleId,title:'官网交稿',markdown:'# 官网交稿\n\n'+('保留核实来源与完整事实正文。'.repeat(16))+'\n\n[来源](https://example.org/source)'},root);
 const draft=await readDraft(task.articleId,root);task=await store.generated(task.id,task.articleId,draft.sha256);
 detail={id:task.articleId,stage:'published',sourceSha256:draft.sha256,sync:{state:'synced',baseRevision:2,remoteRevision:2},receipt:{requestKey:'public-request',revision:2,publicReadback:true,job:{status:'success'}}};
 return {root,store,task,client,get detail(){return detail;},set detail(value){detail=value;},get releaseCount(){return releaseCount;}};
}

test('public delivery closes only after verified local retirement and preserves its original request proof',async t=>{
 const f=await publicDeliveryFixture(t),{root,store,task}=f;
 f.detail={...f.detail,stage:'draft_saved',receipt:{...f.detail.receipt,publicReadback:false}};
 await assert.rejects(store.finish(task.id,{destination:'cloud',delivered:true}),/官网公开结果尚未确认/);
 assert.equal(f.releaseCount,0);assert.equal((await store.get(task.id)).completedAt,undefined);
 f.detail={...f.detail,stage:'published',receipt:{...f.detail.receipt,publicReadback:true}};
 for(const proof of [{publicReadback:false},{job:{status:'running'}}]){const original=f.detail;f.detail={...original,receipt:{...original.receipt,...proof}};await assert.rejects(store.finish(task.id,{destination:'cloud',delivered:true}),/官网公开结果尚未确认/);f.detail=original;}
 f.detail={...f.detail,sync:{state:'synced',baseRevision:1,remoteRevision:2}};await assert.rejects(store.finish(task.id,{destination:'cloud',delivered:true}),/交稿结果尚未确认/);f.detail={...f.detail,sync:{state:'synced',baseRevision:2,remoteRevision:2}};
 await assert.rejects(store.finish(task.id,{destination:'cloud',delivered:true,expectedSha256:'stale-body-sha'}),/正文已变化/);
 const verified=await store.get(task.id);for(const stale of [{topicConfirmed:null},{outlineConfirmed:null},{draftStale:true}]){await store.save({...verified,...stale});await assert.rejects(store.finish(task.id,{destination:'cloud',delivered:true}),/确认已失效/);assert.equal((await store.get(task.id)).completedAt,undefined);}await store.save(verified);
 f.client.releaseLocal=async()=>{const pending=await store.get(task.id);assert.equal(pending.completedAt,undefined);assert.equal(pending.delivery.phase,'retiring');assert.equal(pending.delivery.sha256,(await readDraft(task.articleId,root)).sha256);return {...f.detail,localReleased:true};};
 const ended=await store.finish(task.id,{destination:'cloud',delivered:true,expectedRevision:task.revision,expectedSha256:(await readDraft(task.articleId,root)).sha256});assert.ok(ended.completedAt);assert.equal(ended.delivery.requestKey,'public-request');assert.equal(ended.delivery.phase,'complete');assert.equal(ended.delivery.destination,'cloud');
});

test('cleanup failure remains an unfinished delivery, survives reload and retries without resubmission',async t=>{
 const f=await publicDeliveryFixture(t),{store,task}=f;
 f.client.releaseLocal=async()=>({...f.detail,stage:'cleanup',localReleased:false,cleanupError:'CONFLICT: 人工编辑已变化'});
 await assert.rejects(store.finish(task.id,{destination:'cloud',delivered:true}),/本地副本回收未完成/);
 const blocked=await new TaskStore(f.root).get(task.id);assert.equal(blocked.completedAt,undefined);assert.equal(blocked.delivery.phase,'cleanup_blocked');assert.match(blocked.delivery.error,/人工编辑/);
 await assert.rejects(store.finish(task.id),/先完成本地副本回收/);
 await assert.rejects(store.finish(task.id,{destination:'local',expectedRevision:task.revision,expectedSha256:f.detail.sourceSha256}),/先完成本地副本回收/);
 f.client.releaseLocal=async()=>({...f.detail,localReleased:true});const ended=await store.finish(task.id,{destination:'cloud',delivered:true});assert.ok(ended.completedAt);assert.equal(ended.delivery.phase,'complete');assert.equal(ended.delivery.error,undefined);
});

test('an interrupted final task save recovers only its exact validated public archive proof',async t=>{
 const f=await publicDeliveryFixture(t),{store,task}=f;
 f.client.releaseLocal=async()=>({...f.detail,localReleased:false,cleanupError:'暂停回收'});
 await assert.rejects(store.finish(task.id,{destination:'cloud',delivered:true}));
 f.detail={...f.detail,localReleased:true,sync:undefined};f.client.releaseLocal=async()=>{throw Error('已回收不能再次操作正文');};
 const pending=await store.get(task.id);await store.save({...pending,revision:pending.revision+1});await assert.rejects(store.finish(task.id,{destination:'cloud',delivered:true}),/确认记录与云端归档不一致/);await store.save(pending);
 const ended=await store.finish(task.id,{destination:'cloud',delivered:true});assert.ok(ended.completedAt);assert.equal(ended.delivery.phase,'complete');
});

test('background reconciliation finishes idle public deliveries and keeps busy or stale tasks pending',async t=>{
 const f=await publicDeliveryFixture(t),{store,task}=f;
 await store.runtime(task.id,{busy:true,status:'正在生成'});assert.deepEqual((await store.reconcileArticleDelivery({client:f.client})).results,[]);assert.equal(f.releaseCount,0);
 await store.runtime(task.id,{busy:false,status:'已完成'});const current=await store.get(task.id);await store.save({...current,draftStale:true});let result=await store.reconcileArticleDelivery({client:f.client});assert.equal(result.changed,false);assert.equal(result.results[0].stage,'delivery_blocked');assert.equal((await store.get(task.id)).completedAt,undefined);
 await store.save(current);result=await store.reconcileArticleDelivery({client:f.client});assert.equal(result.changed,true);assert.equal(result.results[0].stage,'complete');assert.ok((await store.get(task.id)).completedAt);assert.equal(f.releaseCount,1);
});

test('agent publication tools prepare public previews and resolve legacy requests without submitting or closing tasks',async t=>{
 const {root,store}=await fixture(t),task=await store.create({mode:'observation'}),calls=[],events=[];
 const privateDetail={id:task.articleId,title:'旧草稿',stage:'draft_saved',prepared:{intent:'draft',packetSha256:'legacy-sha'},receipt:{status:'draft_saved',publicReadback:false}};
 const client={prepare:async(id,params)=>{calls.push(['prepare',params]);return privateDetail;},inspect:async()=>privateDetail,status:async()=>privateDetail,publish:async()=>{throw Error('不应重复提交');}};
 const tools=createAgentTools({root,taskId:task.id,taskStore:store,client,approve:async()=>{throw Error('不应申请新的提交确认');},emit:e=>events.push(e)});
 await assert.rejects(tools('cloud_prepare',{id:task.articleId,intent:'draft'}),/云端交稿即公开/);
 await tools('cloud_prepare',{id:task.articleId});assert.deepEqual(calls,[['prepare',{intent:'publish',metadata:undefined,releaseLocal:false}]]);
 await assert.rejects(tools('cloud_submit',{id:task.articleId}),/旧预览为非公开草稿/);
 const old=await tools('cloud_status',{id:task.articleId});assert.equal(old.stage,'draft_saved');assert.equal((await store.get(task.id)).completedAt,undefined);assert.equal(events.some(e=>e.type==='task_changed'),false);
});

test('xiwen starts with a one-week window and preserves an explicit override',async t=>{
 const {store}=await fixture(t);
 assert.equal((await store.create({mode:'xiwen'})).days,7);
 assert.equal((await store.create({mode:'xiwen',days:14})).days,14);
 assert.equal((await store.create({mode:'observation'})).days,30);
});

test('a single-material type confirms its topic with exactly one chosen material; the digest may keep several',async t=>{
 const {store}=await fixture(t);
 const item=(id,selected)=>({id,title:'事件 '+id,summary:'事实摘要',url:'https://example.org/'+id,publisher:'机构',date:'2026-10-02',eventKey:id,selected,excluded:!selected});
 const two={titles:[],sections:[{id:'s',title:'候选',items:[item('a',true),item('b',true)]}]};
 for(const mode of ['observation','opensource','calendar','history']){
  let task=await store.create({mode});task=await store.update(task.id,{board:two},task.revision);
  await assert.rejects(store.confirm(task.id,'topic',task.revision),/只围绕一张素材/);
  task=await store.update(task.id,{board:{titles:[],sections:[{id:'s',title:'候选',items:[item('a',true),item('b',false)]}]}},task.revision);
  assert.ok((await store.confirm(task.id,'topic',task.revision)).topicConfirmed);
 }
 let digest=await store.create({mode:'xiwen'});digest=await store.update(digest.id,{board:two},digest.revision);
 assert.ok((await store.confirm(digest.id,'topic',digest.revision)).topicConfirmed);
});
