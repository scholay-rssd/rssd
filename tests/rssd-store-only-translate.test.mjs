import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ARTICLE_WRITING_POLICY} from '../contracts/article-writing-policy.mjs';
import {
  enqueueStoreOnlyTranslate,enqueueTranslateContinuation,requireStoreOnlyContract,STORE_ONLY_CONTRACT,
  storeOnlyClaimBody,storeOnlyTranslateContract,supportsStoreOnlyTranslate,translateContinuationContract,
} from '../scripts/rssd-translate-continuation.mjs';
import {createTranslateCenterFixture,CLAIM_TTL_MS} from './fixtures/rssd-translate-center.mjs';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import {centerDesktopCall} from '../desktop/scripts/rssd-center.mjs';
import {centerCommand,CENTER_WORK_PRODUCER} from '../desktop/scripts/agent/headless/center.mjs';
import {produceCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';
import {CenterError,CenterOutbox,writeCenterJson} from '../scripts/rssd-center-client.mjs';
import protocol from '../contracts/rssd-v1.cjs';

const bothContracts={translateContinuation:translateContinuationContract(),storeOnlyTranslate:storeOnlyTranslateContract()};
const storeCenter=(opts={})=>createTranslateCenterFixture({contracts:bothContracts,...opts});
const producer=async({locale,workId,source,writingPolicy})=>{
  assert.equal(locale,'en');assert.equal(source.payload.locale,'zh-CN');
  assert.equal(writingPolicy.version,ARTICLE_WRITING_POLICY);
  return {title:'English store-only',bodyMarkdown:'Complete English translation of '+workId};
};

function chinese(work){return work.editions.find(row=>row.locale==='zh-CN');}

const LEGACY_NINE=['storeOnlyFrozen','zeroPublications','exclusiveWorkerClaim','intentRequired','noClaimSteal','leaseRecovery','englishOnly','sourceBind','receipt'];

test('storeOnlyTranslate probe is fail-closed; the old nine-token pack is refused',async()=>{
  assert.deepEqual(storeOnlyTranslateContract(),{version:1,guarantees:[...STORE_ONLY_CONTRACT.guarantees]});
  assert.equal(STORE_ONLY_CONTRACT.guarantees.length,11);
  assert.equal(STORE_ONLY_CONTRACT.centerHead,'f38d8e6b98393265ee9306902ec4c91404c363a8');
  assert.ok(STORE_ONLY_CONTRACT.guarantees.includes('receiptIsolation'));
  assert.ok(STORE_ONLY_CONTRACT.guarantees.includes('openWorkFence'));
  const allowed=storeCenter();
  const work=allowed.addWork({id:'work-granted-store'});
  assert.equal(supportsStoreOnlyTranslate(await allowed.client().overview()),true);
  assert.equal((await allowed.client().overview()).capabilities.publicationScheduling,false);
  const created=await enqueueStoreOnlyTranslate({client:allowed.client(),workId:work.id});
  assert.equal(created.status,'created');assert.equal(created.storeOnly,true);
  const refuse=async contracts=>{
    const center=createTranslateCenterFixture({contracts});
    const row=center.addWork({id:'work-probe-store'});
    await assert.rejects(requireStoreOnlyContract(center.client()),{code:'contract_unavailable'});
    await assert.rejects(enqueueStoreOnlyTranslate({client:center.client(),workId:row.id}),{code:'contract_unavailable'});
  };
  await refuse({translateContinuation:translateContinuationContract()});
  await refuse({storeOnlyTranslate:true,translateContinuation:translateContinuationContract()});
  await refuse({storeOnlyTranslate:{version:0,guarantees:[...STORE_ONLY_CONTRACT.guarantees]}});
  await refuse({storeOnlyTranslate:{version:'1',guarantees:[...STORE_ONLY_CONTRACT.guarantees]}});
  await refuse({storeOnlyTranslate:{version:1}});
  await refuse({storeOnlyTranslate:{version:1,guarantees:LEGACY_NINE}});
  await refuse({storeOnlyTranslate:{version:1,guarantees:STORE_ONLY_CONTRACT.guarantees.filter(token=>token!=='receiptIsolation')}});
  await refuse({storeOnlyTranslate:{version:1,guarantees:STORE_ONLY_CONTRACT.guarantees.filter(token=>token!=='openWorkFence')}});
  const toolOnly={...allowed.client(),overview:async()=>({contractVersion:1,capabilities:{mcp:true,publicationScheduling:false},contracts:{translateContinuation:translateContinuationContract()}})};
  await assert.rejects(enqueueStoreOnlyTranslate({client:toolOnly,workId:work.id}),{code:'contract_unavailable'});
});

test('store-en freezes the creating device, reuses the same bind, and never claims',async()=>{
  const center=storeCenter();
  const work=center.addWork({id:'work-store-create',title:'待存英文'});
  const owner=center.client('device-a');
  const other=center.client('device-b');
  let claims=0;const wrapped={...owner,claim:async()=>{claims++;throw Error('store-en must not claim');}};
  const created=await enqueueStoreOnlyTranslate({client:wrapped,workId:work.id});
  assert.equal(created.status,'created');assert.equal(created.storeOnly,true);assert.equal(created.storeOnlyWorkerId,'device-a');
  assert.equal(created.demand.storeOnly,true);assert.equal(created.demand.kind,'translate');
  assert.deepEqual(created.demand.requiredLocales,['en']);
  assert.equal(created.receipt.payload.storeOnly,true);assert.equal(created.receipt.payload.storeOnlyWorkerId,'device-a');
  const reused=await enqueueStoreOnlyTranslate({client:wrapped,workId:work.id});
  assert.equal(reused.status,'existing');assert.equal(reused.id,created.id);
  await assert.rejects(enqueueStoreOnlyTranslate({client:other,workId:work.id}),{code:'open_translate_conflict'});
  await assert.rejects(center.ownerClient().createDemand({...created.demand,storeOnly:true}),{code:'forbidden'});
  await assert.rejects(owner.createDemand({...created.demand,storeOnly:'true'}),{code:'invalid_request'});
  assert.throws(()=>center.editDemand(created.id,{storeOnly:false}),{code:'identity_conflict'});
  assert.equal(center.demands.size,1);assert.equal(claims,0);
  assert.equal(owner.trace.some(row=>row.op==='claim'),false);
});

test('store-only turn claims with storeOnly:true, submits EN only, keeps Chinese and writing-policy, and records zero publications with dispatch on',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-store-en-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const center=storeCenter({dispatchEnabled:true});
  const work=center.addWork({id:'work-store-run',sectionId:'software',title:'软件介绍'});
  const zh=chinese(work);
  const client=center.client('device-a');
  const queued=await enqueueStoreOnlyTranslate({client,workId:work.id});
  assert.equal(CENTER_WORK_PRODUCER,produceCenterEdition);
  const result=await runProductionTurn({client,home,agentId:'codex',workspaceIds:['enter'],sectionIds:['software'],demandId:queued.id,storeOnly:true,producer});
  assert.equal(result.state,'accepted');assert.equal(result.workId,work.id);
  assert.equal(result.submissions.length,1);
  const receipt=result.submissions[0].receipt;
  assert.equal(receipt.storeOnly,true);assert.equal(receipt.storeOnlyWorkerId,'device-a');
  assert.deepEqual(receipt.publicationIds,[]);assert.equal(receipt.demandState,'completed');
  assert.equal(receipt.requestId,result.submissions[0].requestId);
  const claimed=client.trace.filter(row=>row.op==='claim');
  assert.deepEqual(claimed,[{op:'claim',demandId:queued.id,storeOnly:true}]);
  const submitted=client.trace.filter(row=>row.op==='submit');
  assert.equal(submitted.length,1);assert.deepEqual(submitted[0].locales,['en']);assert.equal(submitted[0].storeOnly,true);
  const live=await client.work(work.id);
  const liveZh=chinese(live);
  assert.equal(liveZh.revision,zh.revision);assert.equal(liveZh.hash,zh.hash);
  assert.equal(live.editions.find(row=>row.locale==='en').revision,1);
  assert.equal(center.publications.length,0);
  assert.equal(await client.dispatchTick(),null);
  const jobDirs=await readdir(join(home,'jobs'));
  const packet=JSON.parse(await readFile(join(home,'jobs',jobDirs[0],'en.packet.json'),'utf8'));
  assert.equal(packet.editions.length,1);assert.equal(packet.editions[0].locale,'en');
  assert.deepEqual(packet.editions[0].translationOf,{workId:work.id,locale:'zh-CN',revision:1});
  const outbox=JSON.parse(await readFile(join(home,'outbox',(await readdir(join(home,'outbox'))).find(name=>name.endsWith('.json'))),'utf8'));
  assert.equal(outbox.storeOnly,true);assert.equal(outbox.state,'accepted');assert.equal(outbox.receipt.storeOnly,true);
});

