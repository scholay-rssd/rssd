import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,open,writeFile,readFile,rm,symlink,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {profiles} from '../scripts/site-config.mjs';
import {createCloudQueue} from '../scripts/cloud-queue.mjs';
import {createCloudQueueServer} from '../scripts/cloud-queue-server.mjs';
import {continueCloudPublication} from '../scripts/cloud-queue-cli.mjs';
import {publicationQueueClient} from '../scripts/publication-queue-client.mjs';
import {configureFlow,enqueuePublished,flowStatus,todayTick,hash,atomic} from '../scripts/publishing-flow.mjs';
import {flushCloudFlow} from '../scripts/publishing-flow-credentials.mjs';
import {flowWebsite} from '../scripts/publishing-flow-website.mjs';
import {retryTranslation} from '../scripts/publishing-flow-recovery.mjs';
import {protectPrivateFile,isPrivateFile} from '../scripts/private-file.mjs';
import {editionRoute,sourceContentSha256} from '../contracts/language-editions.mjs';
import {renderArticle} from '../web/engine/article-math.mjs';

const site={...profiles.find(value=>value.id==='metho'),languages:['zh-CN','en']};
const tokens={server:'SERVER_HAS_MORE_AUTHORITY',alice:'ORIGINAL_ALICE_CREDENTIAL',bob:'ORIGINAL_BOB_CREDENTIAL'};
const packet=id=>({siteId:site.id,spaceId:site.spaceId,origin:site.origin,intent:'publish',requestKey:'original-request-'+id,expectedVersion:0,expectedPublishedVersion:null,data:{id,title:'静默翻译',summary:'保留原来的事实。',markdown:'# 静默翻译\n\n保留原来的事实，完整翻译全部正文。',date:'2026-10-23',author:site.author,category:site.columns[0],assets:[]}});
const english={title:'Silent translation',summary:'Retain the original facts.',markdown:'# Silent translation\n\nRetain the original facts and translate the entire article completely.'};
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'today-cloud-continuation-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const tokenFile=join(root,'server-token'),directory=join(root,'queue');await writeFile(tokenFile,tokens.server,{mode:0o600});await protectPrivateFile(tokenFile);
 const requests=new Map(),records=new Map(),calls=[],revoked=new Set();let handoffs=0;
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname,token=options.headers?.Authorization?.replace(/^Bearer /,'');calls.push({path,token,method:options.method||'GET'});
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin,capabilities:['language-editions-v1']});
  if(path.startsWith('/manage/api/news/')&&revoked.has(token))return Response.json({error:'revoked'},{status:401});
  if(path==='/manage/api/news/catalog')return [tokens.alice,tokens.bob].includes(token)?Response.json({items:[],scope:'all'}):Response.json({error:'denied'},{status:401});
  if(path==='/manage/api/news/publish'){
   const request=JSON.parse(options.body);assert.notEqual(token,tokens.server);requests.set(request.requestKey,{request,token});records.set(request.data.id,{data:request.data,token});
   return Response.json({revision:1,url:editionRoute(request.data),job:{id:'build-'+request.data.id,status:'success'}});
  }
  if(path.startsWith('/manage/api/news/requests/')){
   const saved=requests.get(path.split('/').at(-1));return saved?Response.json({revision:1,url:editionRoute(saved.request.data),job:{id:'build-'+saved.request.data.id,status:'success'}}):Response.json({error:'absent'},{status:404});
  }
  if(path.startsWith('/manage/api/news/')){
   const record=records.get(path.split('/').at(-1));if(!record)return Response.json({error:'absent'},{status:404});assert.equal(token,record.token);
   return Response.json({version:1,publishedVersion:1,data:record.data,published:record.data,sha256:sourceContentSha256(record.data),url:editionRoute(record.data)});
  }
  if(path==='/community/links.json')return Response.json({version:1,links:Object.fromEntries([...records.values()].filter(record=>!record.data.locale).map(record=>[editionRoute(record.data),'https://enterscholar.com/t/-/12345']))});
  const record=[...records.values()].find(record=>editionRoute(record.data)===path);assert(record,'Unexpected public route '+path);
  return new Response('<html lang="'+(record.data.locale==='en'?'en':'zh-CN')+'"><link rel="canonical" href="'+site.origin+path+'"><div class="article-body">'+renderArticle(record.data.markdown.replace(/^# [^\n]+\n+/,''))+'</div></html>');
 };
 await configureFlow(root,site,{version:1,siteId:site.id,origin:site.origin,enabled:true,autoRun:true,authorization:'Owner approved new cloud continuations',articleIds:['*'],notBefore:'2026-10-23T00:00:00Z',targets:[]});
 const config={directory,sites:[{site,tokenFile,workspaceRoot:root}],fetcher,now:()=>Date.parse('2026-10-23T10:00:00Z'),continuation:async args=>{handoffs++;return continueCloudPublication(args);}};
 const queue=createCloudQueue(config);
 const submit=async(id,{actor='alice',owner='cloud',payload=packet(id)}={})=>{const principal=await queue.authorize(site.id,'Bearer '+tokens[actor]);return queue.enqueue(site.id,payload,{credentialId:principal.credentialId,continuationOwner:owner});};
 return {root,tokenFile,directory,queue,config,fetcher,calls,revoked,submit,get handoffs(){return handoffs;}};
}

test('only explicit cloud envelopes create continuations; local and legacy jobs remain local after rollout',async t=>{
 const f=await fixture(t),local=await f.submit('local-source',{owner:'local'}),legacy=await f.submit('legacy-source',{owner:'local'}),cloud=await f.submit('cloud-source');
 // A private credential can be flushed before its plan is visible. Such
 // in-flight or interrupted directories must not starve ready work.
 for(const suffix of ['1','2','3'])await mkdir(join(f.root,'.local/publishing-flow/jobs','0'.repeat(39)+suffix),{recursive:true});
 const legacyFile=join(f.directory,'jobs',legacy.jobId,'state.json'),state=JSON.parse(await readFile(legacyFile,'utf8'));delete state.continuationOwner;await writeFile(legacyFile,JSON.stringify(state));
 await createCloudQueue(f.config).tick();await createCloudQueue(f.config).tick();assert.equal(f.handoffs,1);
 assert.equal((await f.queue.get(site.id,local.jobId)).continuationOwner,'local');assert.equal((await f.queue.get(site.id,legacy.jobId)).continuationOwner,'local');
 assert.equal((await f.queue.get(site.id,cloud.jobId)).continuation.status,'queued');assert.deepEqual((await flowStatus(f.root)).map(({plan})=>plan.articleId),['cloud-source']);
 assert.equal((await flowStatus(f.root,{pendingOnly:true,limit:1}))[0].plan.articleId,'cloud-source');
 await assert.rejects(f.submit('legacy-source'),error=>error.statusCode===409);await assert.rejects(f.submit('cloud-source',{owner:'local'}),error=>error.statusCode===409);
 await assert.rejects(f.submit('invalid-owner',{owner:'auto'}),error=>error.statusCode===400);
 assert.deepEqual(JSON.parse(await readFile(join(f.directory,'jobs',cloud.jobId,'packet.json'),'utf8')),packet('cloud-source'));
});

test('HTTP retries retain the immutable envelope after a lost ACK and reject an old server for cloud ownership',async t=>{
 const f=await fixture(t),server=createCloudQueueServer({queue:f.queue});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const endpoint='http://127.0.0.1:'+server.address().port,payload=packet('http-source');let first=true,accepted;
 const client=publicationQueueClient({endpoint,site,token:tokens.alice,fetcher:async(url,options)=>{const response=await fetch(url,options);if(options.method==='POST'&&first){first=false;accepted=await response.json();throw Error('ACK lost');}return response;}});
 await assert.rejects(client.submit(payload,{continuationOwner:'cloud'}),/ACK lost/);
 assert.equal((await client.status(accepted.jobId,payload,{continuationOwner:'cloud'})).continuationOwner,'cloud');
 await assert.rejects(client.submit(payload,{continuationOwner:'local'}),error=>error.statusCode===409);
 assert.equal((await client.submit(payload,{continuationOwner:'cloud'})).jobId,accepted.jobId);await f.queue.tick();assert.equal(f.handoffs,1);
 const old=publicationQueueClient({endpoint,site,token:tokens.alice,fetcher:async()=>Response.json({...accepted,continuationOwner:undefined})});
 await assert.rejects(old.status(accepted.jobId,payload,{continuationOwner:'cloud'}),error=>error.statusCode===409);
 assert.equal((await old.status(accepted.jobId,payload,{continuationOwner:'local'})).jobId,accepted.jobId);
});

test('cloud continuation binds each submitter through English publication and ignores packet paths and privileged defaults',async t=>{
 const f=await fixture(t),hostile=packet('alice-source');hostile.tokenFile=f.tokenFile;hostile.credentialId=hash(tokens.server);hostile.data.publicationCredential=hash(tokens.server);
 await f.submit('alice-source',{payload:hostile});await f.submit('bob-source',{actor:'bob'});await f.queue.tick();
 const plans=await flowStatus(f.root);assert.equal(plans.length,2);
 for(const {plan} of plans){const expected=plan.articleId==='alice-source'?tokens.alice:tokens.bob;assert.equal(plan.publicationCredential,hash(expected));const file=join(f.root,'.local/publishing-flow/jobs',plan.id,'website-token');assert.equal(await isPrivateFile(file),true);assert.equal((await readFile(file,'utf8')).trim(),expected);assert(!JSON.stringify(plan).includes(expected));}
 const before=process.env.SCHOLAY_TODAY_TOKEN;process.env.SCHOLAY_TODAY_TOKEN=tokens.server;t.after(()=>{if(before===undefined)delete process.env.SCHOLAY_TODAY_TOKEN;else process.env.SCHOLAY_TODAY_TOKEN=before;});
 await writeFile(f.tokenFile,'ROTATED_SERVER_DEFAULT');
 const website=flowWebsite({root:f.root,site,tokenFile:f.tokenFile,fetcher:f.fetcher,requireBoundCredential:true});let models=0;
 const options={root:f.root,site,...website,translate:async()=>{models++;return english;},fetcher:f.fetcher};
 await todayTick(options);await todayTick(options);assert.equal(models,2);assert((await flowStatus(f.root)).every(({state})=>state.complete));
 const posts=f.calls.filter(call=>call.method==='POST');assert.deepEqual(posts.map(call=>call.token).sort(),[tokens.alice,tokens.alice,tokens.bob,tokens.bob].sort());
 const state=await f.queue.list(site.id);assert(!JSON.stringify(state).includes('website-token'));assert(!JSON.stringify(state).includes(hash(tokens.alice)));
});

test('missing, altered, revoked, or unbound cloud credentials never fall back to the workspace token',async t=>{
 const f=await fixture(t);await f.submit('missing-token');await f.submit('changed-token');await f.submit('revoked-token',{actor:'bob'});await f.queue.tick();
 const plans=await flowStatus(f.root),find=id=>plans.find(({plan})=>plan.articleId===id).plan;
 await rm(join(f.root,'.local/publishing-flow/jobs',find('missing-token').id,'website-token'));
 await writeFile(join(f.root,'.local/publishing-flow/jobs',find('changed-token').id,'website-token'),tokens.server);
 f.revoked.add(tokens.bob);f.calls.length=0;
 const website=flowWebsite({root:f.root,site,tokenFile:f.tokenFile,fetcher:f.fetcher,requireBoundCredential:true});
 await todayTick({root:f.root,site,...website,translate:async()=>assert.fail('Credential failure must precede model work'),fetcher:f.fetcher});
 assert((await flowStatus(f.root)).every(({state})=>state.status==='needs_review'));assert(!f.calls.some(call=>call.token===tokens.server||call.method==='POST'));
 const unbound={...find('missing-token')};delete unbound.publicationCredential;
 await assert.rejects(website.readSource(unbound.articleId,{plan:unbound}),error=>error.code==='FLOW_CREDENTIAL');
 await assert.rejects(website.readSource(unbound.articleId),error=>error.code==='FLOW_CREDENTIAL');
 f.revoked.delete(tokens.bob);f.calls.length=0;
 assert.equal((await retryTranslation({root:f.root,site,id:find('revoked-token').id,readSource:website.readSource})).status,'queued');
 assert(f.calls.length>0);assert(f.calls.every(call=>call.token===tokens.bob));
});

test('cloud flow CLI resumes without importing or leasing the desktop updater runtime',async t=>{
 const f=await fixture(t);await writeFile(join(f.root,'.site.json'),JSON.stringify(site));await mkdir(join(f.root,'articles'));await atomic(join(f.root,'_ops/inventory/article-index.json'),{articles:{},annexColumns:site.columns});
 const hook="import {registerHooks} from 'node:module'; registerHooks({resolve(specifier,context,nextResolve){if(specifier.endsWith('/headless/update.mjs'))throw Error('Cloud must not load the desktop updater');return nextResolve(specifier,context);}});";
 const env={...process.env,SCHOLAY_CLOUD_EXECUTOR:'1',SCHOLAY_SITE_JSON:JSON.stringify(site),SCHOLAY_EDITORIAL_ROOT:f.root,SCHOLAY_APP_DATA:f.root,SCHOLAY_SITE_CONFIG:join(f.root,'.site.json'),SCHOLAY_SITE_ID:site.id};delete env.SCHOLAY_DESKTOP_RUNTIME;
 const result=await promisify(execFile)(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(hook),'scripts/publishing-flow-cli.mjs','root',f.root,'resume'],{cwd:new URL('..',import.meta.url),env,timeout:10000});
 assert.deepEqual(JSON.parse(result.stdout),{modelCalls:0,jobs:[]});assert.equal(result.stderr,'');
});

