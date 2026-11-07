import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {enqueueTranslateContinuation,translateDemandId} from '../scripts/rssd-translate-continuation.mjs';
import {createTranslateCenterFixture,CLAIM_TTL_MS} from './fixtures/rssd-translate-center.mjs';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import {centerDesktopCall} from '../desktop/scripts/rssd-center.mjs';
import {centerCommand} from '../desktop/scripts/agent/headless/center.mjs';
import {CenterError,writeCenterJson} from '../scripts/rssd-center-client.mjs';
import protocol from '../contracts/rssd-v1.cjs';

const producer=async({locale,workId,source})=>{
  assert.equal(locale,'en');assert.equal(source.payload.locale,'zh-CN');
  return {title:'English',bodyMarkdown:'Complete English translation of '+workId};
};

test('enqueue binds the current Chinese hash, creates once, skips present English and never claims',async()=>{
  const center=createTranslateCenterFixture();
  const missing=center.addWork({id:'work-missing',title:'待补译'});
  const present=center.addWork({id:'work-present',title:'已有英文',locales:['zh-CN','en']});
  let claims=0;const client=center.client();const wrapped={...client,claim:async()=>{claims++;throw Error('enqueue must not claim');}};
  const created=await enqueueTranslateContinuation({client:wrapped,workId:missing.id});
  assert.equal(created.status,'created');assert.equal(created.workId,missing.id);assert.equal(created.source.revision,1);
  assert.equal(created.sourceHash,missing.editions.find(e=>e.locale==='zh-CN').hash);
  assert.equal(created.id,translateDemandId({workId:missing.id,revision:1}));
  assert.deepEqual(created.demand.requiredLocales,['en']);assert.equal(created.demand.kind,'translate');
  const reused=await enqueueTranslateContinuation({client:wrapped,workId:missing.id});
  assert.equal(reused.status,'existing');assert.equal(reused.id,created.id);assert.equal(reused.sourceHash,created.sourceHash);
  const skipped=await enqueueTranslateContinuation({client:wrapped,workId:present.id});
  assert.equal(skipped.status,'skipped');assert.equal(skipped.reason,'locale_present');assert.equal(skipped.workId,present.id);
  assert.equal(center.demands.size,1);assert.equal(claims,0);
});

test('enqueue refuses a stale revision, a second open bind after source change, and an undeployed contract',async()=>{
  const center=createTranslateCenterFixture();
  const work=center.addWork({id:'work-stale'});
  const client=center.client();
  await assert.rejects(enqueueTranslateContinuation({client,workId:work.id,revision:2}),{code:'source_conflict'});
  const created=await enqueueTranslateContinuation({client,workId:work.id});
  center.bumpChinese(work.id);
  await assert.rejects(enqueueTranslateContinuation({client,workId:work.id}),{code:'open_translate_conflict'});
  assert.equal(center.demands.get(created.id).payload.source.revision,1);
  const listed={...client,request:async()=>({result:{tools:[{name:'rssd_claim'}]}})};
  await assert.rejects(enqueueTranslateContinuation({client:listed,workId:work.id}),{code:'contract_unavailable'});
});

test('the original executor claims once, submits only English, keeps the work identity and recovers a lost receipt',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-translate-exec-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const center=createTranslateCenterFixture();
  const work=center.addWork({id:'work-enter',sectionId:'software',title:'软件介绍'});
  const client=center.client();
  const queued=await enqueueTranslateContinuation({client,workId:work.id});
  const result=await runProductionTurn({client,home,agentId:'example',workspaceIds:['enter'],sectionIds:['software'],demandId:queued.id,producer});
  assert.equal(result.state,'accepted');assert.equal(result.workId,work.id);assert.equal(result.submissions.length,1);
  const packet=center.submissions.get(result.submissions[0].requestId);
  assert.equal(packet.result.editions[0].locale,'en');
  const current=await client.work(work.id);
  assert.equal(current.editions.find(e=>e.locale==='zh-CN').revision,1);
  assert.equal(current.editions.find(e=>e.locale==='en').revision,1);
  assert.equal(packet.result.workId,work.id);
  const lostHome=await mkdtemp(join(tmpdir(),'rssd-translate-receipt-'));t.after(()=>rm(lostHome,{recursive:true,force:true}));
  const center2=createTranslateCenterFixture();
  const work2=center2.addWork({id:'work-receipt',sectionId:'forums'});
  const live=center2.client();
  const queued2=await enqueueTranslateContinuation({client:live,workId:work2.id});
  let posts=0;
  const flaky={...live,submit:async packet=>{posts++;if(posts===1){await live.submit(packet);throw new CenterError('Response lost');}return live.submit(packet);}};
  const recovered=await runProductionTurn({client:flaky,home:lostHome,agentId:'example',workspaceIds:['enter'],sectionIds:['forums'],demandId:queued2.id,producer});
  assert.equal(recovered.state,'accepted');assert.equal(posts,1);
  const again=await live.submission(recovered.submissions[0].requestId);
  assert.equal(again.status,'accepted');assert.equal(again.workId,work2.id);assert.equal(again.requestId,recovered.submissions[0].requestId);
  const replay=await runProductionTurn({client:flaky,home:lostHome,agentId:'example',workspaceIds:['enter'],sectionIds:['forums'],demandId:queued2.id,producer:async()=>{throw Error('must not regenerate after a retained receipt');}});
  assert.equal(posts,1);assert.equal(replay.state,'idle');
});