test('old consumers cannot take a higher-priority store-only row; default publish still enqueues',async()=>{
  const center=storeCenter({dispatchEnabled:true});
  const storeWork=center.addWork({id:'work-store-priority',sectionId:'forums'});
  const decoy=center.addWork({id:'work-decoy-write',sectionId:'forums'});
  const creator=center.client('device-a');
  const queued=await enqueueStoreOnlyTranslate({client:creator,workId:storeWork.id});
  const ordinary=await decoyWrite(center,'worker-decoy',decoy);
  assert.ok((center.demands.get(queued.id).priority||0)>(center.demands.get(ordinary.id).priority||0));
  const steal=await Promise.allSettled(Array.from({length:6},(_,i)=>center.client('old-'+i).claim({workspaceIds:['enter']})));
  const won=steal.filter(row=>row.status==='fulfilled'&&row.value);
  assert.equal(won.length,1);assert.equal(won[0].value.id,ordinary.id);assert.notEqual(won[0].value.id,queued.id);
  steal.filter(row=>row.status==='rejected').forEach(row=>assert.equal(row.reason.code,'worker_busy'));
  await assert.rejects(center.client('generic-target').claim({demandId:queued.id,workspaceIds:['enter']}),{code:'store_only_required'});
  await assert.rejects(center.client('other-device').claim({demandId:queued.id,workspaceIds:['enter'],storeOnly:true}),{code:'forbidden'});
  await assert.rejects(center.client('generic-target').claim(storeOnlyClaimBody({demandId:ordinary.id,workspaceIds:['enter']})),{code:'not_store_only'});
  const claimed=await creator.claim(storeOnlyClaimBody({demandId:queued.id,workspaceIds:['enter']}));
  assert.equal(claimed.payload.storeOnly,true);
  assert.ok(claimed.payload.destinations.some(row=>row.kind==='postiz'&&row.locale==='en'));
  const defaultClient=center.client('publisher');
  const publishWork=center.addWork({id:'work-default-publish'});
  await assert.rejects(enqueueTranslateContinuation({client:defaultClient,workId:storeWork.id}),{code:'open_translate_conflict'});
  const defaultQueued=await enqueueTranslateContinuation({client:defaultClient,workId:publishWork.id});
  assert.equal(defaultQueued.demand.storeOnly,undefined);
  const homePacket=protocol.submission({
    requestId:'req-default-publish',workId:publishWork.id,workspaceId:'enter',sectionId:'forums',
    demandId:defaultQueued.id,claimToken:(await defaultClient.claim({demandId:defaultQueued.id,workspaceIds:['enter']})).claimToken,
    baseRevisions:{en:0},editions:[{locale:'en',title:'Published',bodyMarkdown:'Default path may publish.',translationOf:{workId:publishWork.id,locale:'zh-CN',revision:1}}],
  });
  const published=await defaultClient.submit(homePacket);
  assert.ok(published.publicationIds.length>=1);assert.notEqual(published.storeOnly,true);
  assert.equal((await defaultClient.dispatchTick())?.state,'sent');
});

