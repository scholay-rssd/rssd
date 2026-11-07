import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {enqueueTranslateContinuation,requireTranslateContract,translateDemandId,TRANSLATE_CONTRACT} from '../scripts/rssd-translate-continuation.mjs';
import {createTranslateCenterFixture,CLAIM_TTL_MS,CREATE_DEMAND_DESCRIPTION} from './fixtures/rssd-translate-center.mjs';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import {centerDesktopCall} from '../desktop/scripts/rssd-center.mjs';
import {centerCommand,CENTER_WORK_PRODUCER} from '../desktop/scripts/agent/headless/center.mjs';
import {produceCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';
import {CenterError,writeCenterJson} from '../scripts/rssd-center-client.mjs';

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
  assert.equal(reused.receipt.payload.source.revision,1);
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
  const sourceHash=created.sourceHash;
  center.bumpChinese(work.id);
  await assert.rejects(enqueueTranslateContinuation({client,workId:work.id,revision:1}),{code:'source_conflict'});
  await assert.rejects(enqueueTranslateContinuation({client,workId:work.id}),{code:'open_translate_conflict'});
  const open=[...center.demands.values()].filter(row=>row.payload?.source?.workId===work.id);
  assert.equal(open.length,1);assert.equal(open[0].id,created.id);
  assert.equal(open[0].payload.source.revision,1);assert.equal(open[0].payload.sourceHash,sourceHash);
  const listed={...client,request:async()=>({result:{tools:[{name:'rssd_claim'}]}})};
  await assert.rejects(enqueueTranslateContinuation({client:listed,workId:work.id}),{code:'contract_unavailable'});
});

test('contract probe refuses a namesake tool and a false translateContinuation flag',async()=>{
  const center=createTranslateCenterFixture();
  const work=center.addWork({id:'work-probe'});
  const client=center.client();
  const named={...client,request:async(path,options)=>{
    if(path==='/mcp')return {result:{tools:[{name:'rssd_create_demand',description:'Create one queued demand'}]}};
    return client.request(path,options);
  }};
  await assert.rejects(requireTranslateContract(named),{code:'contract_unavailable'});
  await assert.rejects(enqueueTranslateContinuation({client:named,workId:work.id}),{code:'contract_unavailable'});
  const denied=createTranslateCenterFixture({capabilities:{goalManagement:false,publicationScheduling:false,demandEditing:true,mcp:true,translateContinuation:false}}).client();
  await assert.rejects(requireTranslateContract(denied),{code:'contract_unavailable'});
  const granted=createTranslateCenterFixture({capabilities:{goalManagement:false,publicationScheduling:false,demandEditing:true,mcp:true,[TRANSLATE_CONTRACT.overviewCapability]:true}});
  const allowed=granted.addWork({id:'work-granted'});
  const created=await enqueueTranslateContinuation({client:granted.client(),workId:allowed.id});
  assert.equal(created.status,'created');
  assert.equal(CREATE_DEMAND_DESCRIPTION.includes('binds the source revision and hash'),true);
});

test('fixture unique-work constraint reuses one bind and conflicts after Chinese rev2',async()=>{
  const center=createTranslateCenterFixture();
  const work=center.addWork({id:'work-concurrent'});
  const input=()=>({id:randomUUID(),workspaceId:'enter',sectionId:'forums',kind:'translate',title:'并发',requiredLocales:['en'],source:{workId:work.id,locale:'zh-CN',revision:1}});
  const results=await Promise.allSettled(Array.from({length:8},()=>center.createDemand(input())));
  const ok=results.filter(row=>row.status==='fulfilled').map(row=>row.value);
  assert.equal(ok.length,8);assert.equal(new Set(ok.map(row=>row.id)).size,1);
  assert.equal(ok.filter(row=>row.status==='created').length,1);
  ok.filter(row=>row.status!=='created').forEach(row=>assert.equal(row.status,'existing'));
  const first=ok.find(row=>row.status==='created');
  center.bumpChinese(work.id);
  const moved=await Promise.allSettled(Array.from({length:6},()=>center.createDemand({...input(),source:{workId:work.id,locale:'zh-CN',revision:2}})));
  moved.forEach(row=>{assert.equal(row.status,'rejected');assert.equal(row.reason.code,'open_translate_conflict');});
  const open=[...center.demands.values()].filter(row=>row.kind==='translate'&&['queued','claimed','blocked'].includes(row.state)&&row.payload?.source?.workId===work.id);
  assert.equal(open.length,1);assert.equal(open[0].id,first.id);assert.equal(open[0].payload.source.revision,1);
});

