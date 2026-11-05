import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {atomic,optional} from '../scripts/publishing-flow.mjs';
import {syncCloudContinuations} from '../scripts/publishing-flow-cloud-sync.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'cloud-sync-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const site=profiles.find(row=>row.id==='metho'),dir=join(root,'.local/sites/metho');
 await atomic(join(root,'.site.json'),site);
 const config={version:1,workspaces:[{root,site,tokenFile:join(root,'token')}]};
 const receipt={requestKey:'original-key',asyncQueue:{owner:'cloud',continuationOwner:'cloud',jobId:'a'.repeat(64),phase:'complete',continuation:{owner:'cloud',status:'queued'}}};
 await atomic(join(dir,'queue-index.json'),{version:1,items:{'article-one':{},'article-local':{},'article-unsubmitted':{}}});
 await atomic(join(dir,'article-one/receipt.json'),receipt);
 await atomic(join(dir,'article-local/receipt.json'),{...receipt,asyncQueue:{...receipt.asyncQueue,continuationOwner:'local'}});
 await atomic(join(dir,'article-unsubmitted/receipt.json'),{...receipt,asyncQueue:{...receipt.asyncQueue,jobId:undefined}});
 return {root,site,dir,config,receipt};
}
test('sync reads only accepted explicit-cloud jobs and persists backoff across restarts',async t=>{
 const {config,receipt,dir}=await fixture(t);let calls=0;
 const publisher=()=>({refreshCloudContinuation:async id=>{assert.equal(id,'article-one');calls++;return {receipt};}});
 await syncCloudContinuations(config,{now:1000,publisher});
 await syncCloudContinuations(config,{now:2000,publisher});assert.equal(calls,1);
 await syncCloudContinuations(config,{now:31000,publisher});assert.equal(calls,2);
 const state=await optional(join(dir,'article-one/cloud-sync.json'));assert.equal(state.retryAt,91000);
});
test('completed artifact settles original queue index; failure stays recoverable',async t=>{
 const {config,receipt,dir}=await fixture(t);let settled=0;
 await syncCloudContinuations(config,{now:1000,publisher:()=>({refreshCloudContinuation:async()=>{throw Error('network disconnected');}})});
 assert.equal((await optional(join(dir,'article-one/cloud-sync.json'))).status,'retry');
 assert.ok((await optional(join(dir,'queue-index.json'))).items['article-one']);
 await syncCloudContinuations(config,{now:999999,evidence:async()=>({verified:true}),publisher:()=>({refreshCloudContinuation:async()=>({receipt:{...receipt,asyncQueue:{...receipt.asyncQueue,continuation:{owner:'cloud',status:'complete'}}}})}),settle:async(root,site,id)=>{assert.equal(site.id,'metho');assert.equal(id,'article-one');settled++;}});
 assert.equal(settled,1);assert.equal((await optional(join(dir,'article-one/cloud-sync.json'))).status,'complete');
});
test('mismatched workspace cannot read or refresh another site',async t=>{
 const {config,root}=await fixture(t);await atomic(join(root,'.site.json'),profiles.find(row=>row.id==='legis'));
 await assert.rejects(syncCloudContinuations(config,{publisher:()=>{throw Error('must not call');}}),/identity mismatch/);
});
test('remote complete without a local artifact still refreshes and never settles early',async t=>{
 const {config,receipt,dir}=await fixture(t);receipt.asyncQueue.continuation.status='complete';await atomic(join(dir,'article-one/receipt.json'),receipt);let calls=0;
 await syncCloudContinuations(config,{publisher:()=>({refreshCloudContinuation:async(id,expected)=>{assert.equal(expected.jobId,receipt.asyncQueue.jobId);calls++;return {receipt};}}),settle:async()=>{throw Error('must not settle without artifact');}});
 assert.equal(calls,1);assert.equal((await optional(join(dir,'article-one/cloud-sync.json'))).status,'waiting');
});
test('read-only cloud consumer rejects a replaced local request inside the article lock',async t=>{
 const {root,site,receipt,dir}=await fixture(t);const changed={...receipt,requestKey:'different-request',asyncQueue:{...receipt.asyncQueue,owner:'local',phase:'queued'}};
 await atomic(join(dir,'article-one/receipt.json'),changed);let network=0;
 const publisher=createWebsitePublisher({root,site,fetcher:async()=>{network++;throw Error('must not send');}});
 await assert.rejects(publisher.refreshCloudContinuation('article-one',{requestKey:receipt.requestKey,jobId:receipt.asyncQueue.jobId}),/request changed/);
 assert.equal(network,0);assert.deepEqual(await optional(join(dir,'article-one/receipt.json')),changed);
});