test('store-only lease expiry restores only the creating device and rejects the expired token',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-store-lease-'));t.after(()=>rm(home,{recursive:true,force:true}));
  let clock=1_700_000_000_000;
  const center=storeCenter({now:()=>clock});
  const work=center.addWork({id:'work-store-lease'});
  const owner=center.client('device-a'),other=center.client('device-b');
  const queued=await enqueueStoreOnlyTranslate({client:owner,workId:work.id});
  const claimed=await owner.claim(storeOnlyClaimBody({demandId:queued.id,workspaceIds:['enter']}));
  clock+=CLAIM_TTL_MS+1000;
  assert.equal(await owner.activeClaim(),null);
  await assert.rejects(other.claim(storeOnlyClaimBody({demandId:queued.id,workspaceIds:['enter']})),{code:'forbidden'});
  const successor=await runProductionTurn({client:owner,home,agentId:'codex',workspaceIds:['enter'],demandId:queued.id,storeOnly:true,producer});
  assert.equal(successor.state,'accepted');assert.equal(successor.submissions[0].receipt.storeOnly,true);
  await assert.rejects(owner.submit({
    requestId:'stale-store-token',workId:work.id,workspaceId:'enter',sectionId:'forums',demandId:queued.id,claimToken:claimed.claimToken,
    baseRevisions:{en:0},editions:[{locale:'en',title:'Stolen',bodyMarkdown:'Must not publish with an expired token.',translationOf:{workId:work.id,locale:'zh-CN',revision:1}}],
  }),{code:'claim_revoked'});
});