test('center work is the Center ACP producer, not the website cloud translator',async()=>{
  assert.equal(CENTER_WORK_PRODUCER,produceCenterEdition);
  assert.equal(CENTER_WORK_PRODUCER.name,'produceCenterEdition');
  const src=await readFile(new URL('../desktop/scripts/agent/headless/center.mjs',import.meta.url),'utf8');
  assert.match(src,/producer:CENTER_WORK_PRODUCER/);
  assert.doesNotMatch(src,/SCHOLAY_CLOUD_EXECUTOR|publishing-flow|kickPublishingFlow|cloud-sync/);
});

test('the original executor claims once, submits only English, keeps the work identity and recovers a lost receipt',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-translate-exec-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const center=createTranslateCenterFixture();
  const work=center.addWork({id:'work-enter',sectionId:'software',title:'软件介绍'});
  const client=center.client();
  const produced=[];
  const recordedProducer=async input=>{
    produced.push({locale:input.locale,workId:input.workId,agentId:input.agentId,kind:input.claim.kind,sourceLocale:input.source.payload.locale,sourceRevision:input.source.revision});
    return producer(input);
  };
  const queued=await enqueueTranslateContinuation({client,workId:work.id});
  assert.equal(client.trace.some(row=>row.op==='claim'),false);
  const result=await runProductionTurn({client,home,agentId:'codex',workspaceIds:['enter'],sectionIds:['software'],demandId:queued.id,producer:recordedProducer});
  assert.equal(result.state,'accepted');assert.equal(result.workId,work.id);assert.equal(result.submissions.length,1);
  assert.deepEqual(produced,[{locale:'en',workId:work.id,agentId:'codex',kind:'translate',sourceLocale:'zh-CN',sourceRevision:1}]);
  assert.deepEqual(client.trace.filter(row=>row.op==='claim').map(row=>row.demandId),[queued.id]);
  const submitted=client.trace.filter(row=>row.op==='submit');
  assert.equal(submitted.length,1);assert.deepEqual(submitted[0].locales,['en']);
  assert.deepEqual(submitted[0].translationOf,{workId:work.id,locale:'zh-CN',revision:1});
  const packet=center.submissions.get(result.submissions[0].requestId);
  assert.equal(packet.result.editions[0].locale,'en');
  const current=await client.work(work.id);
  assert.equal(current.editions.find(e=>e.locale==='zh-CN').revision,1);
  assert.equal(current.editions.find(e=>e.locale==='en').revision,1);
  assert.equal(packet.result.workId,work.id);
  const receipts=client.trace.filter(row=>row.op==='receipt');
  assert.equal(receipts.length,1);assert.equal(receipts[0].status,'missing');
  assert.equal(packet.result.status,'accepted');
  const jobDirs=await readdir(join(home,'jobs'));assert.equal(jobDirs.length,1);
  const job=join(home,'jobs',jobDirs[0]);
  const claimOnDisk=JSON.parse(await readFile(join(job,'claim.json'),'utf8'));
  assert.equal(claimOnDisk.kind,'translate');assert.equal(claimOnDisk.id,queued.id);
  const resultOnDisk=JSON.parse(await readFile(join(job,'en.result.json'),'utf8'));
  assert.match(resultOnDisk.bodyMarkdown,/Complete English translation of work-enter/);
  const packetOnDisk=JSON.parse(await readFile(join(job,'en.packet.json'),'utf8'));
  assert.equal(packetOnDisk.editions.length,1);assert.equal(packetOnDisk.editions[0].locale,'en');
  assert.deepEqual(packetOnDisk.editions[0].translationOf,{workId:work.id,locale:'zh-CN',revision:1});
  const outboxFiles=(await readdir(join(home,'outbox'))).filter(name=>name.endsWith('.json'));
  assert.equal(outboxFiles.length,1);
  const outboxEntry=JSON.parse(await readFile(join(home,'outbox',outboxFiles[0]),'utf8'));
  assert.equal(outboxEntry.state,'accepted');assert.equal(outboxEntry.receipt.status,'accepted');
  assert.equal(outboxEntry.receipt.requestId,result.submissions[0].requestId);
  assert.equal(outboxEntry.packet.editions[0].locale,'en');
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
      if(request.method==='GET'&&url.pathname==='/api/rssd/v1/coordination/overview'){
        response.end(JSON.stringify(await fixtureClient.overview()));return;
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
      if(request.method==='GET'&&url.pathname==='/api/rssd/v1/coordination/overview'){response.end(JSON.stringify(await fixtureClient.overview()));return;}
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
