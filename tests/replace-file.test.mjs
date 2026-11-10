import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {replaceFile} from '../scripts/replace-file.mjs';
import {atomicJson} from '../scripts/editorial-sync.mjs';
import {durableWriteJson} from '../scripts/durable-json.mjs';

test('a temporary Windows sharing violation preserves the old file until atomic replacement succeeds',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'replace-file-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const source=join(dir,'pending'),target=join(dir,'saved');await writeFile(source,'new');await writeFile(target,'old');
 const errors=['EPERM','EACCES','EBUSY'];let attempts=0;
 await replaceFile(source,target,{platform:'win32',move:async(from,to)=>{assert.equal(await readFile(to,'utf8'),'old');if(attempts<errors.length)throw Object.assign(Error('busy'),{code:errors[attempts++]});return rename(from,to);},wait:async()=>{assert.equal(await readFile(target,'utf8'),'old');}});
 assert.equal(await readFile(target,'utf8'),'new');await assert.rejects(readFile(source),{code:'ENOENT'});
});

test('persistent Windows denial is bounded and keeps both old and pending bytes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'replace-denied-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const source=join(dir,'pending'),target=join(dir,'saved');await writeFile(source,'new');await writeFile(target,'old');
 const failure=Object.assign(Error('denied'),{code:'EPERM'});let calls=0,delay=0;
 await assert.rejects(replaceFile(source,target,{platform:'win32',move:async()=>{calls++;throw failure;},wait:async ms=>{delay+=ms;}}),error=>error===failure);
 assert(calls>1&&calls<=10);assert(delay>0&&delay<=2000);assert.equal(await readFile(source,'utf8'),'new');assert.equal(await readFile(target,'utf8'),'old');
});

test('missing sources and non-Windows permission errors are reported immediately',async()=>{
 for(const [platform,code] of [['win32','ENOENT'],['win32','ENOSPC'],['linux','EPERM']]){
  const failure=Object.assign(Error(code),{code});let calls=0;
  await assert.rejects(replaceFile('source','target',{platform,move:async()=>{calls++;throw failure;},wait:async()=>assert.fail('must not retry')}),error=>error===failure);assert.equal(calls,1);
 }
});

test('both JSON writers replace complete records and leave no temporary files',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'json-replacement-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const writer of [atomicJson,durableWriteJson]){
  const file=join(dir,writer.name+'.json');await writer(file,{revision:1});await writer(file,{revision:2,text:'完整保存'});assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{revision:2,text:'完整保存'});
 }
 assert.deepEqual((await readdir(dir)).sort(),['atomicJson.json','durableWriteJson.json']);
});
