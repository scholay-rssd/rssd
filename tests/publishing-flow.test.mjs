import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {configureFlow,enqueuePublished,todayTick,postizTick,flowStatus,externalPackage,absoluteSource,validateTranslation,hash,atomic} from '../scripts/publishing-flow.mjs';
import {flowWebsite} from '../scripts/publishing-flow-website.mjs';
import {sourceContentSha256,editionArticleId} from '../contracts/language-editions.mjs';
import {renderArticle} from '../web/engine/article-math.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const site={...profiles.find(s=>s.id==='metho'),languages:['zh-CN','en']};
const source={id:'flow-test-source',title:'样本与随机化',summary:'120 人、0.25 的效果。',markdown:'# 样本与随机化\n\n120 人、0.25 的效果。\n\n![图](/article-media/'+ 'a'.repeat(64)+'.png)\n\n[来源](https://example.org/study)\n\n限制：不能证明因果。',date:'2026-10-22',author:site.author,category:site.columns[0],assets:[{path:'/article-media/'+'a'.repeat(64)+'.png',data:'PRIVATE_BYTES'}]};
const english={title:'Sampling and randomization',summary:'120 people and an effect of 0.25.',markdown:'# Sampling and randomization\n\n120 people and an effect of 0.25.\n\n![Figure]('+site.origin+source.assets[0].path+')\n\n[Source](https://example.org/study)\n\nLimitation: this cannot establish causation.'};
const targets=[{platform:'discord',locale:'zh-CN',integrationId:'discord-account',channelId:'1562031229606301696',format:'summary'},{platform:'devto',locale:'en',integrationId:'devto-account',format:'article',username:'owner'}];
const topic='https://enterscholar.com/t/-/415722';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-flow-'));t.after(()=>rm(root,{recursive:true,force:true}));const handoffDirectory=join(root,'.local/handoff');const policy={version:1,siteId:site.id,origin:site.origin,enabled:true,authorization:'Explicit user pilot: three articles, Discord and DEV.to',articleIds:[source.id],targets,handoffDirectory,englishBrand:{name:'Metho',slogan:'Understanding cannot be faked.'}};await configureFlow(root,site,policy);const receipt={revision:1,url:'/news/'+source.id+'/',publicReadback:true,job:{status:'success'}};return {root,policy,handoffDirectory,enqueue:(data=source,r=receipt)=>enqueuePublished({root,site,data,receipt:r})};}

test('opt-in continuation freezes no image bytes, deduplicates and never mutates Chinese prose',async t=>{
 const f=await fixture(t),before=JSON.stringify(source);const first=await f.enqueue(),again=await f.enqueue();assert.equal(first.id,again.id);
 const [{plan}]=await flowStatus(f.root);assert(!JSON.stringify(plan).includes('PRIVATE_BYTES'));assert.equal(sourceContentSha256(source),plan.sha256);assert.equal(JSON.stringify(source),before);
 assert.equal((await f.enqueue({...source,id:'unauthorized-source'})).status,'out_of_scope');
 await assert.rejects(f.enqueue(source,{revision:1,publicReadback:false}),/verified/);
});

test('Chinese dispatch survives English failure, caches the small map, and does not re-run failed translation',async t=>{
 const f=await fixture(t);await f.enqueue();let reads=0,models=0;
 const options={root:f.root,site,readSource:async()=>({version:1,publishedVersion:1,data:source}),translate:async()=>{models++;throw Error('provider unavailable');},publishEdition:async()=>assert.fail('No English publication after failed QA'),fetcher:async()=>{reads++;return Response.json({version:1,links:{['/news/'+source.id+'/']:topic}});},now:1000000};
 const first=await todayTick(options);assert.equal(first.modelCalls,1);assert.equal((await readdir(join(f.handoffDirectory,'outbox'))).length,1);
 const packet=JSON.parse(await readFile(join(f.handoffDirectory,'outbox',(await readdir(join(f.handoffDirectory,'outbox')))[0]),'utf8'));assert.equal(packet.target.locale,'zh-CN');assert(packet.body.includes(topic));assert(packet.body.includes(site.slogan));
 await todayTick({...options,now:1001000});assert.equal(reads,1);assert.equal(models,1);
});

