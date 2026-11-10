import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {configuredCursorImageRuntime} from '../scripts/rssd-cursor-runtime-config.mjs';
import {createOriginalFirstProvider} from '../scripts/rssd-original-first-provider.mjs';
import {stageRequiredImage} from '../scripts/rssd-image-staging.mjs';
import {fixtureImagePolicy,fixtureReferenceSha,approveSyntheticReviews} from './fixtures/rssd-image-policy.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
const slot={blockId:'hero',requirement:'Research methods notebook',alt:'一张用于测试的八乘八像素合成图片不代表任何真实研究',caption:'合成测试示意图'};
const row=n=>({pageid:n,ns:6,imageinfo:[{url:`https://upload.wikimedia.org/wikipedia/commons/${n}.png`,descriptionurl:`https://commons.wikimedia.org/wiki/File:${n}.png`,mime:'image/png'}]});
async function setup(t,{commonsRead}={}){
 const home=await realpath(await mkdtemp(join(tmpdir(),'rssd-commons-integrated-')));t.after(()=>rm(home,{recursive:true,force:true}));const id=join(home,'identity.json'),ref=join(home,'reference');await writeFile(id,JSON.stringify({version:1,files:{}}),{mode:0o600});await writeFile(ref,png);
 let primaryCalls=0,commonsCalls=0,generations=0,looks=0;const config={enabled:true,runtimeIdentityPath:id,references:{one:{path:ref,sha256:createHash('sha256').update(png).digest('hex')}},trustedSources:[],commonsFallback:{enabled:true,maxPages:2,pageSize:5,timeoutMs:100,retries:0,primaryTimeoutMs:100}};
 const runtime=await configuredCursorImageRuntime(config,{registrarFactory:async()=>({}),search:async()=>{primaryCalls++;throw Error('Openverse unavailable');},commonsRead:async href=>{commonsCalls++;if(commonsRead)return commonsRead(href);return Buffer.from(JSON.stringify({continue:{continue:'gsroffset||',gsroffset:commonsCalls*5},query:{pages:[row(commonsCalls)]}}));}});
 const fallback={async start(){generations++;return {status:'pending'};},async lookup(){looks++;return {status:'ready',bytes:png,registration:{assetId:'asset',taskId:'task',sha256:media.imageManifest(png).sha256},provenance:{kind:'generated'}};}};
 const provider=createOriginalFirstProvider({directory:join(home,'original'),search:runtime.originalSource.search,review:runtime.originalSource.review,registrar:{async start(){assert.fail('no verified original');},async lookup(){assert.fail();}},fallback});
 return {home,jobDirectory:join(home,'job'),jobId:'job',siteId:'metho',workspaceId:'metho',client:{origin:'https://center.example'},slot:{...slot,referenceSha256:fixtureReferenceSha,commonsSearchWindow:runtime.originalSource.commonsSearchWindow},resolveImagePolicy:fixtureImagePolicy,provider,calls:()=>({primaryCalls,commonsCalls,generations,looks})};
}

test('configured original-first -> bounded Commons -> fallback keeps audit through recovery and receipt',async t=>{
 const x=await setup(t);await assert.rejects(stageRequiredImage(x),{code:'image_pending'});await assert.rejects(stageRequiredImage(x),{code:'image_pending'});await approveSyntheticReviews(x.jobDirectory);const result=await stageRequiredImage(x);
 assert.deepEqual(x.calls(),{primaryCalls:1,commonsCalls:2,generations:1,looks:2});assert.equal(result.provenance.kind,'generated');
 const audit=result.searchAudit;assert.equal(audit.decision,'no_verified_candidate_in_scope');assert.equal(audit.coverage.selected,'commons');assert.equal(audit.coverage.primary.status,'unavailable');assert.equal(audit.coverage.commons.stop,'window_limit');assert.equal(audit.coverage.commons.exhausted,false);assert.deepEqual(audit.coverage.commons.continuation,{continue:'gsroffset||',gsroffset:10});assert.equal(audit.outcomes.length,2);assert.ok(audit.outcomes.every(x=>x.status==='unverified'));
 const state=JSON.parse(await readFile(join(x.jobDirectory,'image-staging',protocol.hash([x.jobId,slot.blockId])+'.json'),'utf8'));assert.deepEqual(state.result.searchAudit,audit);assert.deepEqual(state.scope.commonsSearchWindow,x.slot.commonsSearchWindow);assert.equal(state.requestId,'image-'+protocol.hash(state.scope).slice(0,48));
 const again=await stageRequiredImage(x);assert.equal(again.reused,true);assert.deepEqual(again.searchAudit,audit);assert.deepEqual(x.calls(),{primaryCalls:1,commonsCalls:2,generations:1,looks:2});
});

test('Commons unavailable prevents generation',async t=>{
 const x=await setup(t,{commonsRead:async()=>{throw Error('offline');}});await assert.rejects(stageRequiredImage(x),{code:'image_pending'});assert.equal(x.calls().generations,0);
});

test('existing pending scope and hash remain unchanged when new Commons config is enabled',async t=>{
 const x=await setup(t),scope={origin:x.client.origin,workspaceId:x.workspaceId,jobId:x.jobId,blockId:slot.blockId,requirement:slot.requirement,imageSearchQuery:slot.requirement,alt:slot.alt,caption:slot.caption,referenceSha256:x.slot.referenceSha256},requestId='image-'+protocol.hash(scope).slice(0,48),dir=join(x.jobDirectory,'image-staging'),file=join(dir,protocol.hash([x.jobId,slot.blockId])+'.json');await mkdir(dir,{recursive:true});await writeFile(file,JSON.stringify({version:1,scope,requestId,providerId:'synthetic',status:'pending'}));
 const provider={id:'synthetic',async start(){assert.fail();},async lookup(input){assert.equal(input.requestId,requestId);assert.deepEqual(input.scope,scope);return {status:'pending'};}};
 await assert.rejects(stageRequiredImage({...x,provider}),{code:'image_pending'});const state=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(state.scope,scope);assert.equal(state.requestId,requestId);assert.equal(x.calls().commonsCalls,0);
});

test('Openverse successful searches retain observed pagination without claiming exhaustion',async()=>{
 const {searchOriginalImageLeads}=await import('../scripts/rssd-original-first-provider.mjs');let calls=0;
 const read=async()=>{calls++;return Buffer.from(JSON.stringify({page:calls,page_count:2,results:[{id:`lead-${calls}`,url:`https://img.example/${calls}.png`,foreign_landing_url:`https://source.example/${calls}` }]}));};
 const found=await searchOriginalImageLeads({query:'notebook',read});assert.equal(found.complete,true);assert.equal(found.coverage.query,'notebook');assert.equal(found.coverage.pages.length,2);assert.equal(found.coverage.pages[0].reportedHasMore,true);assert.equal(found.coverage.pages[1].reportedHasMore,false);assert.equal(found.coverage.exhausted,'unknown');assert.equal(found.coverage.stop,'helper_reported_no_more');
});