test('omitted store-only flags, tampered receipts, and missing contract do not count as success',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-store-fail-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const center=storeCenter();
  const work=center.addWork({id:'work-store-fail'});
  const client=center.client('device-a');
  const queued=await enqueueStoreOnlyTranslate({client,workId:work.id});
  await assert.rejects(runProductionTurn({client,home,agentId:'codex',workspaceIds:['enter'],storeOnly:true,producer}),{code:'store_only_required'});
  await assert.rejects(runProductionTurn({client,home,agentId:'codex',workspaceIds:['enter'],demandId:queued.id,producer:async()=>{throw Error('must not produce');}}),{code:'store_only_required'});
  const lying={...client,submit:async packet=>{
    const real=await client.submit(packet);
    return {...real,storeOnly:true,storeOnlyWorkerId:'device-other',publicationIds:[]};
  }};
  await assert.rejects(runProductionTurn({client:lying,home,agentId:'codex',workspaceIds:['enter'],demandId:queued.id,storeOnly:true,producer}),{code:'not_store_only'});
  const boxed=new CenterOutbox({directory:join(home,'outbox-missing'),client:{...client,overview:async()=>({contracts:{translateContinuation:translateContinuationContract()}})}});
  const packet=protocol.submission({
    requestId:'req-store-recover',workId:work.id,workspaceId:'enter',sectionId:'forums',demandId:queued.id,claimToken:'unused',
    baseRevisions:{en:0},editions:[{locale:'en',title:'English',bodyMarkdown:'Body',translationOf:{workId:work.id,locale:'zh-CN',revision:1}}],
  });
  await boxed.enqueue(packet,{storeOnly:true});
  const blocked=await boxed.flushOne('req-store-recover');
  assert.equal(blocked.state,'needs_attention');assert.equal(blocked.error.code,'contract_unavailable');
  assert.notEqual(blocked.state,'accepted');
});

test('lost store-only submit keeps the same requestId and intent; ordinary outbox still publishes',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-store-retry-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const center=storeCenter();
  const work=center.addWork({id:'work-store-retry'});
  const live=center.client('device-a');
  const queued=await enqueueStoreOnlyTranslate({client:live,workId:work.id});
  let posts=0;
  const flaky={...live,submit:async packet=>{posts++;if(posts===1){await live.submit(packet);throw new CenterError('Response lost');}return live.submit(packet);}};
  const recovered=await runProductionTurn({client:flaky,home,agentId:'codex',workspaceIds:['enter'],demandId:queued.id,storeOnly:true,producer});
  assert.equal(recovered.state,'accepted');assert.equal(posts,1);
  assert.equal(recovered.submissions[0].receipt.storeOnly,true);
  const again=await live.submission(recovered.submissions[0].requestId);
  assert.equal(again.requestId,recovered.submissions[0].requestId);assert.equal(again.storeOnly,true);
  assert.equal(again.storeOnlyWorkerId,'device-a');assert.deepEqual(again.publicationIds,[]);
  const replay=await runProductionTurn({client:flaky,home,agentId:'codex',workspaceIds:['enter'],demandId:queued.id,storeOnly:true,producer:async()=>{throw Error('must not regenerate');}});
  assert.equal(posts,1);assert.equal(replay.state,'idle');
  const ordinaryHome=await mkdtemp(join(tmpdir(),'rssd-ordinary-outbox-'));t.after(()=>rm(ordinaryHome,{recursive:true,force:true}));
  const publishWork=center.addWork({id:'work-ordinary-outbox'});
  const publisher=center.client('publisher-b');
  const ordinary=await enqueueTranslateContinuation({client:publisher,workId:publishWork.id});
  const ordinaryResult=await runProductionTurn({client:publisher,home:ordinaryHome,agentId:'codex',workspaceIds:['enter'],demandId:ordinary.id,producer});
  assert.equal(ordinaryResult.state,'accepted');
  assert.ok(ordinaryResult.submissions[0].receipt.publicationIds.length>=1);
  assert.notEqual(ordinaryResult.submissions[0].receipt.storeOnly,true);
});

