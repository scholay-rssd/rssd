import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {createBridgeClient} from '../desktop/scripts/agent/headless/bridge-client.mjs';
import {confirmPublication} from '../desktop/scripts/agent/headless/publication.mjs';
import {recoveryPlan} from '../desktop/scripts/agent/headless/recover.mjs';
import {applySiteEnv,cursorPathEnv,repoRoot} from '../desktop/scripts/agent/headless/env.mjs';
import {initSpaces} from '../desktop/scripts/agent/headless/spaces.mjs';
import {DEFAULT_SITE,profiles} from '../scripts/site-config.mjs';
import {initializeSiteWorkspace} from '../scripts/space-registry.mjs';
import {parseArgs} from '../desktop/scripts/agent/headless/produce.mjs';

async function fixture(t){const home=await mkdtemp(join(tmpdir(),'headless-recovery-'));t.after(()=>rm(home,{recursive:true,force:true}));return home;}
function environment(t,values){
 const keys=[...new Set([...Object.keys(values),'SCHOLAY_SITE_CONFIG','SCHOLAY_SITE_JSON','SCHOLAY_SITE_ID','SCHOLAY_EDITORIAL_ROOT','SCHOLAY_TODAY_TOKEN_FILE'])];
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,values);
 t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
}
async function authorization(home,site){
 await mkdir(join(home,'auth',site.id),{recursive:true});
 await writeFile(join(home,'auth',site.id,site.id+'.scholay-site.json'),JSON.stringify({format:'scholay-site-authorization',version:1,issuedAt:'2026-10-17T00:00:00.000Z',site,credential:{id:'11111111-1111-4111-8111-111111111111',scope:'editorial_publish',token:'A'.repeat(48)}}));
}

test('academic initialization continues using the real editorial workspace and clears a prior site',{skip:!existsSync(join(repoRoot,'editorial'))&&'requires the private editorial workspace'},async t=>{
 const home=await fixture(t);
 environment(t,{SCHOLAY_AUTH_DIR:join(home,'auth'),SCHOLAY_SPACES_ROOT:join(home,'spaces'),SCHOLAY_HEADLESS_HOME:join(home,'runs')});
 await authorization(home,DEFAULT_SITE);
 assert.equal(initSpaces(['today'])[0].workspace,join(repoRoot,'editorial'));
 assert.equal(applySiteEnv('today').root,join(repoRoot,'editorial'));
 await rm(join(home,'spaces','academic','site.json'));
 process.env.SCHOLAY_SITE_ID='pets';process.env.SCHOLAY_SITE_JSON=JSON.stringify(profiles.find(s=>s.id==='pets'));process.env.SCHOLAY_SITE_CONFIG='stale';
 assert.equal(applySiteEnv('today').site.id,DEFAULT_SITE.id);
 assert.equal(process.env.SCHOLAY_SITE_CONFIG,undefined);
 assert.equal(process.env.SCHOLAY_SITE_ID,DEFAULT_SITE.id);
});

test('initialization rejects an occupied workspace belonging to another site before replacing its token',async t=>{
 const home=await fixture(t),site=profiles.find(s=>s.id==='pets');
 environment(t,{SCHOLAY_AUTH_DIR:join(home,'auth'),SCHOLAY_SPACES_ROOT:join(home,'spaces')});
 await authorization(home,site);initSpaces(['pets']);
 const binding=join(home,'spaces','pets','workspace','.site.json');
 const token=join(home,'auth','pets','publish-token'),before=await readFile(token,'utf8');
 await writeFile(binding,JSON.stringify(profiles.find(s=>s.id==='metho')));
 assert.throws(()=>initSpaces(['pets']),/another site/);
 assert.equal(await readFile(token,'utf8'),before);
});

