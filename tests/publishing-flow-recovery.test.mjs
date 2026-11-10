import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {profiles} from '../scripts/site-config.mjs';
import {atomic,optional,configureFlow,enqueuePublished,flowStatus,todayTick,hash} from '../scripts/publishing-flow.mjs';
import {flowWebsite} from '../scripts/publishing-flow-website.mjs';
import {superviseFlows} from '../scripts/publishing-flow-supervisor.mjs';
import {lockOwnerAlive} from '../scripts/editorial-lock.mjs';
import {sourceContentSha256,editionArticleId} from '../contracts/language-editions.mjs';
const site={...profiles.find(s=>s.id==='metho'),languages:['zh-CN','en']};
const source={id:'recovery-source',title:'恢复测试',summary:'中文原稿',markdown:'# 恢复测试\n\n正文和来源 [来源](https://example.org/a)\n\n![图片](https://example.org/a.png)',date:'2026-10-22',category:site.columns[0],author:site.author,assets:[]};
const english={title:'Recovery',summary:'Original Chinese article.',markdown:'# Recovery\n\nThe article and its source [source](https://example.org/a)\n\n![image](https://example.org/a.png)'};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'flow-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));const policy={version:1,siteId:site.id,origin:site.origin,enabled:true,autoRun:true,authorization:'Owned-site recovery trial',articleIds:[source.id],targets:[]};await configureFlow(root,site,policy);const {id}=await enqueuePublished({root,site,data:source,receipt:{revision:1,url:'/news/'+source.id+'/',publicReadback:true,job:{status:'success'}}});return {root,id,policy};}
const options=root=>({root,site,readSource:async()=>({version:1,publishedVersion:1,data:source}),translate:async()=>english,publishEdition:async()=>({status:'verified'}),fetcher:async()=>Response.json({version:1,links:{['/news/'+source.id+'/']:'https://enterscholar.com/t/-/415722'}})});
async function until(check){for(let i=0;i<200;i++){if(await check())return;await delay(20);}throw Error('Timed out waiting for child checkpoint');}
function child(root){const p=spawn(process.execPath,['tests/fixtures/flow-recovery-child.mjs',root],{stdio:['ignore','pipe','pipe']});p.stderr.resume();return p;}

test('internal-only continuation requires Ente and English, creates no external handoff',async t=>{
 const f=await fixture(t);await todayTick({...options(f.root),fetcher:async()=>Response.json({version:1,links:{}})});assert.equal((await flowStatus(f.root))[0].state.complete,false);
 await todayTick({...options(f.root),now:Date.now()+301000});assert.equal((await flowStatus(f.root))[0].state.complete,true);
 assert.deepEqual((await flowStatus(f.root))[0].state.dispatch,{});
});
test('temporary model failure backs off and resumes; three failures never trigger an unlimited AI loop',async t=>{
 const f=await fixture(t);let calls=0;const run=now=>todayTick({...options(f.root),now,translate:async()=>{calls++;throw Error('Language agent disconnected');}});
 await run(1000000);await run(1000001);assert.equal(calls,1);await run(1100000);await run(1400000);await run(2000000);assert.equal(calls,3);
 assert.equal((await flowStatus(f.root))[0].state.translation.status,'failed');
 const g=await fixture(t);await todayTick({...options(g.root),now:1000000,translate:async()=>{throw Error('provider unavailable');}});await todayTick({...options(g.root),now:1100000});assert.equal((await flowStatus(g.root))[0].state.complete,true);
});
test('temporary source outage resumes without a new source, policy or translation',async t=>{
 const f=await fixture(t);await todayTick({...options(f.root),now:1000000,readSource:async()=>{throw Error('fetch failed');}});
 await todayTick({...options(f.root),now:1100000});const [{state,plan}]=await flowStatus(f.root);assert.equal(state.complete,true);assert.equal(plan.sha256,sourceContentSha256(source));
});
test('SIGSTOP/SIGCONT preserves a suspended worker and SIGKILL restart consumes its exact durable translation',{skip:process.platform==='win32'},async t=>{
 for(const action of ['suspend','restart']){
  const f=await fixture(t);await atomic(join(f.root,'fixture.json'),{site,source,english});let p=child(f.root);t.after(()=>p.kill('SIGKILL'));
  await until(async()=>{try{await access(join(f.root,'checkpoint-ready'));return true;}catch{return false;}});
  if(action==='suspend'){
   p.kill('SIGSTOP');await delay(100);await atomic(join(f.root,'gate.json'),true);await delay(100);assert.equal(await optional(join(f.root,'published.json')),null);p.kill('SIGCONT');const [code]=await once(p,'exit');assert.equal(code,0);
  }else{p.kill('SIGKILL');await once(p,'exit');p=child(f.root);const [code]=await once(p,'exit');assert.equal(code,0);}
  assert.equal(await optional(join(f.root,'calls.json')),1);assert.equal((await flowStatus(f.root))[0].state.complete,true);
 }
});
test('supervisor is idle without network/AI, then consumes a pending operation once after restart',async t=>{
 const f=await fixture(t),file=join(f.root,'service.json'),state=join(f.root,'.local/publishing-flow/jobs',f.id,'state.json');await atomic(state,{complete:true});await atomic(file,{version:1,workspaces:[{root:f.root,site,tokenFile:join(f.root,'token')}]});let runs=0;
 const first=new AbortController();const idle=superviseFlows(file,{signal:first.signal,intervalMs:20,run:async()=>{runs++;return {};}});await delay(80);first.abort();await idle;assert.equal(runs,0);
 await atomic(state,{});const second=new AbortController();await superviseFlows(file,{signal:second.signal,intervalMs:20,run:async()=>{runs++;await todayTick(options(f.root));second.abort();return {code:0};}});assert.equal(runs,1);assert.equal((await flowStatus(f.root))[0].state.complete,true);
});
test('a reused Linux PID from another boot cannot block recovery',{skip:process.platform!=='linux'},async()=>{assert.equal(await lockOwnerAlive({pid:process.pid,identity:'previous-boot:123'}),false);});
test('crash before first English POST queries the old key, then replays its identical request only after 404',async t=>{
 const f=await fixture(t),[{plan}]=await flowStatus(f.root),tokenFile=join(f.root,'token');await writeFile(tokenFile,'test',{mode:0o600});
 const data={...source,...english,id:editionArticleId(source.id,'en'),locale:'en',translationOf:{articleId:source.id,revision:1,sha256:plan.sha256}};
 const request={requestKey:'original-request-12345',data,expectedVersion:0,expectedPublishedVersion:null};await atomic(join(f.root,'.local/publishing-flow/jobs',f.id,'website-en.json'),{status:'unknown',request});const calls=[];
 const fetcher=async(url,opt={})=>{const path=new URL(url).pathname;if(path.endsWith('/api/site'))return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin,capabilities:['language-editions-v1']});calls.push([opt.method,path]);if(path.includes('/requests/'))return Response.json({error:'missing'},{status:404});if(path.endsWith('/publish')){assert.equal(hash(JSON.parse(opt.body)),hash(request));return Response.json({revision:1,job:{id:'same-job',status:'queued'}});}assert.fail(path);};
 if(process.platform==='win32'){process.env.SCHOLAY_TODAY_TOKEN='test';t.after(()=>delete process.env.SCHOLAY_TODAY_TOKEN);}
 const result=await flowWebsite({root:f.root,site,tokenFile,fetcher,now:()=>100000}).publishEdition(plan,english);assert.equal(result.status,'queued');assert.deepEqual(calls.map(c=>c[0]),['GET','POST']);
});