test('store-only submit refuses later Chinese movement without rewriting zh-CN',async()=>{
  const center=storeCenter();
  const work=center.addWork({id:'work-store-source'});
  const zh=chinese(work);
  const client=center.client('device-a');
  const queued=await enqueueStoreOnlyTranslate({client,workId:work.id});
  const claimed=await client.claim(storeOnlyClaimBody({demandId:queued.id,workspaceIds:['enter']}));
  center.bumpChinese(work.id,'中文已更新，不得被英译覆盖。');
  await assert.rejects(client.submit(protocol.submission({
    requestId:'req-moved-zh',workId:work.id,workspaceId:'enter',sectionId:'forums',demandId:queued.id,claimToken:claimed.claimToken,
    baseRevisions:{en:0},editions:[{locale:'en',title:'English',bodyMarkdown:'Must not overwrite Chinese.',translationOf:{workId:work.id,locale:'zh-CN',revision:1}}],
  })),{code:'source_conflict'});
  const liveZh=chinese(await client.work(work.id));
  assert.equal(liveZh.revision,zh.revision+1);assert.notEqual(liveZh.hash,zh.hash);
  assert.equal(liveZh.payload.bodyMarkdown.includes('中文已更新'),true);
  assert.equal((await client.work(work.id)).editions.some(row=>row.locale==='en'),false);
});

test('ordinary and store-only existing never cross intents; same id is conflict not existing',async()=>{
  const center=storeCenter();
  const work=center.addWork({id:'work-intent-fence'});
  const device=center.client('device-a');
  const stored=await enqueueStoreOnlyTranslate({client:device,workId:work.id});
  await assert.rejects(enqueueTranslateContinuation({client:device,workId:work.id}),{code:'open_translate_conflict'});
  await assert.rejects(device.createDemand({...stored.demand,storeOnly:false}),{code:'open_translate_conflict'});
  const other=center.addWork({id:'work-ordinary-first'});
  const ordinary=await enqueueTranslateContinuation({client:device,workId:other.id});
  await assert.rejects(enqueueStoreOnlyTranslate({client:device,workId:other.id}),{code:'open_translate_conflict'});
  await assert.rejects(device.createDemand({...ordinary.demand,id:ordinary.id,storeOnly:true}),{code:'open_translate_conflict'});
});