test('cloud flow CLI runs through the current release directory symlink',async t=>{
 const f=await fixture(t);await writeFile(join(f.root,'.site.json'),JSON.stringify(site));await mkdir(join(f.root,'articles'));await atomic(join(f.root,'_ops/inventory/article-index.json'),{articles:{},annexColumns:site.columns});
 const current=join(f.root,'current');await symlink(fileURLToPath(new URL('..',import.meta.url)),current,process.platform==='win32'?'junction':'dir');
 const env={...process.env,SCHOLAY_CLOUD_EXECUTOR:'1',SCHOLAY_SITE_JSON:JSON.stringify(site),SCHOLAY_EDITORIAL_ROOT:f.root,SCHOLAY_SITE_ID:site.id};delete env.SCHOLAY_SITE_CONFIG;
 try{
  for(const [command,expected] of [['status',[]],['resume',{modelCalls:0,jobs:[]}]]){
   const result=await promisify(execFile)(process.execPath,[join(current,'scripts/publishing-flow-cli.mjs'),'root',f.root,command],{cwd:current,env,timeout:10000});
   assert.deepEqual(JSON.parse(result.stdout),expected);assert.equal(result.stderr,'');
  }
 }finally{await unlink(current);}
});

test('explicit cloud ownership cannot silently complete when its trusted policy declines the source',async t=>{
 const f=await fixture(t),policyFile=join(f.root,'.local/publishing-flow/policy.json'),policy=JSON.parse(await readFile(policyFile,'utf8'));
 for(const [id,changes] of [['disabled-policy',{enabled:false}],['out-of-scope',{articleIds:['another-source']}]] ){
  const accepted=await f.submit(id);await atomic(policyFile,{...policy,...changes});await f.queue.tick();
  const state=await f.queue.get(site.id,accepted.jobId);assert.equal(state.status,'needs_review');assert.equal(state.receipt.publicReadback,true);assert.equal(state.receipt.job.status,'success');
  await f.queue.tick();assert.equal(f.calls.filter(call=>call.method==='POST').length,id==='disabled-policy'?1:2);
 }
 assert.equal((await flowStatus(f.root)).length,0);
 const nonChinese=await continueCloudPublication({entry:{},site,packet:{data:{locale:'en'}},receipt:{}});assert.equal(nonChinese.status,'disabled');assert(nonChinese.reason);
});