test('claim conflicts refuse stealing, expired claims can be recovered, and a source change rejects submit then stays retryable',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-translate-claim-'));t.after(()=>rm(home,{recursive:true,force:true}));
  let clock=1_700_000_000_000;
  const center=createTranslateCenterFixture({now:()=>clock});
  const work=center.addWork({id:'work-claim'});
  const owner=center.client('worker-a'),other=center.client('worker-b');
  const queued=await enqueueTranslateContinuation({client:owner,workId:work.id});
  const claimed=await owner.claim({demandId:queued.id,workspaceIds:['enter']});
  await assert.rejects(other.claim({demandId:queued.id,workspaceIds:['enter']}),{code:'claim_conflict'});
  await assert.rejects(runProductionTurn({client:other,home,agentId:'example',workspaceIds:['enter'],demandId:queued.id,producer:async()=>{throw Error('must not produce');}}),{code:'claim_conflict'});
  clock+=CLAIM_TTL_MS+1000;
  assert.equal(await owner.activeClaim(),null);
  const successorHome=await mkdtemp(join(tmpdir(),'rssd-translate-expired-'));t.after(()=>rm(successorHome,{recursive:true,force:true}));
  const done=await runProductionTurn({client:other,home:successorHome,agentId:'example',workspaceIds:['enter'],demandId:queued.id,producer});
  assert.equal(done.state,'accepted');assert.equal(done.workId,work.id);
  assert.equal((await other.work(work.id)).editions.some(edition=>edition.locale==='en'),true);
  await assert.rejects(owner.submit({requestId:'stale-token',workId:work.id,workspaceId:'enter',sectionId:'forums',demandId:queued.id,claimToken:claimed.claimToken,baseRevisions:{en:0},editions:[{locale:'en',title:'Stolen',bodyMarkdown:'Must not publish with an expired token.',translationOf:{workId:work.id,locale:'zh-CN',revision:1}}]}),{code:'claim_revoked'});
  const stale=center.addWork({id:'work-changed'});
  const staleHome=await mkdtemp(join(tmpdir(),'rssd-translate-stale-'));t.after(()=>rm(staleHome,{recursive:true,force:true}));
  const staleClient=center.client('worker-c');
  const staleDemand=await enqueueTranslateContinuation({client:staleClient,workId:stale.id});
  await staleClient.claim({demandId:staleDemand.id,workspaceIds:['enter']});
  center.bumpChinese(stale.id);
  await assert.rejects(runProductionTurn({client:staleClient,home:staleHome,agentId:'example',workspaceIds:['enter'],resume:true,producer:async()=>{throw Error('must not translate a moved source');}}),{code:'source_conflict'});
  assert.equal((await staleClient.work(stale.id)).editions.find(e=>e.locale==='zh-CN').revision,2);
  assert.equal((await staleClient.work(stale.id)).editions.some(e=>e.locale==='en'),false);
});