test('store-only receipt isolation hides requestId from other devices; open fence blocks bypass drafts and submits',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-store-iso-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const center=storeCenter();
  const work=center.addWork({id:'work-store-iso'});
  const owner=center.client('device-a'),other=center.client('device-b');
  const queued=await enqueueStoreOnlyTranslate({client:owner,workId:work.id});
  const bypass=protocol.submission({
    requestId:'req-bypass-store',workId:work.id,workspaceId:'enter',sectionId:'forums',
    baseRevisions:{en:0},editions:[{locale:'en',title:'Bypass',bodyMarkdown:'Must not write around store-only.',translationOf:{workId:work.id,locale:'zh-CN',revision:1}}],
  });
  await assert.rejects(other.submit(bypass),{code:'store_only_conflict'});
  await assert.rejects(other.draft(bypass),{code:'store_only_conflict'});
  await assert.rejects(owner.submit(bypass),{code:'store_only_conflict'});
  const result=await runProductionTurn({client:owner,home,agentId:'codex',workspaceIds:['enter'],demandId:queued.id,storeOnly:true,producer});
  assert.equal(result.state,'accepted');
  const requestId=result.submissions[0].requestId;
  await assert.rejects(other.submission(requestId),{status:404,code:'not_found'});
  await assert.rejects(other.submit({
    requestId,workId:work.id,workspaceId:'enter',sectionId:'forums',
    baseRevisions:{en:0},editions:[{locale:'en',title:'Leak',bodyMarkdown:'Must not replay another device receipt.',translationOf:{workId:work.id,locale:'zh-CN',revision:1}}],
  }),{status:404,code:'not_found'});
  const replay=await owner.submission(requestId);
  assert.equal(replay.storeOnly,true);assert.equal(replay.storeOnlyWorkerId,'device-a');assert.deepEqual(replay.publicationIds,[]);
});

test('headless store-en and desktop store_en write JSON without starting work or falling back to enqueue-translate',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-store-cli-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const previous=process.env.RSSD_CENTER_HOME;process.env.RSSD_CENTER_HOME=home;
  t.after(()=>{if(previous===undefined)delete process.env.RSSD_CENTER_HOME;else process.env.RSSD_CENTER_HOME=previous;});
  const center=storeCenter();
  const work=center.addWork({id:'work-store-cli'});
  const fixtureClient=center.client('device-a');
  const token='rssd_device_'+'c'.repeat(48);
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    let body='';if(request.method!=='GET')for await(const chunk of request)body+=chunk;
    const payload=body?JSON.parse(body):undefined;
    response.setHeader('Content-Type','application/json');
    try{
      if(request.method==='GET'&&url.pathname==='/api/rssd/v1/coordination/overview'){response.end(JSON.stringify(await fixtureClient.overview()));return;}
      if(request.method==='GET'&&url.pathname.startsWith('/api/rssd/v1/works/')){response.end(JSON.stringify(await fixtureClient.work(decodeURIComponent(url.pathname.split('/').pop()))));return;}
      if(request.method==='GET'&&url.pathname==='/api/rssd/v1/demands'){response.end(JSON.stringify(await fixtureClient.demands({workspaceId:url.searchParams.get('workspaceId')})));return;}
      if(request.method==='POST'&&url.pathname==='/api/rssd/v1/demands'){response.end(JSON.stringify(await fixtureClient.createDemand(payload)));return;}
      if(request.method==='POST'&&url.pathname==='/api/rssd/v1/claims'){response.statusCode=500;response.end(JSON.stringify({message:'store-en must not claim'}));return;}
      response.statusCode=404;response.end(JSON.stringify({message:'not found'}));
    }catch(error){response.statusCode=error.status||400;response.end(JSON.stringify({message:error.message,code:error.code}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await writeCenterJson(join(home,'connection.json'),{origin:'http://127.0.0.1:'+server.address().port,token,identity:{orgId:'example',workerId:'device-a'}});
  await assert.rejects(centerCommand(['enqueue-translate','--store-only','--work',work.id]),/store-en/);
  const emitted=[];
  const result=await centerCommand(['store-en','--work',work.id],{emit:value=>emitted.push(value)});
  assert.equal(result.status,'created');assert.equal(result.storeOnly,true);assert.equal(emitted[0].storeOnly,true);
  const desktop=await centerDesktopCall('store_en',{workId:work.id},home);
  assert.equal(desktop.status,'existing');assert.equal(desktop.storeOnly,true);
  await assert.rejects(centerDesktopCall('enqueue_translate',{workId:work.id,storeOnly:true},home),/store_en/);
});

async function decoyWrite(center,workerId,work){
  const client=center.client(workerId);
  return client.createDemand({
    id:'write-'+work.id,workspaceId:work.workspaceId,sectionId:work.sectionId,kind:'write',title:'Decoy write',
    requiredLocales:['zh-CN'],source:{workId:work.id,locale:'zh-CN',revision:1},priority:0,
  });
}
