import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {profiles,validateSite} from '../scripts/site-config.mjs';
import {configureFlow,enqueuePublished,flowDirectory,optional,hash,atomic,todayTick} from '../scripts/publishing-flow.mjs';
import {flowWebsite} from '../scripts/publishing-flow-website.mjs';
import {prepareReviewedTranslationCorrection} from '../scripts/publishing-flow-translation-correction.mjs';
import {validateNews} from '../admin/news.mjs';
import {sourceContentSha256,editionArticleId,editionRoute} from '../contracts/language-editions.mjs';
import {renderArticle} from '../web/engine/article-math.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {durableWriteJson} from '../scripts/durable-json.mjs';
import {withFileLock} from '../scripts/editorial-lock.mjs';
import {createCloudContinuationArtifact,continuationArtifactSha256} from '../scripts/publishing-flow-artifact.mjs';

const credential='ORIGINAL_ENGLISH_SUBMITTER',oldKey='original-english-request-key',oldJob='original-english-build-job',now=1000000;
async function fixture(t,{origin}={}){
 const root=await mkdtemp(join(tmpdir(),'translation-correction-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const site=validateSite({...profiles.find(item=>item.id==='metho'),...(origin?{origin}:{}),languages:['zh-CN','en']});
 const source={id:'reviewed-english-source',title:'材料研究',summary:'罗伊斯研究所开展材料研究。',markdown:'# 材料研究\n\n罗伊斯研究所推进电子光子融合技术，恩特学术提供讨论入口。研究仍有限制。',date:'2026-10-25',author:site.author,category:site.columns[0],assets:[]};
 const oldEdition={title:'Materials research',summary:'The Roche Institute conducts materials research.',markdown:'# Materials research\n\nThe Roche Institute advances electron-photon fusion technologies; EnTe Academic provides discussion. The research still has limitations.'};
 const newEdition=Object.fromEntries(Object.entries(oldEdition).map(([key,text])=>[key,text.replaceAll('Roche Institute','Royce Institute').replaceAll('electron-photon fusion technologies','convergent electronic-photonic technologies').replaceAll('EnTe Academic','EnterScholar')]));
 await atomic(join(root,'.site.json'),site);await configureFlow(root,site,{version:1,siteId:site.id,origin:site.origin,enabled:true,authorization:'Original cloud continuation',articleIds:[source.id],targets:[]});
 const tokenFile=join(root,'submitter-token');await writeFile(tokenFile,credential,{mode:0o600});await protectPrivateFile(tokenFile);
 const queued=await enqueuePublished({root,site,data:source,receipt:{revision:1,url:editionRoute(source),publicReadback:true,job:{status:'success'}},credential:{credentialId:hash(credential),tokenFile}}),dir=join(flowDirectory(root),'jobs',queued.id),plan=await optional(join(dir,'plan.json'));
 const paths={state:join(dir,'state.json'),translationResult:join(dir,'translation-result.json'),website:join(dir,'website-en.json'),pointer:join(dir,'translation-correction.json'),archive:join(dir,'translation-corrections',oldKey+'.json')};
 const englishId=editionArticleId(source.id,'en'),oldData=validateNews({...source,...oldEdition,id:englishId,assets:[],locale:'en',translationOf:{articleId:source.id,revision:1,sha256:plan.sha256}},null,site);
 const original={state:{status:'waiting',complete:false,edition:oldEdition,translation:{status:'ready',attempts:1},english:{status:'queued',requestKey:oldKey},chinese:{status:'verified',url:plan.sourceUrl,revision:1},community:{status:'verified',url:'https://enterscholar.com/t/-/12345'},dispatch:{}},translationResult:{planId:plan.id,sourceSha256:plan.sha256,edition:oldEdition},website:{status:'queued',request:{requestKey:oldKey,data:oldData,expectedVersion:0,expectedPublishedVersion:null},result:{articleId:englishId,revision:1,url:editionRoute(oldData),job:{id:oldJob,status:'queued'}},sends:1,lastSendAt:now-10000}};
 for(const name of ['state','translationResult','website'])await atomic(paths[name],original[name]);
 await atomic(join(dir,'translation-chunks','original-model-checkpoint.json'),{original:true,results:['Retained original model text']});
 const input={version:1,root,site,planId:plan.id,expectedOriginalEnglishRequestKey:oldKey,expectedOriginalEnglishJobId:oldJob,expectedEnglishRevision:1,expectedOldEditionSha:hash(oldEdition),expectedNewEditionSha:hash(newEdition),newReviewedEdition:newEdition,reviewed:true,reason:'Reviewed institute, technology and brand terminology against the source'};
 const calls=[],requests=new Map(),remote={sourceVersion:1,sourcePublished:1,sourceSha:plan.sha256,originalStatus:'success',originalHttpStatus:200,english:{version:1,publishedVersion:1,data:structuredClone(oldData),published:structuredClone(oldData),url:editionRoute(oldData)},allowPosts:false,hook:null};
 const fetcher=async(url,options={})=>{
  const parsed=new URL(url),path=parsed.pathname,method=options.method||'GET';calls.push({path,method,key:options.body&&JSON.parse(options.body).requestKey});
  if(remote.hook)await remote.hook({path,method});
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin,capabilities:['language-editions-v1']});
  if(path.startsWith('/manage/api/news/')){
   assert.equal(options.headers.Authorization,'Bearer '+credential,'Only the bound original credential may be used');assert.equal(options.headers['X-Scholay-Site'],site.id);assert.equal(options.redirect,'error');
   if(path==='/manage/api/news/requests/'+oldKey)return Response.json({articleId:englishId,revision:1,url:editionRoute(oldData),job:{id:oldJob,status:remote.originalStatus}},{status:remote.originalHttpStatus});
   if(path==='/manage/api/news/flow-source/'+source.id)return Response.json({version:remote.sourceVersion,publishedVersion:remote.sourcePublished,sha256:remote.sourceSha});
   if(path==='/manage/api/news/flow-source/'+englishId)return Response.json({version:remote.english.version,publishedVersion:remote.english.publishedVersion,sha256:sourceContentSha256(remote.english.published)});
   if(path==='/manage/api/news/'+englishId)return Response.json(remote.english);
   if(path==='/manage/api/news/publish'){
    assert(remote.allowPosts,'Correction preparation must never POST');assert.equal(method,'POST');const request=JSON.parse(options.body);assert.notEqual(request.requestKey,oldKey);assert.equal(request.expectedVersion,1);assert.equal(request.expectedPublishedVersion,1);assert(!requests.has(request.requestKey),'A revision is submitted once');
    requests.set(request.requestKey,request);remote.english={...remote.english,version:2,publishedVersion:2,data:request.data,published:request.data};return Response.json({articleId:englishId,revision:2,url:editionRoute(request.data),job:{id:'corrected-english-build',status:'success'}});
   }
   if(path.startsWith('/manage/api/news/requests/')){const request=requests.get(path.split('/').at(-1));return request?Response.json({articleId:englishId,revision:2,url:editionRoute(request.data),job:{id:'corrected-english-build',status:'success'}}):Response.json({error:'No request'},{status:404});}
   assert.fail('Unexpected private API '+path);
  }
  if(path==='/community/links.json')return Response.json({version:1,links:{[editionRoute(source)]:'https://enterscholar.com/t/-/12345'}});
  if(path===editionRoute(oldData))return new Response('<html lang="en"><link rel="canonical" href="'+site.origin+path+'"><div class="article-body">'+renderArticle(remote.english.published.markdown.replace(/^# [^\n]+\n+/,''),{site})+'</div></html>');
  assert.fail('Unexpected route '+path);
 };
 const prepare=options=>prepareReviewedTranslationCorrection(input,{fetcher,now,...options}),bytes=()=>Promise.all(['state','translationResult','website'].map(name=>readFile(paths[name],'utf8')));
 const tick=()=>todayTick({root,site,...flowWebsite({root,site,fetcher,requireBoundCredential:true}),translate:async()=>assert.fail('Reviewed correction must not run a model'),fetcher,now:now+1000});
 return {root,site,source,dir,paths,plan,original,oldEdition,newEdition,input,remote,calls,requests,fetcher,prepare,bytes,tick};
}

async function completedFixture(t){
 const f=await fixture(t),requestKey='original-chinese-request-key',queueState={siteId:f.site.id,articleId:f.source.id,jobId:hash([f.site.id,requestKey]),requestKey,credentialId:f.plan.publicationCredential,continuationOwner:'cloud',status:'complete',continuation:{id:f.plan.id},receipt:{requestKey,revision:1,url:editionRoute(f.source),publicReadback:true,job:{id:'original-chinese-build',status:'success'}}};
 f.original.state.complete=true;f.original.state.status='complete';f.original.state.translationReviewRequired=true;f.original.state.english={status:'verified',requestKey:oldKey,revision:1,url:f.site.origin+editionRoute(f.original.website.request.data)};
 f.original.website.status='success';f.original.website.result.job.status='success';f.original.website.publicReadback={status:'verified',url:f.original.state.english.url,revision:1,bodySha256:hash(f.oldEdition.markdown)};
 for(const name of ['state','translationResult','website'])await atomic(f.paths[name],f.original[name]);
 const artifact=createCloudContinuationArtifact({queueState,packet:{requestKey,data:f.source},plan:f.plan,state:f.original.state,publication:f.original.website,site:f.site});
 Object.assign(f.input,{expectedCompleted:true,expectedArtifactSha256:artifact.artifactSha256,originalArtifact:artifact});
 const fetcher=async(url,options)=>url.endsWith('/requests/'+requestKey)?(f.calls.push({path:new URL(url).pathname,method:options.method}),Response.json({...queueState.receipt,articleId:f.source.id})):f.fetcher(url,options);
 return {...f,queueState,artifact,prepare:options=>prepareReviewedTranslationCorrection(f.input,{fetcher,now,...options})};
}

test('completed correction is explicit, archives the exact complete artifact and publishes one reviewed optimistic rev2',async t=>{
 const f=await completedFixture(t),plain={...f.input};for(const key of ['expectedCompleted','expectedArtifactSha256','originalArtifact'])delete plain[key];
 await assert.rejects(prepareReviewedTranslationCorrection(plain,{fetcher:f.fetcher,now}),/selected completion/);assert.equal(f.calls.length,0);
 const result=await f.prepare(),archive=await optional(f.paths.archive);assert.equal(archive.original.state.complete,true);assert.deepEqual(archive.proof.originalArtifact,f.artifact);assert(f.calls.every(call=>call.method==='GET'));
 const state=await optional(f.paths.state);assert.equal(state.translation.reviewedEditionSha256,hash(state.edition));assert.equal(state.translation.reviewedSourceSha256,f.plan.sha256);
 f.calls.length=0;f.remote.allowPosts=true;assert.equal((await f.tick()).jobs[0].complete,true);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal((await optional(f.paths.website)).result.revision,2);assert.notEqual(result.requestKey,oldKey);assert.equal((await optional(f.paths.archive)).original.state.complete,true);
 const changed=structuredClone(f.input);changed.originalArtifact.artifact.edition.title='Changed original evidence';await assert.rejects(prepareReviewedTranslationCorrection(changed,{fetcher:f.fetcher,now}),/retained original artifact/);
});

test('completed correction rejects altered artifact, dispatch, targets and unknown or changed original publications without writes',async t=>{
 for(const mutation of ['hash','artifact','dispatch','targets','source','english','unknown']){
  const f=await completedFixture(t);
  if(mutation==='hash')f.input.expectedArtifactSha256='f'.repeat(64);
  if(mutation==='artifact'){f.input.originalArtifact.artifact.community.url='https://enterscholar.com/t/-/777';f.input.originalArtifact.artifactSha256=continuationArtifactSha256(f.input.originalArtifact.artifact);f.input.expectedArtifactSha256=f.input.originalArtifact.artifactSha256;}
  if(mutation==='dispatch'){f.original.state.dispatch={old:{status:'unknown'}};await atomic(f.paths.state,f.original.state);}
  if(mutation==='targets'){f.plan.policy.targets=[{platform:'discord'}];await atomic(join(f.dir,'plan.json'),f.plan);}
  if(mutation==='source')f.remote.sourceVersion=2;
  if(mutation==='english')f.remote.english.published.markdown+=' Changed.';
  if(mutation==='unknown')f.remote.originalStatus='running';
  const before=await f.bytes();await assert.rejects(f.prepare());assert.deepEqual(await f.bytes(),before);assert.equal(await optional(f.paths.pointer),null);assert(f.calls.every(call=>call.method==='GET'));
 }
});

test('completed correction resumes each durable interruption with old complete evidence and no premature worker network',async t=>{
 for(let stop=1;stop<=6;stop++){
  const f=await completedFixture(t);let writes=0;
  await assert.rejects(f.prepare({writeJson:async(file,value)=>{await durableWriteJson(file,value);if(++writes===stop)throw Error('power loss');}}),/power loss/);
  if(stop<6){f.calls.length=0;const result=await f.tick();assert(result.jobs.length===0||result.jobs[0].status==='correction_pending');assert.equal(f.calls.length,0);}
  const pointer=await optional(f.paths.pointer),key=pointer.intent.replacement.website.request.requestKey;assert.equal((await f.prepare()).requestKey,key);assert.deepEqual((await optional(f.paths.archive)).proof.originalArtifact,f.artifact);assert.equal((await optional(f.paths.archive)).original.state.complete,true);
 }
});

test('reviewed correction retains every old snapshot and only prepares a new optimistic English revision',async t=>{
 const f=await fixture(t),before=await f.bytes(),plan=await readFile(join(f.dir,'plan.json')),token=await readFile(join(f.dir,'website-token')),chunks=await readFile(join(f.dir,'translation-chunks','original-model-checkpoint.json'));
 const result=await f.prepare();assert.equal(result.status,'prepared');assert.notEqual(result.requestKey,oldKey);assert.equal(result.expectedVersion,1);assert(f.calls.every(call=>call.method==='GET'));
 const pointer=await optional(f.paths.pointer),archive=await optional(f.paths.archive);assert.equal(pointer.phase,'committed');assert.deepEqual(pointer.intent,archive);assert.deepEqual(archive.original,f.original);assert.equal(archive.proof.originalEnglish.job.status,'success');assert(!JSON.stringify(archive).includes(credential));
 const receipt=await optional(f.paths.website);assert.equal(receipt.status,'unknown');assert.equal(receipt.sends,0);assert.equal(receipt.lastSendAt,0);assert.equal(receipt.request.expectedVersion,1);assert.equal(receipt.request.expectedPublishedVersion,1);
 const state=await optional(f.paths.state);assert.deepEqual(state.edition,f.newEdition);assert.equal(state.translation.reviewed,true);assert.equal(state.translation.qa.status,'passed');assert.equal(state.english.requestKey,result.requestKey);assert.equal(state.complete,false);assert.deepEqual((await optional(f.paths.translationResult)).edition,f.newEdition);
 assert.deepEqual(await readFile(join(f.dir,'plan.json')),plan);assert.deepEqual(await readFile(join(f.dir,'website-token')),token);assert.deepEqual(await readFile(join(f.dir,'translation-chunks','original-model-checkpoint.json')),chunks);assert.deepEqual(Object.values(archive.original).map(value=>JSON.stringify(value,null,2)+'\n'),before);
 const count=f.calls.length;assert.equal((await f.prepare()).alreadyPrepared,true);assert.equal(f.calls.length,count);
});

test('normal todayTick reconciles the new key before one rev2 POST using the original credential and retains the old successful request',async t=>{
 const f=await fixture(t),prepared=await f.prepare();f.calls.length=0;f.remote.allowPosts=true;
 const result=await f.tick();assert.equal(result.modelCalls,0);assert.equal(result.jobs[0].complete,true);assert.equal(result.jobs[0].english,'verified');
 const post=f.calls.findIndex(call=>call.method==='POST');assert(post>0);assert(f.calls.slice(0,post).some(call=>call.path==='/manage/api/news/requests/'+prepared.requestKey));assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert(!f.calls.some(call=>call.path.endsWith('/requests/'+oldKey+'/retry')));
 assert.equal((await optional(f.paths.website)).result.revision,2);assert.deepEqual((await optional(f.paths.archive)).original.website,f.original.website);assert.deepEqual(await f.tick(),{modelCalls:0,jobs:[]});
 const after=await f.bytes();assert.equal((await f.prepare()).alreadyPrepared,true);assert.deepEqual(await f.bytes(),after);
});

test('unknown old outcomes, changed Chinese or English revisions, incomplete review and failed facts never prepare a correction',async t=>{
 const f=await fixture(t),baseline=structuredClone(f.remote),input=structuredClone(f.input),before=await f.bytes();
 const changes=[
  ()=>{f.remote.originalStatus='queued';},()=>{f.remote.originalHttpStatus=404;},()=>{f.remote.originalHttpStatus=403;},
  ()=>{f.remote.sourceVersion=2;},()=>{f.remote.sourcePublished=2;},()=>{f.remote.sourceSha='f'.repeat(64);},
  ()=>{f.remote.english.version=2;},()=>{f.remote.english.publishedVersion=2;},()=>{f.remote.english.data.summary='Concurrent unpublished edit';},()=>{f.remote.english.published.markdown+='\nChanged public body';},
  ()=>{f.input.reviewed=false;},()=>{f.input.expectedOldEditionSha='f'.repeat(64);},()=>{f.input.expectedOriginalEnglishJobId='another-successful-build';},
  ()=>{f.input.newReviewedEdition.markdown+='\nThis happened on Monday.';f.input.expectedNewEditionSha=hash(f.input.newReviewedEdition);},
 ];
 for(const change of changes){Object.assign(f.remote,structuredClone(baseline));Object.assign(f.input,structuredClone(input));change();await assert.rejects(f.prepare());assert.deepEqual(await f.bytes(),before);assert.equal(await optional(f.paths.pointer),null);assert.equal(await optional(f.paths.archive),null);}
 assert(f.calls.every(call=>call.method==='GET'));
});

test('source and English races during readback fail closed, and a completed or externally dispatched flow cannot be rewritten',async t=>{
 const f=await fixture(t),before=await f.bytes();let reads=0;
 f.remote.hook=async({path})=>{if(path.endsWith('/flow-source/'+f.source.id)&&++reads===2)f.remote.sourceVersion=2;};await assert.rejects(f.prepare(),/Chinese source changed/);assert.deepEqual(await f.bytes(),before);
 f.remote.sourceVersion=1;reads=0;f.remote.hook=async({path})=>{if(path.endsWith('/'+editionArticleId(f.source.id,'en'))&&!path.includes('flow-source')&&++reads===2)f.remote.english.version=2;};await assert.rejects(f.prepare(),/English content changed/);assert.deepEqual(await f.bytes(),before);
 f.remote.hook=null;f.remote.english.version=1;
 for(const state of [{...f.original.state,complete:true},{...f.original.state,dispatch:{external:{status:'ready',id:'old-packet'}}}]){await atomic(f.paths.state,state);await assert.rejects(f.prepare(),/selected completion/);assert.deepEqual(await optional(f.paths.state),state);}
 assert.equal(await optional(f.paths.pointer),null);
});

test('all durable interruption points leave todayTick inert until the exact transaction resumes',async t=>{
 for(const stage of ['prepared','archive','website','translationResult','state','committed']){
  const f=await fixture(t),names=new Map(Object.entries(f.paths).map(([name,path])=>[path,name]));
  const writeJson=async(file,value)=>{await durableWriteJson(file,value);if((file===f.paths.pointer?value.phase:names.get(file))===stage)throw Error('Simulated interruption');};
  await assert.rejects(f.prepare({writeJson}),/Simulated interruption/);const key=(await optional(f.paths.pointer)).intent.replacement.website.request.requestKey;
  if(stage!=='committed'){
   const before=await f.bytes(),calls=f.calls.length;assert.deepEqual(await f.tick(),{modelCalls:0,jobs:[{id:f.plan.id,status:'correction_pending',complete:false}]});assert.equal(f.calls.length,calls);assert.deepEqual(await f.bytes(),before);
  }
  assert.equal((await f.prepare()).requestKey,key);assert.equal((await optional(f.paths.pointer)).phase,'committed');assert.deepEqual((await optional(f.paths.archive)).original,f.original);assert.equal((await optional(f.paths.website)).sends,0);assert(f.calls.every(call=>call.method==='GET'));
 }
});

test('a third local value, changed archive or ambient credential cannot replace the original correction evidence',async t=>{
 const f=await fixture(t);await assert.rejects(f.prepare({writeJson:async(file,value)=>{await durableWriteJson(file,value);throw Error('Interrupted');}}));
 const changed={...f.original.state,unrelatedConcurrentEdit:true};await atomic(f.paths.state,changed);await assert.rejects(f.prepare(),/outside the pending correction/);assert.deepEqual(await optional(f.paths.state),changed);
 const g=await fixture(t);await g.prepare();const archive=await optional(g.paths.archive);archive.original.website.result.job.status='Changed';await atomic(g.paths.archive,archive);await assert.rejects(g.prepare(),/archive changed/);
 const h=await fixture(t);await writeFile(join(h.dir,'website-token'),'ANOTHER_CREDENTIAL');const previous=process.env.SCHOLAY_TODAY_TOKEN;process.env.SCHOLAY_TODAY_TOKEN=credential;
 try{await assert.rejects(h.prepare(),/Original continuation credential/);assert.equal(h.calls.length,0);}finally{if(previous===undefined)delete process.env.SCHOLAY_TODAY_TOKEN;else process.env.SCHOLAY_TODAY_TOKEN=previous;}
});

test('today.lock excludes an active worker before any correction network operation',async t=>{
 const f=await fixture(t);let entered,release;const ready=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve),occupied=withFileLock(join(flowDirectory(f.root),'today.lock'),async()=>{entered();await hold;});await ready;
 try{await assert.rejects(f.prepare(),/文件正在保存/);assert.equal(f.calls.length,0);}finally{release();await occupied;}
});

test('malformed or cross-plan committed correction pointers block all work without touching state',async t=>{
 const f=await fixture(t),before=await f.bytes(),intent={identity:{planId:'f'.repeat(40)},planSha256:hash(f.plan)};
 for(const pointer of [{version:1,phase:'committed'},{version:1,phase:'committed',intent,intentSha256:hash(intent)}]){
  await atomic(f.paths.pointer,pointer);assert.deepEqual(await f.tick(),{modelCalls:0,jobs:[{id:f.plan.id,status:'correction_pending',complete:false}]});assert.equal(f.calls.length,0);assert.deepEqual(await f.bytes(),before);
 }
});

test('the standalone exact-input correction CLI uses real GET-only HTTP and no editorial inventory',async t=>{
 let f;const methods=[];const server=createServer(async(request,response)=>{
  methods.push(request.method);const result=await f.fetcher(f.site.origin+request.url,{method:request.method,redirect:'error',headers:{Authorization:request.headers.authorization,'X-Scholay-Site':request.headers['x-scholay-site']}});response.writeHead(result.status,{'Content-Type':result.headers.get('Content-Type')});response.end(await result.text());
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});f=await fixture(t,{origin:'http://127.0.0.1:'+server.address().port});
 const inputFile=join(f.root,'reviewed-input.json');await atomic(inputFile,f.input);
 const env={...process.env,SCHOLAY_TODAY_TOKEN:'UNRELATED_ENVIRONMENT_TOKEN'};delete env.SCHOLAY_SITE_CONFIG;delete env.SCHOLAY_SITE_JSON;delete env.SCHOLAY_SITE_ID;
 const {stdout}=await promisify(execFile)(process.execPath,[join(process.cwd(),'scripts/publishing-flow-translation-correction-cli.mjs'),inputFile],{env});assert.equal(JSON.parse(stdout).status,'prepared');assert(!stdout.includes(credential));assert(methods.length>=7);assert(methods.every(method=>method==='GET'));assert.equal(await optional(join(f.root,'_ops/inventory/article-index.json')),null);
});