test('desktop enqueue_translate uses HTTP and keeps the metho write fence',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-desktop-translate-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const center=createTranslateCenterFixture();
  const work=center.addWork({id:'work-desktop',title:'桌面补译'});
  const fixtureClient=center.client();
  const token='rssd_device_'+'a'.repeat(48);
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    let body='';if(request.method!=='GET')for await(const chunk of request)body+=chunk;
    const payload=body?JSON.parse(body):undefined;
    response.setHeader('Content-Type','application/json');
    try{
      if(url.pathname==='/api/rssd/v1/mcp'){
        const listed=await fixtureClient.request('/mcp',{method:'POST',body:payload});
        response.end(JSON.stringify(listed));return;
      }
      if(request.method==='GET'&&url.pathname.startsWith('/api/rssd/v1/works/')){
        response.end(JSON.stringify(await fixtureClient.work(decodeURIComponent(url.pathname.split('/').pop()))));return;
      }
      if(request.method==='GET'&&url.pathname==='/api/rssd/v1/demands'){
        response.end(JSON.stringify(await fixtureClient.demands({workspaceId:url.searchParams.get('workspaceId'),limit:Number(url.searchParams.get('limit')||100),offset:Number(url.searchParams.get('offset')||0)})));return;
      }
      if(request.method==='POST'&&url.pathname==='/api/rssd/v1/demands'){
        response.end(JSON.stringify(await fixtureClient.createDemand(payload)));return;
      }
      if(request.method==='POST'&&url.pathname==='/api/rssd/v1/claims'){
        response.statusCode=500;response.end(JSON.stringify({message:'desktop enqueue must not claim'}));return;
      }
      response.statusCode=404;response.end(JSON.stringify({message:'not found'}));
    }catch(error){response.statusCode=error.status||400;response.end(JSON.stringify({message:error.message,code:error.code}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await writeCenterJson(join(home,'connection.json'),{origin:'http://127.0.0.1:'+server.address().port,token,identity:{orgId:'example',workerId:'device'}});
  const result=await centerDesktopCall('enqueue_translate',{workId:work.id},home);
  assert.equal(result.status,'created');assert.equal(result.workId,work.id);assert.equal(result.sourceHash,work.editions[0].hash);
  await assert.rejects(centerDesktopCall('create_demand',{id:'topic-x',workspaceId:'metho',sectionId:'methods',kind:'translate',title:'补译',brief:'x',requiredLocales:['en'],source:{workId:work.id,locale:'zh-CN',revision:1}},home));
});

test('headless enqueue-translate writes JSON and does not start work',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-headless-translate-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const previous=process.env.RSSD_CENTER_HOME;process.env.RSSD_CENTER_HOME=home;
  t.after(()=>{if(previous===undefined)delete process.env.RSSD_CENTER_HOME;else process.env.RSSD_CENTER_HOME=previous;});
  const center=createTranslateCenterFixture();
  const work=center.addWork({id:'work-headless'});
  const fixtureClient=center.client();
  const token='rssd_device_'+'b'.repeat(48);
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    let body='';if(request.method!=='GET')for await(const chunk of request)body+=chunk;
    const payload=body?JSON.parse(body):undefined;
    response.setHeader('Content-Type','application/json');
    try{
      if(url.pathname==='/api/rssd/v1/mcp'){response.end(JSON.stringify(await fixtureClient.request('/mcp',{method:'POST',body:payload})));return;}
      if(request.method==='GET'&&url.pathname.startsWith('/api/rssd/v1/works/')){response.end(JSON.stringify(await fixtureClient.work(decodeURIComponent(url.pathname.split('/').pop()))));return;}
      if(request.method==='GET'&&url.pathname==='/api/rssd/v1/demands'){response.end(JSON.stringify(await fixtureClient.demands({workspaceId:url.searchParams.get('workspaceId')})));return;}
      if(request.method==='POST'&&url.pathname==='/api/rssd/v1/demands'){response.end(JSON.stringify(await fixtureClient.createDemand(payload)));return;}
      response.statusCode=404;response.end(JSON.stringify({message:'not found'}));
    }catch(error){response.statusCode=error.status||400;response.end(JSON.stringify({message:error.message,code:error.code}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await writeCenterJson(join(home,'connection.json'),{origin:'http://127.0.0.1:'+server.address().port,token,identity:{orgId:'example',workerId:'device'}});
  const emitted=[];
  const result=await centerCommand(['enqueue-translate','--work',work.id],{emit:value=>emitted.push(value)});
  assert.equal(result.status,'created');assert.equal(result.workId,work.id);assert.equal(emitted[0].status,'created');
  assert.equal(center.demands.size,1);assert.equal([...center.demands.values()][0].state,'queued');
});
