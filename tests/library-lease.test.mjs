import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

test('standalone library editing reserves a work without a task and excludes another writer',async t=>{
 const root=await mkdtemp(join(tmpdir(),'scholay-library-lease-'));
 await mkdir(join(root,'articles'));await mkdir(join(root,'_ops/inventory'),{recursive:true});
 await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));
 const child=spawn(process.execPath,[resolve('desktop/scripts/agent/bridge.mjs')],{env:{...process.env,SCHOLAY_EDITORIAL_ROOT:root},stdio:['pipe','pipe','pipe']});
 t.after(async()=>{child.kill();await rm(root,{recursive:true,force:true});});
 let sequence=0;const pending=new Map();
 createInterface({input:child.stdout}).on('line',line=>{const result=JSON.parse(line),item=pending.get(result.id);if(item){pending.delete(result.id);clearTimeout(item.timer);result.error?item.reject(Error(result.error)):item.resolve(result.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('bridge timeout')),5000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 assert.equal((await call('task_list')).length,0);
 await call('task_lease',{editorId:'library',articleId:'sample-work'});
 assert.equal((await call('task_leases'))['sample-work'].owner,'editor-library');
 assert.equal((await call('task_list')).length,0);
 const task=await call('task_create',{mode:'observation',title:'isolated'});
 await assert.rejects(call('task_lease',{taskId:task.id,articleId:'sample-work'}),/另一个任务或编辑器/);
 await call('task_lease',{editorId:'library',articleId:'sample-work',release:true});
 await call('task_lease',{taskId:task.id,articleId:'sample-work'});
 assert.equal((await call('task_leases'))['sample-work'].owner,'editor-'+task.id);
 child.stdin.end();
});