test('a lost cloud handoff ACK resumes its frozen plan after policy changes without replacing its submitter',async t=>{
 const f=await fixture(t),payload=packet('handoff-policy-recovery'),accepted=await f.submit(payload.data.id),policyFile=join(f.root,'.local/publishing-flow/policy.json'),policy=JSON.parse(await readFile(policyFile,'utf8'));let interrupted=false;
 const first=createCloudQueue({...f.config,continuation:async args=>{const result=await f.config.continuation(args);if(!interrupted){interrupted=true;throw Error('Interrupted after the frozen plan was saved');}return result;}});
 assert.equal((await first.tick())[0].status,'retry_wait');
 const [{plan}]=await flowStatus(f.root),before=JSON.stringify(plan),state=JSON.parse(await readFile(join(f.directory,'jobs',accepted.jobId,'state.json'),'utf8'));
 await atomic(policyFile,{...policy,enabled:false});
 const restarted=createCloudQueue({...f.config,now:()=>f.config.now()+60000});assert.equal((await restarted.tick())[0].status,'complete');
 assert.equal((await restarted.get(site.id,accepted.jobId)).continuation.id,plan.id);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
 const args={entry:{workspaceRoot:f.root,tokenFile:join(f.directory,'credentials',site.id,state.credentialId+'.token')},site,packet:payload,receipt:state.receipt,credentialId:state.credentialId};
 for(const changes of [{articleIds:['another-source']},{notBefore:'2026-10-24T00:00:00Z'},{authorization:''}]){
  await atomic(policyFile,{...policy,...changes});assert.deepEqual(await continueCloudPublication(args),{status:'queued',id:plan.id});
 }
 await writeFile(policyFile,'invalid replacement policy');assert.deepEqual(await continueCloudPublication(args),{status:'queued',id:plan.id});
 await rm(policyFile);assert.deepEqual(await continueCloudPublication(args),{status:'queued',id:plan.id});
 const bob=await f.queue.authorize(site.id,'Bearer '+tokens.bob);
 await assert.rejects(continueCloudPublication({...args,credentialId:bob.credentialId,entry:{...args.entry,tokenFile:join(f.directory,'credentials',site.id,bob.credentialId+'.token')}}),error=>error.statusCode===409);
 await assert.rejects(continueCloudPublication({...args,receipt:{...state.receipt,publicReadback:false}}),/verified source publication/);
 assert.equal(JSON.stringify((await flowStatus(f.root))[0].plan),before);assert.equal((await flowStatus(f.root)).length,1);
 assert.equal((await readFile(join(f.root,'.local/publishing-flow/jobs',plan.id,'website-token'),'utf8')).trim(),tokens.alice);
});

