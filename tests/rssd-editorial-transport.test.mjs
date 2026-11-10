import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEditorialCenterTransport} from '../scripts/rssd-editorial-transport.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {createDraft} from '../scripts/editorial-workspace.mjs';
import {DEFAULT_SITE,publicationDirectory} from '../scripts/site-config.mjs';
import {renderArticle} from '../scripts/article-format.mjs';
import {randomUUID} from 'node:crypto';

const token='rssd_device_'+'s'.repeat(48),site=DEFAULT_SITE;
async function fixture(t,{configured=true}={}){
  const root=await mkdtemp(join(tmpdir(),'rssd-editorial-transport-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=join(root,'center');await mkdir(directory);
  if(configured)await writeFile(join(directory,'connection.json'),JSON.stringify({origin:'https://center.example',token}));
  const calls=[],state={writable:true,version:0,publishedVersion:null,data:null,receipt:null,loseResponse:false,section:'briefings',siteId:site.id,orgId:'example-org',articleId:'test-center-article',project:value=>value};
  const path='/original-path/article/';
  const fetcher=async(url,options={})=>{
    const parsed=new URL(url);calls.push({url,options});
    if(parsed.origin===site.origin)return new Response('<link rel="canonical" href="'+site.origin+path+'"><div class="article-body">'+renderArticle(state.data.markdown.replace(/^# [^\n]+\n+/,''))+'</div>');
    assert.equal(parsed.origin,'https://center.example');
    assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+token);
    const route=parsed.pathname;
    if(route==='/api/rssd/v1/identity')return Response.json({orgId:state.orgId});
    if(route==='/api/rssd/v1/registry')return Response.json({workspaces:[{id:site.spaceId,siteId:state.siteId,writable:state.writable,sections:[{id:state.section,name:'Synthetic section'}]}]});
    if(route.endsWith('/site'))return Response.json({protocol:'scholay-content',version:1,siteId:site.id,spaceId:site.spaceId,origin:site.origin,centerManaged:true});
    if(route.endsWith('/catalog'))return Response.json({items:[],next:null,generation:1,scope:'all',centerManaged:true});
    if(route.endsWith('/publish')||route.endsWith('/drafts')){
      const packet=JSON.parse(options.body);state.packet=packet;state.version++;state.data=packet.data;
      state.receipt={requestKey:packet.requestKey,articleId:packet.data.id,revision:state.version,version:state.version,publishedVersion:state.publishedVersion,url:path,centerManaged:true,...(route.endsWith('/drafts')?{status:'draft_saved'}:{job:{id:packet.requestKey,status:'queued'}})};
      if(state.loseResponse)throw Error('Response lost after acceptance');
      return Response.json(state.receipt);
    }
    if(route.includes('/requests/'))return state.receipt?Response.json(state.receipt):Response.json({message:'Missing',code:'not_found'},{status:404});
    if(route.includes('/source-archives/private-notes/'))return Response.json({articleId:state.data?.id,revision:null,privateEditorial:null});
    if(route.includes('/cloud/')||route.includes('/published/')||route.endsWith('/'+state.articleId))return Response.json({version:state.version,publishedVersion:state.publishedVersion,url:path,data:state.data?state.project(state.data):null,published:state.publishedVersion?state.project(state.data):null,centerManaged:true});
    throw Error('Unexpected route '+route);
  };
  const transport=createEditorialCenterTransport({site,directory,fetcher});
  return {root,directory,calls,state,fetcher,transport};
}
async function manuscript(t,{structured=false,section='briefings'}={}){
  const f=await fixture(t);
  f.state.section=section;f.state.articleId=structured?'record-'+randomUUID():'test-center-article';
  await mkdir(join(f.root,'_ops/inventory'),{recursive:true});
  await writeFile(join(f.root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:['新闻聚合'],articles:{}}));
  const fields={title:'中心测试稿',date:'2026-11-01',category:site.sourceCategories[0],summary:'测试摘要',value:'研究价值',url:'https://example.org/project',relatedUrl:'',status:'公开收录'};
  const draft=await createDraft({id:f.state.articleId,title:'中心测试稿',markdown:structured?'# 中心测试稿\n\n## 项目简介\n\n测试摘要\n\n## 学术价值\n\n研究价值':'# 中心测试稿\n\n完整正文。',...(structured?{archiveCategory:site.columns[2],record:{kind:'openSource',fields}}:{})},f.root);
  let kicks=0;
  const client=createWebsitePublisher({root:f.root,site,centerDirectory:f.directory,fetcher:f.fetcher,queueKick:async()=>{kicks++;}});
  const metadata={date:'2026-11-01',summary:'测试摘要',author:'测试作者',category:structured?site.columns[2]:'新闻聚合',sectionId:section};
  const prepared=await client.prepare(draft.id,{metadata});
  return {...f,draft,client,prepared,metadata,kicks:()=>kicks};
}

test('center selection is durable and never falls back to a legacy writer on missing credentials or identity mismatch',async t=>{
  const f=await fixture(t,{configured:false});assert.equal(await f.transport.active(),false);
  await writeFile(join(f.directory,'connection.json'),JSON.stringify({origin:'https://center.example'}));
  assert.equal(await f.transport.active(),true);
  const missing=createEditorialCenterTransport({site,directory:f.directory,fetcher:f.fetcher,token:''});
  await assert.rejects(missing.request('/catalog'),/中心设备凭据/);assert.equal(f.calls.length,0);
  f.state.siteId='other-site';await writeFile(join(f.directory,'connection.json'),JSON.stringify({origin:'https://center.example',token}));
  const mismatch=createEditorialCenterTransport({site,directory:f.directory,fetcher:f.fetcher});
  await assert.rejects(mismatch.request('/catalog'),/站点身份/);
  assert(f.calls.every(call=>new URL(call.url).origin==='https://center.example'));
});

test('cached cloud reads and device credentials remain bound to the connected organization',async t=>{
  const f=await fixture(t),file=join(f.directory,'connection.json');
  await writeFile(file,JSON.stringify({origin:'https://center.example',token,identity:{orgId:'example-org'}}));
  const first=await f.transport.cacheIdentity();await f.transport.request('/catalog');
  f.state.orgId='different-org';
  const restarted=createEditorialCenterTransport({site,directory:f.directory,fetcher:f.fetcher});
  await assert.rejects(restarted.request('/catalog'),{statusCode:403});
  await writeFile(file,JSON.stringify({origin:'https://center.example',token,identity:{orgId:'different-org'}}));
  assert.notEqual(await f.transport.cacheIdentity(),first);
});

test('malformed center configuration stays private and does not enable a legacy write fallback',async t=>{
  const f=await fixture(t),file=join(f.directory,'connection.json');
  await writeFile(file,'{"token":"PRIVATE_CONFIG_SENTINEL",broken');
  await assert.rejects(f.transport.request('/publish',{}),error=>!error.message.includes('PRIVATE_CONFIG_SENTINEL')&&error.message.includes('中心连接配置'));
  await writeFile(file,JSON.stringify({origin:'https://user:PRIVATE_CONFIG_SENTINEL@center.example',token}));
  await assert.rejects(f.transport.request('/publish',{}),error=>!error.message.includes('PRIVATE_CONFIG_SENTINEL')&&error.message.includes('credentials'));
  assert.equal(f.calls.length,0);
});

test('staged workspaces remain readable while writes fail before any submission',async t=>{
  const f=await fixture(t);f.state.writable=false;
  assert.equal((await f.transport.request('/catalog?scope=all')).generation,1);
  await assert.rejects(f.transport.request('/publish',{requestKey:'same-request'}),{statusCode:409,code:'migration_staged'});
  assert(!f.calls.some(call=>call.options.method==='POST'));
});

test('desktop enqueue reaches the center directly and original timeout receipt recovers without duplicate POST or old continuation',async t=>{
  const f=await manuscript(t);
  await writeFile(join(f.root,'.local/publication-queue.json'),JSON.stringify({version:1,enabled:true,endpoint:'https://old-queue.example',continuationOwner:'cloud'}));
  f.state.loseResponse=true;
  await assert.rejects(f.client.enqueue(f.draft.id,{packetSha256:f.prepared.prepared.packetSha256}),/unreachable/);
  const pending=await f.client.inspect(f.draft.id);assert.equal(pending.stage,'unknown');
  const recovered=await f.client.status(f.draft.id);assert.equal(recovered.stage,'queued');
  assert.equal(recovered.receipt.requestKey,f.prepared.prepared.requestKey);assert.equal(recovered.receipt.centerManaged,true);
  assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(f.kicks(),0);
  await assert.rejects(readFile(join(f.root,'.local/publishing-flow/submissions',recovered.receipt.requestKey+'.json')),{code:'ENOENT'});
  f.state.receipt.job.status='success';f.state.publishedVersion=1;
  const published=await f.client.status(f.draft.id);
  assert.equal(published.stage,'published');assert.equal(published.receipt.publicReadback,true);
  assert.deepEqual(published.receipt.publishingFlow,{status:'center_managed',owner:'center'});
  assert(!f.calls.some(call=>new URL(call.url).hostname==='old-queue.example'));
  assert(!JSON.stringify(published).includes(token));
});

test('an old locally queued packet keeps its request identity when recovered into the center',async t=>{
  const f=await manuscript(t),key=f.prepared.prepared.requestKey;
  const receiptFile=join(publicationDirectory(f.root),f.draft.id,'receipt.json');
  await writeFile(receiptFile,JSON.stringify({intent:'publish',requestKey:key,status:'local_queued',job:{id:key,status:'queued'},asyncQueue:{owner:'cloud',phase:'queued',endpoint:'https://old-queue.example',packetSha256:f.prepared.prepared.packetSha256}}));
  const recovered=await f.client.runQueued(f.draft.id);
  assert.equal(recovered.receipt.requestKey,key);assert.equal(recovered.receipt.centerManaged,true);assert.equal(recovered.receipt.asyncQueue,undefined);
  assert.equal(recovered.receipt.legacyAsyncQueue.endpoint,'https://old-queue.example');
  assert.equal(f.state.packet.requestKey,key);assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(f.kicks(),0);
});

test('querying an absent old request keeps its preview and allows explicit retry of the original identity',async t=>{
  const f=await manuscript(t),key=f.prepared.prepared.requestKey;
  const receiptFile=join(publicationDirectory(f.root),f.draft.id,'receipt.json');
  await writeFile(receiptFile,JSON.stringify({intent:'publish',requestKey:key,status:'local_queued',job:{id:key,status:'queued'},asyncQueue:{owner:'cloud',phase:'queued',endpoint:'https://old-queue.example',packetSha256:f.prepared.prepared.packetSha256}}));
  const queried=await f.client.status(f.draft.id);
  assert.equal(queried.receipt.status,'not_submitted');assert.equal(queried.receipt.job,undefined);assert.equal(queried.prepared.requestKey,key);
  await f.client.publish(f.draft.id,{packetSha256:f.prepared.prepared.packetSha256,retry:true});
  assert.equal(f.state.packet.requestKey,key);assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);
});

test('a center migration fence retains a queued manuscript without contacting its old queue',async t=>{
  const f=await manuscript(t),key=f.prepared.prepared.requestKey;
  const receiptFile=join(publicationDirectory(f.root),f.draft.id,'receipt.json');
  await writeFile(receiptFile,JSON.stringify({intent:'publish',requestKey:key,status:'local_queued',job:{id:key,status:'queued'},asyncQueue:{owner:'cloud',phase:'queued',endpoint:'https://old-queue.example',packetSha256:f.prepared.prepared.packetSha256}}));
  f.state.writable=false;
  await assert.rejects(f.client.runQueued(f.draft.id),{code:'migration_staged'});
  const retained=await f.client.inspect(f.draft.id);assert.equal(retained.prepared.requestKey,key);assert.equal(retained.receipt.status,'local_queued');
  assert.equal(f.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(f.kicks(),0);
});

test('independent English center editions can be opened without an invented Chinese source',async t=>{
  const f=await manuscript(t);f.state.version=1;f.state.data={...f.state.data,id:f.draft.id,title:'English original',summary:'Summary',markdown:'# English original\n\nBody.',date:'2026-11-01',author:'Author',category:'News',sectionId:'briefings',assets:[],locale:'en'};
  const detail=await f.client.cloud(f.draft.id);assert.equal(detail.title,'English original');assert(detail.html.includes('Body.'));
});

test('center-added sections can be prepared and retained for subsequent offline local editing',async t=>{
  const f=await manuscript(t,{section:'archive'});assert.equal(f.prepared.metadata.sectionId,'archive');
  const cached=JSON.parse(await readFile(join(f.root,'.local/site-section-catalog.json'),'utf8'));
  assert(cached.sections.some(section=>section.id==='archive'));
  const count=f.calls.length,restarted=createWebsitePublisher({root:f.root,centerDirectory:f.directory,fetcher:f.fetcher});
  assert.equal((await restarted.inspect(f.draft.id)).metadata.sectionId,'archive');assert.equal(f.calls.length,count);
});

test('structured center projections retain semantic identity across reordered fields, defaults and failed revisions',async t=>{
  const f=await manuscript(t,{structured:true,section:'open-source'});
  f.state.project=value=>{
    const {relatedUrl,status,sectionId,...retained}=value.record.fields;
    return {...Object.fromEntries(Object.entries(value).reverse()),record:{fields:Object.fromEntries(Object.entries(retained).reverse()),kind:value.record.kind,documentId:value.record.documentId}};
  };
  await f.client.publish(f.draft.id,{packetSha256:f.prepared.prepared.packetSha256});
  f.state.receipt.job.status='failed';assert.equal((await f.client.status(f.draft.id)).stage,'failed');
  const retry=await f.client.prepare(f.draft.id,{metadata:f.metadata});assert.equal(retry.prepared.expectedVersion,1);
  await f.client.publish(f.draft.id,{packetSha256:retry.prepared.packetSha256});
  f.state.receipt.job.status='success';f.state.publishedVersion=2;
  const published=await f.client.status(f.draft.id);assert.equal(published.stage,'published');assert.equal(published.receipt.readbackError,undefined);
});

test('retired columns retain existing Center manuscript identities but cannot be selected for a new manuscript',async t=>{
 const f=await manuscript(t),first=await f.client.publish(f.draft.id,{packetSha256:f.prepared.prepared.packetSha256});
 assert(first);f.state.section='new-formal-column';
 const base=f.fetcher;
 const fetcher=async(url,options={})=>{
  const response=await base(url,options);
  if(new URL(url).pathname.endsWith('/'+f.state.articleId)){
   const data=await response.json();return Response.json({...data,workId:'imported-existing-work'});
  }
  return response;
 };
 const client=createWebsitePublisher({root:f.root,site,centerDirectory:f.directory,fetcher});
 await client.status(f.draft.id).catch(()=>{});
 // Settle the original publication receipt before preparing another revision.
 f.state.receipt.job.status='success';f.state.publishedVersion=1;
 await client.status(f.draft.id);
 const local=await client.inspect(f.draft.id);
 const retained=await client.localAction(f.draft.id,{action:'metadata',expectedSourceSha256:local.sourceSha256,expectedMetadataSha256:local.metadataSha256,metadata:{...local.metadata}});
 assert.equal(retained.metadata.sectionId,'briefings');
 const prepared=await client.prepare(f.draft.id,{metadata:f.metadata});assert.equal(prepared.metadata.sectionId,'briefings');
 f.state.data=null;f.state.version=0;
 await assert.rejects(client.prepare(f.draft.id,{metadata:f.metadata}),/可写的栏目/);
});