test('importing the producer does not bind another site before environment setup',async t=>{
 const home=await fixture(t),site=profiles.find(s=>s.id==='metho');
 await mkdir(join(home,'spaces','metho'),{recursive:true});
 await writeFile(join(home,'spaces','metho','site.json'),JSON.stringify(site));
 initializeSiteWorkspace(join(home,'spaces','metho','workspace'),site);
 const url=file=>JSON.stringify(pathToFileURL(resolve(file)).href);
 const code=`await import(${url('desktop/scripts/agent/headless/produce.mjs')});
 const {applySiteEnv}=await import(${url('desktop/scripts/agent/headless/env.mjs')});applySiteEnv('metho');
 const {recordHeadings}=await import(${url('scripts/editorial-record.mjs')});
 const {finalizeNotebook}=await import(${url('desktop/scripts/agent/notebook-finalize.mjs')});
 const headings=recordHeadings('openSource');
 if(headings[1]!=='使用价值')throw Error('loaded wrong site: '+headings);
 const n=finalizeNotebook({kind:'openSource',blocks:headings.map((text,i)=>({id:'h'+i,text,type:'heading',level:2,state:'ready'}))},{requireImage:false});
 if(n.notebook.blocks.some(b=>b.level!==2))throw Error('demoted the target site protocol');`;
 const env={...process.env,SCHOLAY_SPACES_ROOT:join(home,'spaces'),SCHOLAY_AUTH_DIR:join(home,'auth'),SCHOLAY_HEADLESS_HOME:join(home,'runs')};
 for(const key of ['SCHOLAY_SITE_CONFIG','SCHOLAY_SITE_JSON','SCHOLAY_SITE_ID'])delete env[key];
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});

test('bridge workers do not inherit website token environment values',()=>{
 const env=cursorPathEnv({PATH:'test-path',SCHOLAY_TODAY_TOKEN:'secret',SCHOLAY_TODAY_TOKEN_FILE:'secret-file'});
 assert.equal(env.SCHOLAY_TODAY_TOKEN,undefined);assert.equal(env.SCHOLAY_TODAY_TOKEN_FILE,undefined);
 assert.ok(env.PATH.endsWith('test-path'));
});

test('a missing resume ID cannot silently create a new task',()=>{
 assert.throws(()=>parseArgs(['pets','pet-news','observation','brief.txt','--resume']),/requires a task ID/);
 assert.throws(()=>parseArgs(['pets','pet-news','observation','brief.txt','--resume','--no-publish']),/requires a task ID/);
 assert.equal(parseArgs(['pets','pet-news','observation','--resume','saved-task']).resume,'saved-task');
});

test('a terminal run event arriving before the RPC response is not lost',async t=>{
 const child=spawn(process.execPath,['--input-type=module','-e',`import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({event:{type:'task_state',taskId:'task',state:{runId:'run',busy:false,status:'done'}}}));console.log(JSON.stringify({id:r.id,result:{runId:'run'}}));});`],{stdio:['pipe','pipe','pipe']});
 const client=createBridgeClient(child,{runTimeout:300});t.after(()=>client.close());
 const result=await client.call('notebook_prompt');
 assert.equal((await client.idleOf('task',result.runId)).status,'done');
});

test('bridge exit rejects pending RPC and run waits promptly',async t=>{
 const child=spawn(process.execPath,['-e',`process.stdin.once('data',()=>process.exit(7));`],{stdio:['pipe','pipe','pipe']});
 const client=createBridgeClient(child);t.after(()=>client.close());
 await Promise.all([assert.rejects(client.call('task_get'),/bridge exited: 7/),assert.rejects(client.idleOf('task','run'),/bridge exited: 7/)]);
 await assert.rejects(client.call('task_get'),/bridge exited/);
});

test('a live but silent bridge times out a request',async t=>{
 const child=spawn(process.execPath,['-e',`process.stdin.resume();`],{stdio:['pipe','pipe','pipe']});
 await once(child,'spawn');const client=createBridgeClient(child,{callTimeout:100});t.after(()=>client.close());
 await assert.rejects(client.call('task_get'),/response timeout/);
});

