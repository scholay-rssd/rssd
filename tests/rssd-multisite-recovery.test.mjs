import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createWorkRecoveryAdapter} from '../scripts/rssd-multisite-work-mode.mjs';
import {CenterOutbox} from '../scripts/rssd-center-client.mjs';
import protocol from '../contracts/rssd-v1.cjs';
const slot={id:'slot-one',siteId:'enter',workspaceId:'enter',sectionId:'forums'};
const demand=protocol.demand({id:slot.id,workspaceId:'enter',sectionId:'forums',kind:'write',title:'Topic',brief:'Brief',requiredLocales:['zh-CN']});
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'rssd-recovery-'));t.after(()=>rm(home,{recursive:true,force:true}));let claim=null;const client={origin:'https://center.example',activeClaim:async()=>claim,submission:async()=>{throw Error('unexpected');}};const lookup=async()=>({state:'found',demand:{state:'queued',payload:demand}});return {home,client,lookup,setClaim:value=>claim=value};}
test('recovery retries the same queued original only when device and outbox are clear',async t=>{
 const f=await fixture(t),inspect=createWorkRecoveryAdapter(f);assert.deepEqual(await inspect({slot,demand}),{state:'retry',demandId:slot.id});f.setClaim({id:slot.id});assert.deepEqual(await inspect({slot,demand}),{state:'blocked'});
});
test('pending original outbox never results in a new claim or POST',async t=>{
 const f=await fixture(t),box=new CenterOutbox({directory:join(f.home,'outbox'),client:f.client});await box.enqueue({requestId:'request',workId:'work',workspaceId:'enter',sectionId:'forums',demandId:slot.id,claimToken:'claim',editions:[{locale:'zh-CN',title:'Title',bodyMarkdown:'Body'}]});
 assert.deepEqual(await createWorkRecoveryAdapter(f)({slot,demand}),{state:'blocked'});
});
test('unrelated or changed original demand cannot be retried',async t=>{
 const f=await fixture(t);f.lookup=async()=>({state:'found',demand:{state:'queued',payload:{...demand,title:'changed'}}});assert.deepEqual(await createWorkRecoveryAdapter(f)({slot,demand}),{state:'blocked'});
});
