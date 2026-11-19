import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createBridgeClient} from '../desktop/scripts/agent/headless/bridge-client.mjs';

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