test('publication waits for public readback and never treats an accepted request as completion',async()=>{
 const states=[{job:{status:'queued'}},{job:{status:'success'},publicReadback:false},{job:{status:'success'},publicReadback:true}];let calls=0;
 const receipt=await confirmPublication({status:async()=>({receipt:states[calls++]})},'draft-test',{sleep:async()=>{}});
 assert.equal(calls,3);assert.equal(receipt.publicReadback,true);
});

test('failed and timed-out publication return errors without preparing or submitting another request',async()=>{
 let writes=0,calls=0;const client={prepare(){writes++;},publish(){writes++;},status:async()=>{calls++;return {receipt:{requestKey:'original',job:{status:'failed'}}};}};
 await assert.rejects(confirmPublication(client,'draft-test'),/original request retained: original/);
 assert.equal(calls,1);assert.equal(writes,0);
 client.status=async()=>({receipt:{requestKey:'original',job:{status:'success'},publicReadback:false}});
 await assert.rejects(confirmPublication(client,'draft-test',{attempts:2,sleep:async()=>{}}),/not confirmed/);
 assert.equal(writes,0);
});

test('recovery handles an empty result directory without reading unrelated files',async t=>{
 const home=await fixture(t);await mkdir(join(home,'results'));await mkdir(join(home,'briefs'));
 await writeFile(join(home,'briefs','pets-pet-news.txt'),'brief');
 assert.deepEqual(recoveryPlan(home,'pets','pet-news').args,['pets','pet-news','observation',join(home,'briefs','pets-pet-news.txt')]);
 await writeFile(join(home,'results','unrelated.json'),'invalid');
 assert.equal(recoveryPlan(home,'pets','pet-news').done,false);
});

test('recovery resumes exported but unconfirmed publication and preserves mode and no-publish intent',async t=>{
 const home=await fixture(t);await mkdir(join(home,'results'));
 const file=join(home,'results','pets-pet-news-2.result.json');
 const saved={site:'pets',sectionId:'pet-news',taskId:'same-task',mode:'xiwen',canonicalPath:'article.md',briefFile:join(home,'original-custom-brief.txt')};
 await writeFile(file,JSON.stringify(saved));
 let plan=recoveryPlan(home,'pets','pet-news');assert.equal(plan.done,false);assert.ok(plan.args.includes('same-task'));assert.equal(plan.args[2],'xiwen');assert.equal(plan.args[3],saved.briefFile);
 await writeFile(file,JSON.stringify({...saved,noPublish:true}));assert.equal(recoveryPlan(home,'pets','pet-news').done,true);
 await writeFile(file,JSON.stringify({...saved,noPublish:true,error:'interrupted'}));assert.ok(recoveryPlan(home,'pets','pet-news').args.includes('--no-publish'));
 await writeFile(file,'broken');assert.throws(()=>recoveryPlan(home,'pets','pet-news'),SyntaxError);
});

test('queue reports any missing brief as failure and stops at its consecutive error limit',async t=>{
 const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
 if(!existsSync(bash)){t.skip('Bash is not installed');return;}
 const home=await fixture(t),script=resolve('desktop/scripts/agent/headless/queue.sh').replaceAll('\\','/');
 const env={...process.env,SCHOLAY_HEADLESS_HOME:home.replaceAll('\\','/'),SCHOLAY_HEADLESS_ERROR_LIMIT:'2',SCHOLAY_HEADLESS_SKIP_UPDATE:'1'};
 const single=spawnSync(bash,[script,'pets','pet-news:observation'],{env,encoding:'utf8'});
 assert.equal(single.status,1,single.stderr);
 const batch=spawnSync(bash,[script,'pets','first:observation','second:observation','third:observation'],{env,encoding:'utf8'});
 assert.equal(batch.status,1);assert.match(batch.stderr,/error limit reached/);assert.doesNotMatch(batch.stderr,/third/);
});
