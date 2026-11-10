import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {languageProcess} from '../scripts/publishing-language-process.mjs';
import {translateEdition} from '../scripts/publishing-flow-language.mjs';
const fixture=fileURLToPath(new URL('./fixtures/language-process-child.mjs',import.meta.url));
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'today-language-process-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const ready=child=>new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};

test('translation EOF closes the agent and its worker before releasing the session',async t=>{
 const dir=await directory(t),receipt=join(dir,'processes.json');
 const session=languageProcess(process.execPath,[fixture,'graceful',receipt],{cwd:dir});
 t.after(()=>session.stop({graceMs:10,termMs:10}));await ready(session.child);
 const ids=JSON.parse(await readFile(receipt,'utf8'));
 assert.deepEqual(await session.stop(),{method:'eof'});
 assert.equal(await readFile(receipt+'.eof','utf8'),'received');
 await assert.rejects(readFile(receipt+'.signal'),{code:'ENOENT'});
 assert.equal(alive(ids.pid),false);assert.equal(alive(ids.worker),false);
});

test('hung translation kills only its private process group, leaving another session running',{skip:process.platform==='win32'},async t=>{
 const dir=await directory(t),receipt=join(dir,'processes.json');
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>unrelated.kill());
 const session=languageProcess(process.execPath,[fixture,'stubborn',receipt],{cwd:dir});
 t.after(()=>session.stop({graceMs:10,termMs:10}));await ready(session.child);
 const ids=JSON.parse(await readFile(receipt,'utf8'));
 assert.deepEqual(await session.stop({graceMs:50,termMs:50}),{method:'kill'});
 assert.equal(session.child.signalCode,'SIGKILL');assert.equal(alive(unrelated.pid),true);
 let state='';try{state=execFileSync('ps',['-o','stat=','-p',String(ids.worker)],{encoding:'utf8'}).trim();}catch(error){assert.equal(error.status,1);}
 assert.ok(!state||state.startsWith('Z'),'worker must have exited, including an unreaped zombie');
});

test('a timed-out translation performs graceful cleanup and releases its lock',async t=>{
 const dir=await directory(t),receipt=join(dir,'processes.json'),previous=process.env.SCHOLAY_PUBLISHING_LANGUAGE_LOCK;
 process.env.SCHOLAY_PUBLISHING_LANGUAGE_LOCK=join(dir,'language.lock');
 t.after(()=>{if(previous===undefined)delete process.env.SCHOLAY_PUBLISHING_LANGUAGE_LOCK;else process.env.SCHOLAY_PUBLISHING_LANGUAGE_LOCK=previous;});
 const registry={launch:async()=>({command:process.execPath,args:[fixture,'rpc-timeout',receipt],env:{}})};
 await assert.rejects(translateEdition({title:'测试',summary:'',markdown:'# 测试'},{root:dir,plan:{id:'test-timeout',sha256:'fixture',policy:{agentId:'cursor'}}},{registry,timeoutMs:150}),/timeout: session\/prompt/);
 const ids=JSON.parse(await readFile(receipt,'utf8'));
 assert.equal(alive(ids.pid),false);assert.equal(alive(ids.worker),false);
 assert.equal(await readFile(receipt+'.eof','utf8'),'received');
 await assert.rejects(readFile(join(dir,'language.lock')),{code:'ENOENT'});
});
