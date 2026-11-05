import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {createCloudQueue} from '../scripts/cloud-queue.mjs';
import {createCloudQueueServer} from '../scripts/cloud-queue-server.mjs';
import {renderArticle} from '../web/engine/article-math.mjs';
import {protectPrivateFile,isPrivateFile} from '../scripts/private-file.mjs';

const site=profiles.find(value=>value.id==='metho');
const tokens={server:'SERVER_MUST_NOT_REPLACE_SUBMITTER',alice:'ALICE_EDITORIAL_PRIVATE',bob:'BOB_EDITORIAL_PRIVATE',reader:'DRAFT_READER_NO_PUBLISH'};
const base={title:'凭证隔离',summary:'完整测试摘要',markdown:'# 凭证隔离\n\n完整测试正文。',date:'2026-10-23',author:site.author,category:site.columns[0],assets:[]};
const packet=(id,key)=>({siteId:site.id,spaceId:site.spaceId,origin:site.origin,intent:'publish',data:{...base,id},requestKey:key,expectedVersion:0,expectedPublishedVersion:null});
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'today-queue-credentials-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=join(root,'state'),tokenFile=join(root,'configured-token');await writeFile(tokenFile,tokens.server,{mode:0o600});await protectPrivateFile(tokenFile);const requests=new Map(),calls=[],catalogCalls=new Map();let catalogFailure=0,time=100000;
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname,token=options.headers?.Authorization?.replace(/^Bearer /,'');calls.push({path,token,method:options.method||'GET'});
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin});
  if(path==='/manage/api/news/catalog'){catalogCalls.set(token,(catalogCalls.get(token)||0)+1);if(catalogFailure)return Response.json({error:'PRIVATE_UPSTREAM_DATA'},{status:catalogFailure});return Object.values(tokens).includes(token)&&token!==tokens.server?Response.json({items:[],scope:'all'}):Response.json({error:'invalid credential'},{status:401});}
  if(path.startsWith('/manage/api/news/requests/')){if(token===tokens.reader)return Response.json({error:'no publication scope'},{status:403});const saved=requests.get(path.split('/').at(-1));return saved&&saved.token===token?Response.json({revision:1,url:'/news/'+saved.data.id+'/',job:{id:'website-'+saved.data.id,status:'success'}}):Response.json({error:'missing request'},{status:404});}
  if(path==='/manage/api/news/publish'){assert.notEqual(token,tokens.server,'Never substitute the configured server credential');if(token===tokens.reader)return Response.json({error:'no publication scope'},{status:403});const prepared=JSON.parse(options.body);requests.set(prepared.requestKey,{token,data:prepared.data});return Response.json({revision:1,url:'/news/'+prepared.data.id+'/',job:{id:'website-'+prepared.data.id,status:'success'}});}
  if(path.startsWith('/manage/api/news/')){const saved=[...requests.values()].find(value=>value.data.id===path.split('/').at(-1));assert.equal(saved.token,token);return Response.json({version:1,publishedVersion:1,data:saved.data,published:saved.data});}
  const saved=[...requests.values()].find(value=>path==='/news/'+value.data.id+'/');assert(saved);return new Response('<link rel="canonical" href="'+site.origin+path+'"><div class="article-body">'+renderArticle(saved.data.markdown.replace(/^# [^\n]+\n+/,''))+'</div>');
 };
 const queue=createCloudQueue({directory,sites:[{site,tokenFile}],fetcher,now:()=>time});
 return {root,directory,tokenFile,queue,calls,catalogCalls,requests,setCatalogFailure:value=>catalogFailure=value,advance:milliseconds=>time+=milliseconds};
}
test('two valid site tokens publish only with their own immutable credentials and cannot read or claim each other’s jobs',async t=>{
 const f=await fixture(t),server=createCloudQueueServer({queue:f.queue});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});const origin='http://127.0.0.1:'+server.address().port;
 const headers=token=>({'X-Scholay-Site':site.id,Authorization:'Bearer '+token,'Content-Type':'application/json'}),alice=packet('credential-alice-article','alice-publication-request'),bob=packet('credential-bob-article','bob-publication-request');
 async function submit(token,value){return fetch(origin+'/v1/jobs',{method:'POST',headers:headers(token),body:JSON.stringify({siteId:site.id,packet:value})});}
 const a=await(await submit(tokens.alice,alice)).json(),b=await(await submit(tokens.bob,bob)).json();assert(a.accepted);assert(b.accepted);
 assert.equal((await submit(tokens.bob,alice)).status,409);assert.equal((await fetch(origin+'/v1/jobs/'+a.jobId,{headers:headers(tokens.bob)})).status,404);assert.equal((await fetch(origin+'/v1/jobs/'+a.jobId,{headers:headers(tokens.server)})).status,404);
 const aliceJobs=await(await fetch(origin+'/v1/jobs',{headers:headers(tokens.alice)})).json();assert.deepEqual(aliceJobs.jobs.map(value=>value.jobId),[a.jobId]);assert.deepEqual((await(await fetch(origin+'/v1/jobs',{headers:headers(tokens.server)})).json()).jobs,[]);
 await writeFile(f.tokenFile,'ROTATED_MORE_PRIVILEGED_SERVER_TOKEN');const results=await f.queue.tick();assert.equal(results.filter(value=>value.status==='complete').length,2);assert.equal(f.requests.get(alice.requestKey).token,tokens.alice);assert.equal(f.requests.get(bob.requestKey).token,tokens.bob);
 const observed=JSON.stringify(await(await fetch(origin+'/v1/jobs/'+a.jobId,{headers:headers(tokens.alice)})).json());for(const value of Object.values(tokens))assert(!observed.includes(value));assert(!observed.includes('credentialId'));assert(!observed.includes('tokenFile'));
 assert.equal(f.catalogCalls.get(tokens.alice),1);assert.equal(f.catalogCalls.get(tokens.bob),1);assert(!f.calls.some(call=>call.path!=='/manage/api/site'&&call.token===tokens.server));
 const state=JSON.parse(await readFile(join(f.directory,'jobs',a.jobId,'state.json'),'utf8'));assert(/^[a-f0-9]{64}$/.test(state.credentialId));assert(!JSON.stringify(state).includes(tokens.alice));const file=join(f.directory,'credentials',site.id,state.credentialId+'.token');assert.equal((await readFile(file,'utf8')).trim(),tokens.alice);assert.equal(await isPrivateFile(file),true);
});
test('a read-only editorial credential cannot borrow server publication privileges',async t=>{
 const f=await fixture(t),principal=await f.queue.authorize(site.id,'Bearer '+tokens.reader),prepared=packet('read-only-pilot','read-only-publication-request');await f.queue.enqueue(site.id,prepared,{credentialId:principal.credentialId});const [result]=await f.queue.tick();assert.equal(result.status,'rejected');assert.equal(f.requests.size,0);assert(!f.calls.some(call=>call.method==='POST'));assert(f.calls.filter(call=>call.path.startsWith('/manage/api/news/requests/')).every(call=>call.token===tokens.reader));
});
test('invalid or unavailable upstream authorization is not cached or stored, positive cache expires after ten minutes',async t=>{
 const f=await fixture(t);for(let i=0;i<2;i++)await assert.rejects(f.queue.authorize(site.id,'Bearer NOT_A_VALID_TOKEN'),error=>error.statusCode===401);assert.equal(f.catalogCalls.get('NOT_A_VALID_TOKEN'),2);
 f.setCatalogFailure(500);for(let i=0;i<2;i++)await assert.rejects(f.queue.authorize(site.id,'Bearer '+tokens.alice),error=>error.statusCode===503&&!error.message.includes('PRIVATE_UPSTREAM_DATA'));assert.equal(f.catalogCalls.get(tokens.alice),2);assert.deepEqual(await readdir(join(f.directory,'credentials')),[]);
 f.setCatalogFailure(0);await f.queue.authorize(site.id,'Bearer '+tokens.alice);await f.queue.authorize(site.id,'Bearer '+tokens.alice);assert.equal(f.catalogCalls.get(tokens.alice),3);f.advance(600001);await f.queue.authorize(site.id,'Bearer '+tokens.alice);assert.equal(f.catalogCalls.get(tokens.alice),4);
});
test('repeated invalid credentials have bounded upstream verification work and recover after the time window',async t=>{
 const f=await fixture(t);for(let i=0;i<60;i++)await assert.rejects(f.queue.authorize(site.id,'Bearer INVALID_CREDENTIAL_'+i),error=>error.statusCode===401);await assert.rejects(f.queue.authorize(site.id,'Bearer ANOTHER_INVALID_CREDENTIAL'),error=>error.statusCode===429);assert.equal([...f.catalogCalls.values()].reduce((sum,value)=>sum+value,0),60);f.advance(60001);await assert.rejects(f.queue.authorize(site.id,'Bearer ANOTHER_INVALID_CREDENTIAL'),error=>error.statusCode===401);assert.equal([...f.catalogCalls.values()].reduce((sum,value)=>sum+value,0),61);
});
