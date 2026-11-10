import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateRuntime,runtimeLease} from '../desktop/scripts/agent/headless/update.mjs';
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'headless-update-')),origin=join(dir,'origin.git'),source=join(dir,'source'),root=join(dir,'installed');
 await mkdir(source);git(source,'init','--initial-branch=main');git(source,'config','user.email','fixture@example.invalid');git(source,'config','user.name','Fixture');
 await writeFile(join(source,'.gitignore'),'.local/\nnode_modules/\ndesktop/runtime/node_modules/\n');await writeFile(join(source,'article.md'),'user article');await writeFile(join(source,'tool.mjs'),'old tool');
 git(source,'add','.');git(source,'commit','-m','initial');git(dir,'clone','--bare',source,origin);git(dir,'clone',origin,root);
 await writeFile(join(source,'tool.mjs'),'new tool');git(source,'commit','-am','new version');git(source,'push',origin,'main');
 const before=git(root,'rev-parse','HEAD'),next=git(source,'rev-parse','HEAD');t.after(()=>rm(dir,{recursive:true,force:true}));
 return {root,origin,before,next,source,prepare:async()=>{}};
}
test('headless update checks separately and fast-forwards only after validation, preserving receipts and articles',async t=>{
 const f=await fixture(t);await mkdir(join(f.root,'.local/receipts'),{recursive:true});await writeFile(join(f.root,'.local/receipts/original.json'),'original request key');
 const check=await updateRuntime(f);assert.equal(check.status,'available');assert.equal(git(f.root,'rev-parse','HEAD'),f.before);
 let validated=false;const result=await updateRuntime({...f,apply:true,prepare:async()=>{assert.equal(git(f.root,'rev-parse','HEAD'),f.before);validated=true;}});
 assert.equal(validated,true);assert.equal(result.status,'updated');assert.equal(git(f.root,'rev-parse','HEAD'),f.next);
 assert.equal(await readFile(join(f.root,'article.md'),'utf8'),'user article');assert.equal(await readFile(join(f.root,'.local/receipts/original.json'),'utf8'),'original request key');
});
test('running tasks and local edits defer updates without killing tasks or discarding files',async t=>{
 const f=await fixture(t),release=await runtimeLease(f.root);
 assert.equal((await updateRuntime({...f,apply:true})).status,'deferred');await release();
 await writeFile(join(f.root,'article.md'),'unsaved author changes');assert.equal((await updateRuntime({...f,apply:true})).status,'deferred');
 assert.equal(await readFile(join(f.root,'article.md'),'utf8'),'unsaved author changes');assert.equal(git(f.root,'rev-parse','HEAD'),f.before);
});
test('failed candidate validation preserves installed code and dependencies',async t=>{
 const f=await fixture(t);await mkdir(join(f.root,'node_modules'),{recursive:true});await writeFile(join(f.root,'node_modules/old'),'installed dependencies');
 await assert.rejects(updateRuntime({...f,apply:true,prepare:async()=>{throw Error('candidate failed');}}),/candidate failed/);
 assert.equal(git(f.root,'rev-parse','HEAD'),f.before);assert.equal(await readFile(join(f.root,'node_modules/old'),'utf8'),'installed dependencies');
});
test('candidate dependencies swap under the idle lock; a producer cannot start during installation',async t=>{
 const f=await fixture(t);await mkdir(join(f.root,'node_modules'));await writeFile(join(f.root,'node_modules/old'),'old');
 const r=await updateRuntime({...f,apply:true,prepare:async(_root,_ref,target)=>{
  await assert.rejects(runtimeLease(f.root),/正在启动/);await mkdir(join(target,'node_modules'),{recursive:true});await writeFile(join(target,'node_modules/new'),'new dependency');
 }});
 assert.equal(r.status,'updated');assert.equal(await readFile(join(f.root,'node_modules/new'),'utf8'),'new dependency');const release=await runtimeLease(f.root);await release();
});
test('automatic checks use the saved interval and foreign remotes are rejected',async t=>{
 const f=await fixture(t);await updateRuntime({...f,apply:true,automatic:true});assert.equal((await updateRuntime({...f,apply:true,automatic:true})).status,'skipped');
 await assert.rejects(updateRuntime({...f,origin:'https://example.invalid/foreign.git'}),/更新源必须/);
});
