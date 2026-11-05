import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles,validateSite} from '../scripts/site-config.mjs';
import {configureFlow,enqueuePublished,flowDirectory,flowStatus,atomic,hash} from '../scripts/publishing-flow.mjs';
import {superviseFlows} from '../scripts/publishing-flow-supervisor.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {sourceContentSha256,editionRoute} from '../contracts/language-editions.mjs';
import {renderArticle} from '../web/engine/article-math.mjs';

const submitter='ORIGINAL_SUBMITTER_CREDENTIAL',workspaceToken='UNRELATED_WORKSPACE_CREDENTIAL';
const hook="import {registerHooks} from 'node:module';registerHooks({resolve(specifier,context,nextResolve){if(/desktop[\\/]|editorial-workspace\\.mjs|website-publication\\.mjs/.test(specifier))throw Error('Cloud worker imported local editorial/desktop module: '+specifier);return nextResolve(specifier,context);}});";
function environment(t,values){
 const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 for(const [key,value] of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
}
async function fixture(t,{twoPlans=false}={}){
 const root=await mkdtemp(join(tmpdir(),'today-cloud-worker-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const calls=[],requests=new Map(),editions=new Map(),sources=new Map(),errors=[];let site,source;
 const server=createServer(async(req,res)=>{
  const reply=(value,status=200)=>{res.writeHead(status,{'Content-Type':typeof value==='string'?'text/html':'application/json'});res.end(typeof value==='string'?value:JSON.stringify(value));};
  try{
   const url=new URL(req.url,site.origin),buffers=[];for await(const buffer of req)buffers.push(buffer);
   const body=buffers.length?JSON.parse(Buffer.concat(buffers).toString()):null;
   calls.push({path:url.pathname,method:req.method,token:req.headers.authorization,body});
   if(url.pathname==='/v1/chat/completions'){
    assert.equal(req.headers.authorization,undefined);assert.equal(body.model,'isolated-test-translator');
    const text=JSON.parse(body.messages[1].content.split('SOURCE DATA:\n')[1]);
    const translations={'静默翻译':'Silent translation','保留原始事实。':'Retain the original facts.','这是一篇完整文章。':'This is the complete original article.'};
    assert(translations[text],'Unexpected prose chunk: '+text);
    return reply({choices:[{message:{content:JSON.stringify({translation:translations[text]})},finish_reason:'stop'}]});
   }
   if(url.pathname==='/manage/api/site')return reply({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin,capabilities:['language-editions-v1']});
   if(url.pathname.startsWith('/manage/api/news/')){
    assert.equal(req.headers.authorization,'Bearer '+submitter,'Every private website operation retains the original submitter');
    assert.equal(req.headers['x-scholay-site'],site.id);
    if(url.pathname.startsWith('/manage/api/news/flow-source/')){
     const id=url.pathname.split('/').at(-1),data=sources.get(id)||editions.get(id);assert(data);
     return reply({version:1,publishedVersion:1,data,sha256:sourceContentSha256(data),url:editionRoute(data)});
    }
    if(url.pathname.startsWith('/manage/api/news/cloud/'))return reply({error:'absent'},404);
    if(url.pathname==='/manage/api/news/publish'){
     assert.equal(body.data.locale,'en','Continuation must never resubmit Chinese');
     const original=sources.get(body.data.translationOf.articleId);assert(original);assert.equal(body.data.translationOf.sha256,sourceContentSha256(original));
     assert(!requests.has(body.requestKey),'English POST is sent once');requests.set(body.requestKey,body);editions.set(body.data.id,body.data);
     return reply({revision:1,url:editionRoute(body.data),job:{id:'english-build',status:'success'}});
    }
    if(url.pathname.startsWith('/manage/api/news/requests/')){
     const request=requests.get(url.pathname.split('/').at(-1));assert(request);return reply({revision:1,url:editionRoute(request.data),job:{id:'english-build',status:'success'}});
    }
   }
   if(url.pathname==='/community/links.json')return reply({version:1,links:Object.fromEntries([...sources.values()].map(data=>[editionRoute(data),'https://enterscholar.com/t/-/12345']))});
   const edition=[...editions.values()].find(data=>editionRoute(data)===url.pathname);assert(edition,'Unexpected route: '+url.pathname);
   return reply('<html lang="en"><link rel="canonical" href="'+site.origin+url.pathname+'"><div class="article-body">'+renderArticle(edition.markdown.replace(/^# [^\n]+\n+/,''),{site})+'</div></html>');
  }catch(error){errors.push(error);reply({error:error.message},500);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 site=validateSite({...profiles.find(item=>item.id==='metho'),origin:'http://127.0.0.1:'+server.address().port,languages:['zh-CN','en']});
 source={id:'pending-cloud-source',title:'静默翻译',summary:'保留原始事实。',markdown:'# 静默翻译\n\n这是一篇完整文章。',date:'2026-10-25',author:site.author,category:site.columns[0],assets:[]};
 sources.set(source.id,source);if(twoPlans)sources.set('another-cloud-source',{...source,id:'another-cloud-source'});
 await atomic(join(root,'.site.json'),site);
 await configureFlow(root,site,{version:1,siteId:site.id,origin:site.origin,enabled:true,autoRun:true,authorization:'Only the already submitted cloud source',articleIds:[...sources.keys()],targets:[]});
 const tokenFile=join(root,'original-token'),defaultTokenFile=join(root,'default-token'),configFile=join(root,'translation.json');
 await writeFile(tokenFile,submitter,{mode:0o600});await protectPrivateFile(tokenFile);await writeFile(defaultTokenFile,workspaceToken,{mode:0o600});await protectPrivateFile(defaultTokenFile);
 await atomic(configFile,{version:1,endpoint:site.origin+'/v1/chat/completions',model:'isolated-test-translator',chunked:true,maxChunkChars:200,timeoutMs:20000,chunkTimeoutMs:5000});await protectPrivateFile(configFile);
 const queued=await enqueuePublished({root,site,data:source,receipt:{revision:1,url:editionRoute(source),publicReadback:true,job:{status:'success'}},credential:{credentialId:hash(submitter),tokenFile}});
 if(twoPlans){const data=sources.get('another-cloud-source');await enqueuePublished({root,site,data,receipt:{revision:1,url:editionRoute(data),publicReadback:true,job:{status:'success'}},credential:{credentialId:hash(submitter),tokenFile}});}
 const directory=join(flowDirectory(root),'jobs',queued.id),planBytes=await readFile(join(directory,'plan.json')),credentialBytes=await readFile(join(directory,'website-token'));
 // Production only stores queue/flow data. In particular, no articles/ or
 // _ops/inventory/article-index.json may be fabricated to make startup work.
 await assert.rejects(readFile(join(root,'_ops/inventory/article-index.json')),error=>error.code==='ENOENT');
 const intentFile=join(flowDirectory(root),'submissions','local-intent-never-owned.json');await atomic(intentFile,{articleId:'local-only-source',requestKey:'local-intent-never-owned',status:'pending'});const intentBytes=await readFile(intentFile);
 const supervisorFile=join(root,'supervisor.json');await atomic(supervisorFile,{version:1,workspaces:[{site,root,tokenFile:defaultTokenFile}]});
 environment(t,{SCHOLAY_CLOUD_EXECUTOR:'1',SCHOLAY_TRANSLATION_CONFIG:configFile,SCHOLAY_TODAY_TOKEN:'INHERITED_PRIVILEGED_TOKEN',SCHOLAY_DESKTOP_RUNTIME:undefined,SCHOLAY_FLOW_POLICY_FILE:undefined,SCHOLAY_PUBLISHING_LANGUAGE_LOCK:undefined,NODE_OPTIONS:'--import=data:text/javascript,'+encodeURIComponent(hook)});
 return {root,site,source,supervisorFile,directory,planBytes,credentialBytes,intentFile,intentBytes,calls,errors};
}
async function runOne(f){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);let results;
 try{await superviseFlows(f.supervisorFile,{signal:controller.signal,intervalMs:10,emit:value=>{results=value;controller.abort();}});}finally{clearTimeout(timer);controller.abort();}
 assert(results,'Supervisor did not run its pending job');assert.equal(results[0].code,0,JSON.stringify(results));assert.deepEqual(f.errors,[]);return JSON.parse(results[0].result);
}

test('real cloud supervisor completes a frozen pending plan with no editorial inventory and preserves its submitter', {timeout:90000},async t=>{
 const f=await fixture(t);const result=await runOne(f);
 assert.equal(result.modelCalls,1);assert.equal(result.jobs[0].complete,true);
 const [{plan,state}]=await flowStatus(f.root);assert.equal(state.translation.status,'ready');assert.equal(state.english.status,'verified');assert.equal(state.community.status,'verified');assert.deepEqual(plan.policy.targets,[]);
 const checkpoint=JSON.parse(await readFile(join(f.directory,'translation-result.json'),'utf8'));assert.equal(checkpoint.planId,plan.id);assert.equal(checkpoint.sourceSha256,plan.sha256);assert.equal(checkpoint.edition.title,'Silent translation');
 assert.equal((await readdir(join(f.directory,'translation-chunks'))).length,1);
 assert.deepEqual(await readFile(join(f.directory,'plan.json')),f.planBytes);assert.deepEqual(await readFile(join(f.directory,'website-token')),f.credentialBytes);assert.deepEqual(await readFile(f.intentFile),f.intentBytes);
 await assert.rejects(readFile(join(f.root,'_ops/inventory/article-index.json')),error=>error.code==='ENOENT');await assert.rejects(readdir(join(f.root,'articles')),error=>error.code==='ENOENT');
 const posts=f.calls.filter(call=>call.method==='POST'&&call.path==='/manage/api/news/publish');assert.equal(posts.length,1);assert.equal(posts[0].body.data.locale,'en');assert(f.calls.some(call=>call.path===editionRoute(posts[0].body.data)),'English public body was read back');
 const before=f.calls.length;
 // A completed flow plus a stray local intent must not keep cloud drain alive
 // or import local recovery on a later resume. This is another real CLI child.
 for(const [command,expected] of [['drain',{status:'idle'}],['resume',{modelCalls:0,jobs:[]}]]){
  const cli=await promisify(execFile)(process.execPath,['scripts/publishing-flow-cli.mjs','root',f.root,command],{cwd:new URL('..',import.meta.url),env:{...process.env,SCHOLAY_EDITORIAL_ROOT:f.root,SCHOLAY_SITE_JSON:JSON.stringify(f.site),SCHOLAY_SITE_ID:f.site.id,SCHOLAY_SITE_CONFIG:undefined},timeout:15000});
  assert.deepEqual(JSON.parse(cli.stdout),expected);assert.equal(cli.stderr,'');
 }
 assert.equal(f.calls.length,before);assert.deepEqual(await readFile(f.intentFile),f.intentBytes);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),100);let runs=0;
 try{await superviseFlows(f.supervisorFile,{signal:controller.signal,intervalMs:10,run:async()=>{runs++;controller.abort();return {code:0};}});}finally{clearTimeout(timer);controller.abort();}
 assert.equal(runs,0,'Cloud supervisor ignores local-only submission intents');
 // Local supervision keeps the pre-existing intent recovery trigger.
 delete process.env.SCHOLAY_CLOUD_EXECUTOR;const local=new AbortController();
 await superviseFlows(f.supervisorFile,{signal:local.signal,intervalMs:10,run:async()=>{runs++;local.abort();return {code:0};}});assert.equal(runs,1);
});

test('a real cloud worker without a provider records a configuration failure without loading local ACP', {timeout:90000},async t=>{
 const f=await fixture(t);delete process.env.SCHOLAY_TRANSLATION_CONFIG;const result=await runOne(f);
 assert.equal(result.modelCalls,1);assert.equal(result.jobs[0].translation,'failed');assert.match(result.jobs[0].error,/Cloud translation provider is not configured/);
 assert(!f.calls.some(call=>call.method==='POST'));assert.deepEqual(await readFile(join(f.directory,'plan.json')),f.planBytes);assert.deepEqual(await readFile(join(f.directory,'website-token')),f.credentialBytes);assert.deepEqual(await readFile(f.intentFile),f.intentBytes);
 await assert.rejects(readFile(join(f.directory,'translation-result.json')),error=>error.code==='ENOENT');
});

test('supervisor forwards one frozen plan to a real child and removing its scope restores the other pending plan', {timeout:90000},async t=>{
 const f=await fixture(t,{twoPlans:true}),[excluded,selected]=(await flowStatus(f.root)).map(row=>row.plan),config=JSON.parse(await readFile(f.supervisorFile,'utf8'));
 const excludedDirectory=join(flowDirectory(f.root),'jobs',excluded.id),before={plan:await readFile(join(excludedDirectory,'plan.json')),token:await readFile(join(excludedDirectory,'website-token'))};
 await atomic(f.supervisorFile,{...config,workspaces:config.workspaces.map(entry=>({...entry,planIds:[selected.id]}))});
 const result=await runOne(f);assert.deepEqual(result.jobs.map(job=>job.id),[selected.id]);assert.equal(result.jobs[0].complete,true);
 await assert.rejects(readFile(join(excludedDirectory,'state.json')),error=>error.code==='ENOENT');assert.deepEqual(await readFile(join(excludedDirectory,'plan.json')),before.plan);assert.deepEqual(await readFile(join(excludedDirectory,'website-token')),before.token);
 assert(!f.calls.some(call=>call.path.endsWith('/'+excluded.articleId)));assert.equal(f.calls.filter(call=>call.path==='/manage/api/news/publish').length,1);
 const env={...process.env,SCHOLAY_EDITORIAL_ROOT:f.root,SCHOLAY_SITE_JSON:JSON.stringify(f.site),SCHOLAY_SITE_ID:f.site.id,SCHOLAY_SITE_CONFIG:undefined};
 const cli=(command,flags)=>promisify(execFile)(process.execPath,['scripts/publishing-flow-cli.mjs','root',f.root,command,...flags],{cwd:new URL('..',import.meta.url),env,timeout:15000});
 const callCount=f.calls.length;
 assert.deepEqual(JSON.parse((await cli('tick',['--plan',selected.id,'--plan','f'.repeat(40)])).stdout),{modelCalls:0,jobs:[]});
 assert.deepEqual(JSON.parse((await cli('drain',['--plan',selected.id])).stdout),{status:'idle'});
 for(const flags of [['--plan'],['--plan','invalid'],['--plan',selected.id,'--plan',selected.id]])await assert.rejects(cli('resume',flags),error=>error.code===1&&/plan|Usage/.test(error.stderr));
 assert.equal(f.calls.length,callCount);await assert.rejects(readFile(join(excludedDirectory,'state.json')),error=>error.code==='ENOENT');
 // Removing the optional filter resumes the remaining plan without editing
 // either plan, its policy, or any retry timestamp.
 await atomic(f.supervisorFile,config);const restored=await runOne(f);assert.deepEqual(restored.jobs.map(job=>job.id),[excluded.id]);assert.equal(restored.jobs[0].complete,true);
 assert((await flowStatus(f.root)).every(row=>row.state.complete));assert.equal(f.calls.filter(call=>call.path==='/manage/api/news/publish').length,2);
});

test('real supervisor forwards the English review gate and only an explicit hash-bound CLI acceptance permits the first POST', {timeout:90000},async t=>{
 const f=await fixture(t),[{plan}]=await flowStatus(f.root),config=JSON.parse(await readFile(f.supervisorFile,'utf8'));
 await atomic(f.supervisorFile,{...config,workspaces:config.workspaces.map(entry=>({...entry,planIds:[plan.id],reviewBeforeEnglishPlanIds:[plan.id]}))});
 const generated=await runOne(f);assert.equal(generated.modelCalls,1);assert.equal(generated.jobs[0].status,'translation_review');assert.equal(generated.jobs[0].complete,false);
 assert.equal(f.calls.filter(call=>call.path==='/manage/api/news/publish').length,0);await assert.rejects(readFile(join(f.directory,'website-en.json')),error=>error.code==='ENOENT');
 const [{state}]=await flowStatus(f.root);assert.equal(state.translation.status,'ready');assert.equal(state.translationReviewRequired,true);assert.deepEqual(await flowStatus(f.root,{pendingOnly:true}),[]);
 const modelCalls=f.calls.filter(call=>call.path==='/v1/chat/completions').length,callCount=f.calls.length;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),100);let idleRuns=0;
 try{await superviseFlows(f.supervisorFile,{signal:controller.signal,intervalMs:10,run:async()=>{idleRuns++;controller.abort();return {code:0};}});}finally{clearTimeout(timer);controller.abort();}
 assert.equal(idleRuns,0);assert.equal(f.calls.length,callCount);
 const env={...process.env,SCHOLAY_EDITORIAL_ROOT:f.root,SCHOLAY_SITE_JSON:JSON.stringify(f.site),SCHOLAY_SITE_ID:f.site.id,SCHOLAY_SITE_CONFIG:undefined};
 const cli=args=>promisify(execFile)(process.execPath,['scripts/publishing-flow-cli.mjs','root',f.root,...args],{cwd:new URL('..',import.meta.url),env,timeout:15000});
 for(const flags of [['--review-before-english',plan.id],['--plan',plan.id,'--review-before-english','f'.repeat(40)],['--plan',plan.id,'--review-before-english',plan.id,'--review-before-english',plan.id]])await assert.rejects(cli(['resume',...flags]),error=>error.code===1&&/subset|planIds/.test(error.stderr));
 assert.equal(f.calls.length,callCount);
 const reviewedFile=join(f.root,'reviewed-edition.json');await atomic(reviewedFile,state.edition);
 const accepted=JSON.parse((await cli(['accept-translation',plan.id,reviewedFile,'--reviewed'])).stdout);assert.equal(accepted.status,'recovered');
 const approved=JSON.parse(await readFile(join(f.directory,'state.json'),'utf8'));assert.equal(approved.translation.reviewedEditionSha256,hash(state.edition));assert.equal(approved.translation.reviewedSourceSha256,plan.sha256);assert.equal(approved.status,'waiting');
 const published=await runOne(f);assert.equal(published.modelCalls,0);assert.equal(published.jobs[0].complete,true);assert.equal(f.calls.filter(call=>call.path==='/manage/api/news/publish').length,1);assert.equal(f.calls.filter(call=>call.path==='/v1/chat/completions').length,modelCalls);
 assert.deepEqual(await readFile(join(f.directory,'plan.json')),f.planBytes);assert.deepEqual(await readFile(join(f.directory,'website-token')),f.credentialBytes);assert.deepEqual(await readFile(f.intentFile),f.intentBytes);
});