test('English uses its own permalink and source/Ente links; repeat ticks create no extra packages',async t=>{
 const f=await fixture(t);await f.enqueue();const options={root:f.root,site,readSource:async()=>({version:1,publishedVersion:1,sha256:sourceContentSha256(source)}),translate:async()=>english,publishEdition:async()=>({status:'verified',url:site.origin+'/en/news/'+source.id+'/'}),fetcher:async()=>Response.json({version:1,links:{['/news/'+source.id+'/']:topic}})};
 assert.equal((await todayTick(options)).jobs[0].complete,true);await todayTick(options);
 const names=await readdir(join(f.handoffDirectory,'outbox'));assert.equal(names.length,2);
 const packets=await Promise.all(names.map(n=>readFile(join(f.handoffDirectory,'outbox',n),'utf8').then(JSON.parse))),en=packets.find(p=>p.target.locale==='en');
 assert.equal(en.settings.canonical,site.origin+'/en/news/'+source.id+'/');assert(en.body.includes('EntScholar (Chinese)'));assert(en.body.includes('Understanding cannot be faked.'));assert(en.body.includes(site.origin+source.assets[0].path));
});

test('stale source prevents any model or handoff; numeric translation differences are advisory and missing images still block',async t=>{
 const f=await fixture(t);await f.enqueue();const output=await todayTick({root:f.root,site,readSource:async()=>({version:2,publishedVersion:1,data:source}),translate:async()=>assert.fail(),publishEdition:async()=>assert.fail(),fetcher:async()=>assert.fail()});assert.equal(output.jobs[0].status,'stale');
 const input=absoluteSource(source,site.origin);assert.equal(validateTranslation(input,english).status,'passed');assert(validateTranslation(input,{...english,markdown:english.markdown.replace('0.25','0.30')}).warnings.some(w=>w.includes('Numeric')));assert.throws(()=>validateTranslation(input,{...english,markdown:english.markdown.replace(site.origin+source.assets[0].path,'https://example.org/wrong.png')}),/lost/);
});

test('an uncertain Postiz submission is queried without resending; revised delivery cannot duplicate a slot',async t=>{
 const f=await fixture(t);await f.enqueue();const [{plan}]=await flowStatus(f.root),packet=externalPackage(plan,targets[0],null,topic);await atomic(join(f.handoffDirectory,'outbox',packet.id+'.json'),packet);let submits=0,queries=0;
 const adapter={submit:async()=>{submits++;throw Error('network timeout after send');},readback:async()=>{queries++;return {status:'unknown'};}};
 await postizTick({handoffDirectory:f.handoffDirectory,adapter});await postizTick({handoffDirectory:f.handoffDirectory,adapter});assert.equal(submits,1);assert.equal(queries,2);
 const revised=externalPackage({...plan,id:'another-version',source:{...plan.source,summary:'新的摘要'}},targets[0],null,topic);await atomic(join(f.handoffDirectory,'outbox',revised.id+'.json'),revised);
 const result=await postizTick({handoffDirectory:f.handoffDirectory,adapter});assert(result.some(r=>r.status==='needs_decision'));assert.equal(submits,1);
});