test('cloud handoff flushes all files and directory ancestors and propagates every fsync failure',async()=>{
 const root=join(tmpdir(),'cloud-durability-order'),id='a'.repeat(40),key='b'.repeat(40),flow=join(root,'.local/publishing-flow'),job=join(flow,'jobs',id),sources=join(flow,'sources');
 const expected=[join(job,'website-token'),join(job,'plan.json'),join(sources,key+'.json'),job,sources,join(flow,'jobs'),flow,join(root,'.local'),root];
 const flushed=[],closed=[];
 const openFile=async file=>({sync:async()=>flushed.push(file),close:async()=>closed.push(file)});
 await flushCloudFlow(root,id,key,{platform:'linux',openFile});assert.deepEqual(flushed,expected);assert.deepEqual(closed,expected);
 for(const failurePath of expected){
  const error=Object.assign(Error('simulated fsync failure'),{code:'EIO'}),attempted=[],released=[];
  await assert.rejects(flushCloudFlow(root,id,key,{platform:'linux',openFile:async file=>({sync:async()=>{attempted.push(file);if(file===failurePath)throw error;},close:async()=>released.push(file)})}),value=>value===error);
  assert.equal(attempted.at(-1),failurePath);assert.deepEqual(released,attempted);
 }
});

test('cloud fsync failure withholds the handoff ACK and retries the same plan and source pointer',async t=>{
 const f=await fixture(t),payload=packet('cloud-durable-handoff'),accepted=await f.submit(payload.data.id),policy=JSON.parse(await readFile(join(f.root,'.local/publishing-flow/policy.json'),'utf8'));
 const error=Object.assign(Error('simulated plan fsync failure'),{code:'EIO'});
 const flushCloud=(root,id,key)=>flushCloudFlow(root,id,key,{openFile:async(file,flags)=>{const handle=await open(file,flags);return {sync:async()=>{if(file.endsWith('plan.json'))throw error;await handle.sync();},close:()=>handle.close()};}});
 const queue=createCloudQueue({...f.config,continuation:args=>enqueuePublished({root:args.entry.workspaceRoot,site:args.site,data:args.packet.data,receipt:args.receipt,credential:{credentialId:args.credentialId,tokenFile:args.entry.tokenFile},flushCloud})});
 assert.equal((await queue.tick())[0].status,'retry_wait');const state=JSON.parse(await readFile(join(f.directory,'jobs',accepted.jobId,'state.json'),'utf8'));
 assert.equal(state.receipt.publicReadback,true);assert.equal(state.continuation.id,undefined);
 const [{plan}]=await flowStatus(f.root),pointer=join(f.root,'.local/publishing-flow/sources',plan.id+'.json');await rm(pointer);
 await atomic(join(f.root,'.local/publishing-flow/policy.json'),{...policy,enabled:false});
 const restarted=createCloudQueue({...f.config,now:()=>f.config.now()+60000});const [done]=await restarted.tick();assert.equal(done.status,'complete');assert.equal(done.continuation.id,plan.id);
 assert.deepEqual(JSON.parse(await readFile(pointer,'utf8')),{id:plan.id});assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal((await flowStatus(f.root)).length,1);
 await atomic(join(f.root,'.local/publishing-flow/jobs',plan.id,'state.json'),{complete:true});
 const credential={credentialId:state.credentialId,tokenFile:join(f.directory,'credentials',site.id,state.credentialId+'.token')};
 await assert.rejects(enqueuePublished({root:f.root,site,data:payload.data,receipt:state.receipt,credential,flushCloud}),value=>value===error);
 // Local continuation keeps its existing persistence behavior.
 const local=packet('local-without-cloud-flush');assert.equal((await enqueuePublished({root:f.root,site,data:local.data,receipt:{...state.receipt,url:editionRoute(local.data)},policy,flushCloud:async()=>assert.fail('Local enqueue must not use the cloud durability hook')})).status,'queued');
});
