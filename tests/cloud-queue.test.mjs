import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {createCloudQueue,cloudJobId} from '../scripts/cloud-queue.mjs';
import {createCloudQueueServer} from '../scripts/cloud-queue-server.mjs';
import {renderArticle} from '../web/engine/article-math.mjs';
import {headingAnchors} from '../web/themes/structures.mjs';
import {recordMarkdown} from '../scripts/editorial-record.mjs';
import {createServer} from 'node:http';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {makePublic} from './fixtures/private-file.mjs';

const site={...profiles.find(value=>value.id==='metho'),languages:['zh-CN','en']};
const data={id:'cloud-queue-pilot',title:'持久队列验证',summary:'测试正文',markdown:'# 持久队列验证\n\n完整正文与[来源](https://example.org/paper)。',date:'2026-10-23',author:site.author,category:site.columns[0],assets:[]};
const packet={siteId:site.id,spaceId:site.spaceId,origin:site.origin,intent:'publish',data,expectedVersion:0,expectedPublishedVersion:null,requestKey:'cloud-request-original-001',sourceSha256:'a'.repeat(64),preparedAt:'2026-10-23T03:00:00Z'};
async function fixture(t,{fetcher,continuation,...options}={}){
 const root=await mkdtemp(join(tmpdir(),'today-cloud-queue-'));t.after(()=>rm(root,{recursive:true,force:true}));const tokenFile=join(root,'token');await writeFile(tokenFile,'TOKEN_NOT_FOR_LOGS',{mode:0o600});await protectPrivateFile(tokenFile);const directory=join(root,'queue');let time=1000000;
 const config={directory,sites:[{site,tokenFile}],fetcher,continuation,now:()=>time,...options};const queue=createCloudQueue(config);
 return {root,directory,tokenFile,queue,config,advance:(milliseconds=30000)=>time+=milliseconds,state:async jobId=>JSON.parse(await readFile(join(directory,'jobs',jobId,'state.json'),'utf8'))};
}
function website({postMode='success',lookupFailure,buildStatus='success',canonical=true,body=true,changed=false}={}){
 let sends=0,lookups=0,request,failedOnce=false,buildRetries=0;
 const receipt=()=>({revision:1,url:'/news/'+data.id+'/',job:{id:'website-original-job',status:buildStatus}});
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin});
  if(path==='/manage/api/news/publish'){sends++;request=JSON.parse(options.body);if(postMode==='timeout'&&!failedOnce){failedOnce=true;throw Error('network response lost after acceptance');}return Response.json(receipt());}
  if(path==='/manage/api/news/requests/'+packet.requestKey+'/retry'){buildRetries++;buildStatus='success';return Response.json(receipt());}
  if(path.startsWith('/manage/api/news/requests/')){lookups++;if(lookupFailure)return Response.json({error:'unavailable'},{status:lookupFailure});return request?Response.json(receipt()):Response.json({error:'missing'},{status:404});}
  if(path==='/manage/api/news/'+data.id)return Response.json({version:1,publishedVersion:1,data:request?.data,published:changed?{...request?.data,markdown:'Another version'}:request?.data});
  if(path==='/news/'+data.id+'/')return new Response('<html>'+(canonical?'<link rel="canonical" href="'+site.origin+path+'">':'')+(body?'<div class="article-body">'+renderArticle(data.markdown.replace(/^# [^\n]+\n+/,''))+'</div>':'')+'</html>');
  throw Error('Unexpected fake website route '+path);
 };
 return {fetcher,get sends(){return sends;},get lookups(){return lookups;},get buildRetries(){return buildRetries;},get request(){return request;}};
}
test('durable acknowledgement freezes image-complete package, deduplicates and rejects key mutation',async t=>{
 const f=await fixture(t,{fetcher:async()=>assert.fail('Enqueue must not contact a website')});const accepted=await f.queue.enqueue(site.id,packet);assert.equal(accepted.status,'queued');assert.equal(accepted.jobId,cloudJobId(site.id,packet.requestKey));
 assert.deepEqual(JSON.parse(await readFile(join(f.directory,'jobs',accepted.jobId,'packet.json'),'utf8')),packet);assert.deepEqual(await readdir(join(f.directory,'pending')),[accepted.jobId+'.json']);
 const again=await f.queue.enqueue(site.id,structuredClone(packet));assert.equal(again.jobId,accepted.jobId);assert.equal((await f.queue.list(site.id)).length,1);
 await assert.rejects(f.queue.enqueue(site.id,{...packet,data:{...data,title:'Changed'}}),error=>error.statusCode===409);
 assert.equal((await f.queue.get(site.id,accepted.jobId)).receipt,undefined);assert(!JSON.stringify(accepted).includes('TOKEN_NOT_FOR_LOGS'));assert(!JSON.stringify(accepted).includes('markdown'));
});
test('completed publication requires real source equality and public body/canonical, then disappears from pending scan',async t=>{
 const web=website(),f=await fixture(t,{fetcher:web.fetcher});const accepted=await f.queue.enqueue(site.id,packet);const result=await f.queue.tick();assert.equal(result[0].status,'complete');assert.equal(result[0].receipt.publicReadback,true);assert.equal(web.sends,1);assert.equal(web.lookups,1);assert.deepEqual(await readdir(join(f.directory,'pending')),[]);
 assert.deepEqual(await f.queue.tick(),[]);assert.equal((await f.queue.get(site.id,accepted.jobId)).stage,'published');assert.deepEqual(web.request,packet);
});
test('public verify accepts journal heading anchors on an otherwise exact article body',async t=>{
 const article={...data,markdown:'# 持久队列验证\n\n完整正文。\n\n## 刊刻缘起、经数与碑式\n\n本节说明刊刻背景。'};
 const request={...packet,data:article,requestKey:'cloud-request-heading-anchors-001'};
 const rendered=headingAnchors(renderArticle(article.markdown.replace(/^# [^\n]+\n+/,''))).body;
 assert.match(rendered,/<h2 id="刊刻缘起经数与碑式">/);
 const receipt=()=>({revision:1,url:'/news/'+article.id+'/',job:{id:'website-heading-job',status:'success'}});
 const fetcher=async(url)=>{
  const path=new URL(url).pathname;
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin});
  if(path==='/manage/api/news/publish'||path.startsWith('/manage/api/news/requests/'))return Response.json(receipt());
  if(path==='/manage/api/news/'+article.id)return Response.json({version:1,publishedVersion:1,data:article,published:article});
  if(path==='/news/'+article.id+'/')return new Response('<html><link rel="canonical" href="'+site.origin+path+'"><div class="article-body">'+rendered+'</div></html>');
  throw Error('Unexpected fake website route '+path);
 };
 const f=await fixture(t,{fetcher});
 await f.queue.enqueue(site.id,request);
 const [result]=await f.queue.tick();
 assert.equal(result.status,'complete');assert.equal(result.receipt.publicReadback,true);
});
test('restart after uncertain website POST resumes its original request without publishing twice',async t=>{
 const web=website({postMode:'timeout'}),f=await fixture(t,{fetcher:web.fetcher});const accepted=await f.queue.enqueue(site.id,packet);assert.equal((await f.queue.tick())[0].status,'retry_wait');assert.equal(web.sends,1);
 f.advance();const restarted=createCloudQueue(f.config);const done=await restarted.tick();assert.equal(done[0].status,'complete');assert.equal(web.sends,1);assert.equal(web.lookups,2);assert.equal(done[0].requestKey,packet.requestKey);assert.equal((await f.state(accepted.jobId)).sends,1);
});
test('an ambiguous original-request lookup never falls through to a POST',async t=>{
 const web=website({lookupFailure:503}),f=await fixture(t,{fetcher:web.fetcher});await f.queue.enqueue(site.id,packet);assert.equal((await f.queue.tick())[0].status,'retry_wait');assert.equal(web.sends,0);
});
test('authoritative 404 permits only three sends of the exact immutable packet across restarts',async t=>{
 let sends=0;const fetcher=async(url,options)=>{if(url.endsWith('/api/site'))return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin});if(options.method==='POST'){sends++;assert.deepEqual(JSON.parse(options.body),packet);throw Error('network unavailable');}return Response.json({error:'not found'},{status:404});};
 const f=await fixture(t,{fetcher});await f.queue.enqueue(site.id,packet);
 for(let i=0;i<4;i++){f.advance(300000);await createCloudQueue(f.config).tick();}
 assert.equal(sends,3);assert.equal((await f.queue.get(site.id,cloudJobId(site.id,packet.requestKey))).status,'needs_review');
});
test('source conflicts stop without replay and a missing public body remains recoverable',async t=>{
 const changed=website({changed:true}),f=await fixture(t,{fetcher:changed.fetcher});await f.queue.enqueue(site.id,packet);assert.equal((await f.queue.tick())[0].status,'needs_review');assert.equal(changed.sends,1);
 const absent=website({body:false}),g=await fixture(t,{fetcher:absent.fetcher});await g.queue.enqueue(site.id,packet);assert.equal((await g.queue.tick())[0].status,'retry_wait');assert.equal((await g.queue.get(site.id,cloudJobId(site.id,packet.requestKey))).receipt.publicReadback,undefined);
});
test('website build recovery retains original job and verifies unchanged source before retry',async t=>{
 const web=website({buildStatus:'failed'}),f=await fixture(t,{fetcher:web.fetcher});await f.queue.enqueue(site.id,packet);assert.equal((await f.queue.tick())[0].status,'waiting');assert.equal(web.buildRetries,1);f.advance();assert.equal((await f.queue.tick())[0].status,'complete');assert.equal(web.sends,1);
});
test('continuation handoff failure preserves verified publication and retries only that original identity',async t=>{
 let handoffs=0;const web=website(),f=await fixture(t,{fetcher:web.fetcher,continuation:async({packet:source,receipt})=>{handoffs++;assert.equal(source.requestKey,packet.requestKey);assert.equal(receipt.publicReadback,true);if(handoffs===1)throw Error('temporary disk failure');return {status:'queued',id:'existing-flow-operation'};}});await f.queue.enqueue(site.id,packet,{continuationOwner:'cloud'});
 assert.equal((await f.queue.tick())[0].status,'retry_wait');f.advance();const [done]=await createCloudQueue(f.config).tick();assert.equal(done.status,'complete');assert.equal(done.continuation.id,'existing-flow-operation');assert.equal(web.sends,1);
});
test('HTTP access is authenticated and site-scoped, accepts prefixed and stripped routes, health leaks no state',async t=>{
 const f=await fixture(t,{fetcher:async url=>url.endsWith('/api/site')?Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin}):Response.json({error:'invalid credential'},{status:401})}),server=createCloudQueueServer({queue:f.queue,basePath:'/today-queue'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});const origin='http://127.0.0.1:'+server.address().port;
 const auth={'X-Scholay-Site':site.id,Authorization:'Bearer TOKEN_NOT_FOR_LOGS','Content-Type':'application/json'};
 assert.equal((await fetch(origin+'/v1/jobs')).status,401);assert.equal((await fetch(origin+'/v1/jobs',{headers:{...auth,Authorization:'Bearer wrong'}})).status,401);
 const accepted=await fetch(origin+'/today-queue/v1/jobs',{method:'POST',headers:auth,body:JSON.stringify({siteId:site.id,packet})});assert.equal(accepted.status,202);const task=await accepted.json();
 assert.equal((await fetch(origin+'/v1/jobs/'+task.jobId,{headers:auth})).status,200);assert.equal((await fetch(origin+'/v1/jobs/'+task.jobId,{headers:{...auth,'X-Scholay-Site':'unknown-site'}})).status,401);
 const health=await (await fetch(origin+'/health')).json();assert.deepEqual(Object.keys(health).sort(),['protocol','status','version']);
 assert.equal((await fetch(origin+'/v1/jobs',{method:'POST',headers:auth,body:JSON.stringify({siteId:'another-site',packet})})).status,409);
 assert.equal((await fetch(origin+'/v1/jobs',{method:'POST',headers:auth,body:JSON.stringify({siteId:site.id,packet:{...packet,origin:'https://attacker.example'}})})).status,409);
 assert(!JSON.stringify(await(await fetch(origin+'/v1/jobs',{headers:auth})).json()).includes('TOKEN_NOT_FOR_LOGS'));
});
test('parallel consumers share the existing process-owned worker lock and cannot submit twice',async t=>{
 const web=website(),f=await fixture(t,{fetcher:web.fetcher});await f.queue.enqueue(site.id,packet);const results=await Promise.allSettled([f.queue.tick(),createCloudQueue(f.config).tick()]);for(const result of results)if(result.status==='rejected')assert.match(result.reason.message,/^文件正在保存/);assert.equal(results.filter(result=>result.status==='fulfilled').flatMap(result=>result.value).filter(row=>row.status==='complete').length,1);assert.equal(web.sends,1);
});
test('token files require private permissions and are re-read after rotation',async t=>{
 const f=await fixture(t,{fetcher:async url=>url.endsWith('/api/site')?Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin}):Response.json({error:'invalid credential'},{status:401})});await f.queue.authorize(site.id,'Bearer TOKEN_NOT_FOR_LOGS');await writeFile(f.tokenFile,'ROTATED_SECRET');await assert.rejects(f.queue.authorize(site.id,'Bearer TOKEN_NOT_FOR_LOGS'),error=>error.statusCode===401);await f.queue.authorize(site.id,'Bearer ROTATED_SECRET');await makePublic(f.tokenFile);await assert.rejects(f.queue.authorize(site.id,'Bearer ROTATED_SECRET'),error=>error.statusCode===503);
});
test('tampered durable packet is never submitted and records a review state',async t=>{
 const f=await fixture(t,{fetcher:async()=>assert.fail('Do not access a website with a tampered packet')});const accepted=await f.queue.enqueue(site.id,packet);await writeFile(join(f.directory,'jobs',accepted.jobId,'packet.json'),JSON.stringify({...packet,data:{...data,markdown:'Changed'}}));assert.equal((await f.queue.tick())[0].status,'needs_review');
});
test('a saved state also rejects key mutation when its packet needs reconstruction',async t=>{
 const f=await fixture(t);const accepted=await f.queue.enqueue(site.id,packet);await rm(join(f.directory,'jobs',accepted.jobId,'packet.json'));await assert.rejects(f.queue.enqueue(site.id,{...packet,data:{...data,title:'Another version'}}),error=>error.statusCode===409);assert.equal((await f.queue.enqueue(site.id,packet)).jobId,accepted.jobId);
});
test('cloud draft save uses the draft request ledger and checks saved content without public publication',async t=>{
 const draft={...packet,intent:'draft',requestKey:'cloud-draft-original-001'};let sends=0,saved;
 const f=await fixture(t,{fetcher:async(url,options)=>{
  const path=new URL(url).pathname;
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin});
  if(path.startsWith('/manage/api/news/drafts/requests/'))return Response.json({error:'missing'},{status:404});
  if(path==='/manage/api/news/drafts'){sends++;saved=JSON.parse(options.body);return Response.json({revision:1,version:1,publishedVersion:null});}
  if(path==='/manage/api/news/cloud/'+data.id)return Response.json({version:1,publishedVersion:null,data:saved.data});
  assert.fail('Draft must not reach public publishing: '+path);
 }});await f.queue.enqueue(site.id,draft);const [result]=await f.queue.tick();assert.equal(result.status,'draft_saved');assert.equal(result.receipt.publicReadback,undefined);assert.equal(sends,1);
});
test('structured records keep their actual CMS permalink and complete structured fields',async t=>{
 const documentId='91e52c25-5d3b-4911-9b24-769157a52079',id='record-'+documentId,route='/open-source/2026-10-23-existing-slug/';
 const fields={title:'开放工具',date:'2026-10-23',category:site.sourceCategories[0],summary:'完整项目介绍',value:'使用方法和限制',url:'https://example.org/project',relatedUrl:'',status:'公开收录'};
 const source={...data,id,title:fields.title,summary:fields.summary,category:site.columns[2],markdown:recordMarkdown('openSource',fields),record:{documentId,kind:'openSource',fields}};
 const prepared={...packet,data:source};let saved,sends=0;
 const f=await fixture(t,{fetcher:async(url,options)=>{
  const path=new URL(url).pathname;
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin});
  if(path==='/manage/api/news/publish'){sends++;saved=JSON.parse(options.body);return Response.json({revision:1,url:route,job:{id:'structured-job',status:'success'}});}
  if(path.startsWith('/manage/api/news/requests/'))return Response.json({error:'missing'},{status:404});
  if(path==='/manage/api/news/'+id)return Response.json({version:1,publishedVersion:1,data:saved.data,published:saved.data,url:route});
  assert.equal(path,route);return new Response('<link rel="canonical" href="'+site.origin+route+'">');
 }});await f.queue.enqueue(site.id,prepared);const [done]=await f.queue.tick();assert.equal(done.status,'complete');assert.equal(done.receipt.url,route);assert.equal(sends,1);assert.deepEqual(saved.data.record,source.record);
});
test('real loopback website HTTP survives the gateway boundary and verifies the final public page',async t=>{
 let localSite,prepared,stored,sends=0;
 const website=createServer(async(request,response)=>{
  const json=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
  if(request.url==='/manage/api/site')return json(200,{protocol:'scholay-content',version:1,siteId:localSite.id,origin:localSite.origin});
  if(request.url==='/manage/api/news/publish'){const chunks=[];for await(const chunk of request)chunks.push(chunk);stored=JSON.parse(Buffer.concat(chunks));sends++;return json(200,{revision:1,url:'/news/'+data.id+'/',job:{id:'http-job',status:'success'}});}
  if(request.url.startsWith('/manage/api/news/requests/'))return json(stored?200:404,stored?{revision:1,url:'/news/'+data.id+'/',job:{id:'http-job',status:'success'}}:{error:'missing'});
  if(request.url==='/manage/api/news/'+data.id)return json(200,{version:1,publishedVersion:1,data:stored.data,published:stored.data});
  response.end('<link rel="canonical" href="'+localSite.origin+'/news/'+data.id+'/"><div class="article-body">'+renderArticle(data.markdown.replace(/^# [^\n]+\n+/,''))+'</div>');
 });
 await new Promise(resolve=>website.listen(0,'127.0.0.1',resolve));t.after(()=>{website.closeAllConnections();return new Promise(resolve=>website.close(resolve));});localSite={...site,origin:'http://127.0.0.1:'+website.address().port};prepared={...packet,origin:localSite.origin};const f=await fixture(t);const queue=createCloudQueue({...f.config,fetcher:fetch,sites:[{site:localSite,tokenFile:f.tokenFile}]});
 const gateway=createCloudQueueServer({queue});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));t.after(()=>{gateway.closeAllConnections();return new Promise(resolve=>gateway.close(resolve));});const origin='http://127.0.0.1:'+gateway.address().port;
 const response=await fetch(origin+'/v1/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Scholay-Site':site.id,Authorization:'Bearer TOKEN_NOT_FOR_LOGS'},body:JSON.stringify({siteId:site.id,packet:prepared})});assert.equal(response.status,202);assert.equal(sends,0);const [result]=await queue.tick();assert.equal(result.status,'complete');assert.equal(sends,1);assert.deepEqual(stored,prepared);
});
test('idempotent acknowledgement returns while the consumer is waiting on its website response',async t=>{
 let started,release;const sending=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),web=website();
 const f=await fixture(t,{fetcher:async(url,options)=>{if(url.endsWith('/publish')){started();await gate;}return web.fetcher(url,options);}});await f.queue.enqueue(site.id,packet);const running=f.queue.tick();await sending;
 // Windows validates the private file with a separate PowerShell ACL query.
 // Keep the provider response blocked throughout; the assertion is independent
 // acknowledgement, not a benchmark of process startup under parallel tests.
 let timer;try{const accepted=await Promise.race([f.queue.enqueue(site.id,packet),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ACK waited behind consumer network operation')),process.platform==='win32'?30000:300);})]);assert.equal(accepted.accepted,true);assert.equal(accepted.status,'running');}finally{clearTimeout(timer);release();await running;}
 assert.equal(web.sends,1);
});
test('cloud progress overlays the existing trusted continuation queue without changing Chinese completion',async t=>{
 const web=website(),f=await fixture(t,{fetcher:web.fetcher}),flowId='c'.repeat(40),workspaceRoot=join(f.root,'cloud-space'),stateFile=join(workspaceRoot,'.local/publishing-flow/jobs',flowId,'state.json');
 const queue=createCloudQueue({...f.config,sites:[{site,tokenFile:f.tokenFile,workspaceRoot}],continuation:async()=>({status:'queued',id:flowId})});const accepted=await queue.enqueue(site.id,packet,{continuationOwner:'cloud'});await queue.tick();await mkdir(join(stateFile,'..'),{recursive:true});await writeFile(stateFile,JSON.stringify({status:'waiting',complete:false,translation:{status:'ready'},english:{status:'queued'},community:{status:'verified',url:'https://enterscholar.com/t/example/123'}}));
 const pending=await queue.get(site.id,accepted.jobId);assert.equal(pending.status,'complete');assert.equal(pending.continuation.status,'waiting');assert.equal(pending.continuation.english.status,'queued');assert.equal(pending.continuation.community.status,'verified');
 await writeFile(stateFile,JSON.stringify({status:'waiting',complete:true,english:{status:'verified',url:site.origin+'/en/news/'+data.id+'/'},community:{status:'verified',url:'https://enterscholar.com/t/example/123'}}));const [complete]=await queue.list(site.id);assert.equal(complete.continuation.status,'complete');assert.equal(complete.continuation.complete,true);assert.equal(complete.status,'complete');assert.equal(web.sends,1);
});