test('English website timeout resumes the original request and verifies an independent public page',async t=>{
 const f=await fixture(t);await f.enqueue();const [{plan}]=await flowStatus(f.root);const tokenFile=join(f.root,'token');await writeFile(tokenFile,'TOKEN_SENTINEL',{mode:0o600});let sends=0,request;
 // The Windows desktop injects its vault credential into the child process;
 // POSIX file mode bits are meaningful only for the Linux/macOS file path.
 if(process.platform==='win32'){const before=process.env.SCHOLAY_TODAY_TOKEN;process.env.SCHOLAY_TODAY_TOKEN='TOKEN_SENTINEL';t.after(()=>{if(before===undefined)delete process.env.SCHOLAY_TODAY_TOKEN;else process.env.SCHOLAY_TODAY_TOKEN=before;});}
 const fetcher=async(url,options={})=>{
  const u=new URL(url);if(u.pathname.endsWith('/api/site'))return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin,capabilities:['language-editions-v1']});
  if(u.pathname.includes('/flow-source/')){const isEN=u.pathname.includes('edition-en-');return Response.json(isEN?{version:1,publishedVersion:1,sha256:sourceContentSha256(request.data)}:{version:1,publishedVersion:1,data:source,sha256:plan.sha256});}
  if(u.pathname.includes('/cloud/edition'))return Response.json({error:'absent'},{status:404});
  if(u.pathname.endsWith('/publish')){sends++;request=JSON.parse(options.body);throw Error('submission timeout');}
  if(u.pathname.includes('/requests/'))return Response.json({revision:1,url:'/en/news/'+source.id+'/',job:{status:'success'}});
  return new Response('<html lang="en"><link rel="canonical" href="'+site.origin+'/en/news/'+source.id+'/"><div class="article-body">'+renderArticle(english.markdown.replace(/^# [^\n]+\n+/,''))+'</div></html>');
 };
 const website=flowWebsite({root:f.root,site,tokenFile,fetcher});const first=await website.publishEdition(plan,english);assert.equal(first.status,'verified');const second=await website.publishEdition(plan,english);assert.equal(second.requestKey,first.requestKey);assert.equal(sends,1);assert.equal(request.data.id,editionArticleId(source.id,'en'));assert.equal(request.data.translationOf.sha256,plan.sha256);
});

test('Postiz watcher stays idle without AI or polling after completion and wakes for a new JSON package',async t=>{
 const {watchPostiz}=await import('../scripts/publishing-flow-watch.mjs');const f=await fixture(t),controller=new AbortController();let ticks=0;let wake;
 const awakened=new Promise(resolve=>wake=resolve);const outputs=[];
 const watching=watchPostiz({directory:f.handoffDirectory,signal:controller.signal,emit:value=>outputs.push(value),tick:async()=>{ticks++;if(ticks===1){await writeFile(join(f.handoffDirectory,'outbox','new.json'),'{}');}else{wake();controller.abort();}return [];}});
 try{await Promise.race([awakened,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Watcher did not consume file notification')),10000);awakened.finally(()=>clearTimeout(timer));})]);}finally{controller.abort();await watching;}
 assert.equal(ticks,2);assert.equal(outputs.length,1);
});

test('Postiz independently rejects unapproved source articles before invoking any transport',async t=>{
 const {postizAdapter}=await import('../scripts/publishing-flow-postiz.mjs');const f=await fixture(t);await f.enqueue();const [{plan}]=await flowStatus(f.root);const packet=externalPackage(plan,targets[0],null,topic);
 const adapter=postizAdapter({handoffDirectory:f.handoffDirectory,command:'/transport-must-never-run',allowedTargets:targets,allowedSources:[{siteId:site.id,articleId:'another-source',sha256:plan.sha256}]});
 await assert.rejects(adapter.submit(packet),/article is outside/);
});

test('the real background CLI starts and exits an empty queue without loading a model or making requests',async t=>{
 const f=await fixture(t),run=promisify(execFile);
 await mkdir(join(f.root,'articles'));await atomic(join(f.root,'_ops/inventory/article-index.json'),{articles:{},annexColumns:site.columns});await atomic(join(f.root,'.site.json'),site);
 const result=await run(process.execPath,['scripts/publishing-flow-cli.mjs','root',f.root,'drain'],{cwd:new URL('..',import.meta.url),env:{...process.env,SCHOLAY_EDITORIAL_ROOT:f.root,SCHOLAY_APP_DATA:f.root,SCHOLAY_SITE_CONFIG:join(f.root,'.site.json'),SCHOLAY_SITE_ID:site.id,SCHOLAY_SITE_JSON:JSON.stringify(site)},timeout:10000});
 assert.deepEqual(JSON.parse(result.stdout),{status:'idle'});assert.equal(result.stderr,'');
});

test('read-only Postiz preflight failure leaves no write intent and a later successful check submits once',async t=>{
 const f=await fixture(t);await f.enqueue();const [{plan}]=await flowStatus(f.root),packet=externalPackage(plan,targets[0],null,topic);await atomic(join(f.handoffDirectory,'outbox',packet.id+'.json'),packet);let available=false,sends=0;
 const adapter={preflight:async()=>{if(!available)throw Error('Temporary source read failure');},submit:async()=>{sends++;return {postId:'real-post'};},readback:async()=>({status:'verified'})};
 assert.equal((await postizTick({handoffDirectory:f.handoffDirectory,adapter}))[0].status,'deferred');assert.equal(sends,0);
 await assert.rejects(readFile(join(f.handoffDirectory,'receipts',packet.id+'.json')),e=>e.code==='ENOENT');available=true;
 await postizTick({handoffDirectory:f.handoffDirectory,adapter});await postizTick({handoffDirectory:f.handoffDirectory,adapter});assert.equal(sends,1);
});

test('changing a continuation policy cannot regenerate or relaunch a completed source revision',async t=>{
 const f=await fixture(t),first=await f.enqueue();await atomic(join(f.root,'.local/publishing-flow/jobs',first.id,'state.json'),{complete:true});
 await configureFlow(f.root,site,{...f.policy,autoRun:true,articleIds:['*'],notBefore:'2026-10-22T03:00:00Z'});const repeated=await f.enqueue(source,{url:'/news/'+source.id+'/',revision:1,publicReadback:true,explicitContinuation:true,job:{status:'success'}});
 assert.deepEqual(repeated,{status:'complete',id:first.id});const jobs=await flowStatus(f.root);assert.equal(jobs.length,1);assert.equal(jobs[0].plan.policy.autoRun,undefined);
});

test('the DEV.to account cooldown is shared across articles and delays before transport or network reads',async t=>{
 const {postizAdapter}=await import('../scripts/publishing-flow-postiz.mjs');const f=await fixture(t);await f.enqueue();const [{plan}]=await flowStatus(f.root),packet=externalPackage(plan,targets[1],english,topic),nextAt=460000;
 await atomic(join(f.handoffDirectory,'rate',hash(['devto',targets[1].integrationId])+'.json'),{id:'previous-article',nextAt});
 const adapter=postizAdapter({handoffDirectory:f.handoffDirectory,command:'/transport-must-never-run',allowedTargets:targets,allowedSources:[{siteId:site.id,articleId:source.id,sha256:plan.sha256}],delivery:'publish',publishAuthorization:'Explicit permission for this publication cooldown test',now:()=>100000,fetcher:async()=>assert.fail('Cooling down must not make requests')});
 await assert.rejects(adapter.preflight(packet),e=>e.retryAt===nextAt&&e.message.includes('cooling down'));
});

test('site-wide continuation only observes new submissions; checking an older receipt cannot backfill AI work',async t=>{
 const f=await fixture(t);await configureFlow(f.root,site,{...f.policy,articleIds:['*'],notBefore:'2026-10-22T03:00:00Z'});
 const receipt={url:'/news/'+source.id+'/',revision:1,publicReadback:true,job:{status:'success'}};
 assert.equal((await f.enqueue(source,receipt)).status,'out_of_scope');assert.equal((await f.enqueue(source,{...receipt,submittedAt:'2026-10-21T03:00:00Z'})).status,'out_of_scope');assert.equal((await flowStatus(f.root)).length,0);
 assert.equal((await f.enqueue(source,{...receipt,submittedAt:'2026-10-22T03:01:00Z'})).status,'queued');
});

test('failed source-link QA retains the complete candidate and model provenance for review without another model call',async t=>{
 const f=await fixture(t);await f.enqueue();let models=0;
 await todayTick({root:f.root,site,readSource:async()=>({version:1,publishedVersion:1,data:source}),fetcher:async()=>Response.json({version:1,links:{['/news/'+source.id+'/']:topic}}),translate:async()=>{models++;return {...english,markdown:english.markdown.replace('https://example.org/study','https://example.org/incorrect'),provenance:{agentId:'cursor',modelId:'existing-model'}};},publishEdition:async()=>assert.fail('Failed QA must not submit')});
 const [{state}]=await flowStatus(f.root);assert.equal(state.translation.status,'failed');const candidate=JSON.parse(await readFile(state.translation.candidatePath,'utf8'));assert(candidate.markdown.includes('https://example.org/incorrect'));assert.equal(candidate.provenance.modelId,'existing-model');assert.equal(models,1);
 assert.doesNotThrow(()=>validateTranslation(absoluteSource(source,site.origin),{...english,summary:'An accurate longer summary. '.repeat(25)}));
});
