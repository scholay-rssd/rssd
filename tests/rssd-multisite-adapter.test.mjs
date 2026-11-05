import test from 'node:test';
import assert from 'node:assert/strict';
import {createMultisiteCenterAdapter,createMigrationProofAdapter} from '../scripts/rssd-multisite-adapter.mjs';
import {createConfiguredTopicAdapters} from '../scripts/rssd-multisite-runtime.mjs';
import {configuredSourceRuntime,validateSourceRuntimeConfiguration} from '../scripts/rssd-source-runtime-config.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const now=Date.parse('2026-11-02T00:00:00Z');
const slot={id:'slot-one',siteId:'enter',workspaceId:'enter',sectionId:'forums',destinationId:'site-enter',requiredLocales:['zh-CN','en'],contentMode:'opensource',requireFlow:true,editorialRules:['核对官方仓库及许可证']};
function fixture(){
 const calls=[],demands=[],works=[],profile={id:'enter',spaceId:'enter',origin:'https://enter.example'},targets=slot.requiredLocales.map(locale=>({locale,destinationId:slot.destinationId}));
 const workspace={id:'enter',siteId:'enter',migrationState:'active',writable:true,sections:[{id:'forums',policy:{targets}}]};
 const destination={id:'site-enter',kind:'site',enabled:true,workspaceIds:['enter'],origin:'https://enter.example'};
 const client={origin:'https://center.example',request:async(path,options={})=>{calls.push({path,method:options.method||'GET',body:options.body});
  if(path==='/identity')return {protocolVersion:1,orgId:'org-one',workerId:'device-one',workspaceIds:['enter']};
  if(path==='/registry')return {workspaces:[workspace]};
  if(path.startsWith('/coordination/channels?'))return {destinations:[destination]};
  if(path.startsWith('/demands?'))return demands;
  if(path.startsWith('/works?'))return works;
  if(path==='/demands'&&options.method==='POST'){const row={id:options.body.id,workspaceId:options.body.workspaceId,title:options.body.title,payload:options.body,state:'queued'};demands.push(row);return row;}
  throw Error('unexpected path');}};
 const proof={siteId:'enter',workspaceId:'enter',runId:'run-one',baselineSha256:'a'.repeat(64),artifactManifestSha256:'b'.repeat(64),artifactRevision:'release-one',oldWriterStopped:true,contentFenceReadOnly:true,queueDrained:true,inFlight:0,exclusiveWriter:true,observedAt:new Date(now).toISOString()};
 const migration={siteId:'enter',workspaceId:'enter',state:'active',runId:'run-one',receiptId:'run-one:enter',baselineSha256:'a'.repeat(64),evidenceHash:'c'.repeat(64),receiverRelease:'release-one',observedAt:new Date(now).toISOString()};
 const catalog={siteId:'enter',workspaceId:'enter',origin:'https://enter.example',complete:true,fetchedAt:new Date(now).toISOString(),titles:['Existing different subject']};
 const lead={title:'Source',url:'https://source.example/article'};
 const input={client,connection:{origin:'https://center.example',orgId:'org-one',workerId:'device-one'},profiles:[profile],clock:()=>now,writerProof:async()=>proof,migrationProof:async()=>migration,publicCatalog:async()=>catalog,
  sourceLeads:async()=>({siteId:'enter',sectionId:'forums',leads:[lead]}),generate:async()=>({title:'A new subject',brief:'Explain the actual method',sources:[lead]}),judge:async()=>({duplicate:false,confidence:'high'}),verifySource:async({source})=>({url:source.url,verified:true,supportsTopic:true,excerpt:'Evidence '.repeat(20)})};
 return {input,calls,demands,works,workspace,destination,proof,migration,catalog,lead};
}

test('migration proof uses a scoped authenticated read and respects cancellation',async()=>{
 const calls=[],client={request:async(path,options)=>{calls.push({path,options});return {state:'active'};}},read=createMigrationProofAdapter({client});
 assert.equal((await read({slot})).state,'active');assert.equal(calls[0].path,'/migration-proof/enter/enter');assert.equal(calls[0].options.method,undefined);
 const controller=new AbortController();controller.abort();await assert.rejects(read({slot,signal:controller.signal}),{name:'AbortError'});assert.equal(calls.length,1);
});

test('readiness requires active migration, exact site-only bindings and a fresh writer fence',async()=>{
 const f=fixture(),adapter=createMultisiteCenterAdapter(f.input);assert.equal((await adapter.ready({slot,config:{}})).ready,true);
 f.workspace.migrationState='staged';assert.equal((await adapter.ready({slot,config:{}})).ready,false);f.workspace.migrationState='active';
 f.workspace.sections[0].policy.targets.push({locale:'en',destinationId:'social'});assert.equal((await adapter.ready({slot,config:{}})).ready,false);f.workspace.sections[0].policy.targets.pop();
 f.proof.exclusiveWriter=false;assert.equal((await adapter.ready({slot,config:{}})).ready,false);f.proof.exclusiveWriter=true;
 f.proof.observedAt='2026-11-01T00:00:00.000Z';assert.equal((await adapter.ready({slot,config:{}})).ready,false);
 f.proof.observedAt=new Date(now).toISOString();f.migration.receiptId='wrong:enter';assert.equal((await adapter.ready({slot,config:{}})).ready,false);
});

test('the original ID is looked up over complete stable pages before exact-scoped creation',async()=>{
 const f=fixture(),adapter=createMultisiteCenterAdapter(f.input);
 assert.deepEqual(await adapter.lookup(slot.id,{slot}),{state:'missing',complete:true});
 const demand={id:slot.id,workspaceId:'enter',sectionId:'forums',kind:'write',title:'A new subject',brief:'x',requiredLocales:['zh-CN','en']};
 assert.equal((await adapter.enqueue(demand,{slot})).id,slot.id);assert.equal((await adapter.lookup(slot.id,{slot})).state,'found');
 await assert.rejects(adapter.enqueue({...demand,workspaceId:'other'},{slot}),/outside/);
 assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
});

test('candidate selection requires scoped sources, independent novelty and verified excerpts',async()=>{
 const f=fixture(),adapter=createMultisiteCenterAdapter(f.input),demand=await adapter.prepare({slot,config:{}});
 assert.equal(demand.id,slot.id);assert.equal(demand.workspaceId,'enter');assert.deepEqual(demand.requiredLocales,['zh-CN','en']);assert.match(demand.brief,/source\.example/);assert.match(demand.brief,/资源介绍/);assert.match(demand.brief,/核对官方仓库及许可证/);
 await assert.rejects(createMultisiteCenterAdapter({...f.input,judge:async()=>({duplicate:false,confidence:'low'})}).prepare({slot,config:{}}),/novelty/);
 await assert.rejects(createMultisiteCenterAdapter({...f.input,verifySource:async()=>({url:f.lead.url,verified:true,supportsTopic:false,excerpt:'x'.repeat(100)})}).prepare({slot,config:{}}),/not verified/);
 await assert.rejects(createMultisiteCenterAdapter({...f.input,sourceLeads:async()=>({siteId:'other',sectionId:'forums',leads:[f.lead]})}).prepare({slot,config:{}}),/scoped/);
});

test('identity changes, incomplete source inventories and inventory movement fail closed',async()=>{
 const f=fixture();await assert.rejects(createMultisiteCenterAdapter({...f.input,connection:{...f.input.connection,workerId:'other'}}).lookup(slot.id,{slot}),/identity/);
 await assert.rejects(createMultisiteCenterAdapter({...f.input,publicCatalog:async()=>({...f.catalog,complete:false})}).prepare({slot,config:{}}),/catalog/);
 let reads=0;const base=f.input.client.request;f.input.client.request=async(path,opts)=>{if(path.startsWith('/demands?')&&++reads===2)return [{id:'new',workspaceId:'enter',state:'queued',title:'New'}];return base(path,opts);};
 await assert.rejects(createMultisiteCenterAdapter(f.input).lookup(slot.id,{slot}),/inventory changed/);
});

test('cancelled reads never create an order',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();const adapter=createMultisiteCenterAdapter(f.input);
 await assert.rejects(adapter.enqueue({id:slot.id,workspaceId:'enter',sectionId:'forums'},{slot,signal:controller.signal}),{name:'AbortError'});assert.equal(f.calls.length,0);
});

test('opt-in source stage checks scoped full text before topic selection, freezes it before POST and recovers the same order',async t=>{
 const f=fixture(),home=await mkdtemp(join(tmpdir(),'rssd-multisite-source-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const license='https://creativecommons.org/licenses/by/4.0/',long='Verified synthetic full text for controlled integration. '.repeat(5),body=`<article xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta><article-id pub-id-type="pmcid">PMC123</article-id><permissions><license xlink:href="${license}"/></permissions></article-meta></front><body><sec sec-type="methods"><title>Methods</title><p>${long}</p></sec></body></article>`;
 const config={enabled:true,rules:[{siteId:'enter',workspaceId:'enter',sectionId:'forums',url:f.lead.url,idType:'pmcid',articleId:'PMC123',licenseUrls:[license],requiredSections:['methods'],minSectionCharacters:100}]};
 f.input.client.identity=async()=>({protocolVersion:1,orgId:'org-one',workerId:'device-one',workspaceIds:['enter']});f.input.client.activeClaim=async()=>null;
 let reads=0;const fetchPage=async url=>{reads++;return {reachable:true,originalUrl:url,finalUrl:url,contentType:'text/xml',text:body};};
 const makeRuntime=()=>configuredSourceRuntime(config,{home,connection:f.input.connection,client:f.input.client,fetchPage});const runtime=await makeRuntime();
 const topic=createConfiguredTopicAdapters({catalog:{},organizations:{enter:{siteId:'enter'}},sourceStage:runtime.sourceStage,requireSourceStage:true,fetchLeads:async()=>({...slot,leads:[f.lead,{title:'Untrusted',url:'https://outside.example/article'}]}),fetchPage:()=>assert.fail(),generateTopics:async({sourceSeeds})=>{assert.equal(sourceSeeds.length,1);return [{title:'A new subject',brief:'Explain the actual method',sources:[f.lead]}];},judgeTopic:async()=>({duplicate:false,confidence:'high'}),judgeSource:async()=>({primarySource:true,supportsTopic:true,confidence:'high'})});
 const adapter=createMultisiteCenterAdapter({...f.input,...topic,sourceStage:runtime.sourceStage,requireSourceStage:true});const demand=await adapter.prepare({slot,config:{}});assert(!demand.brief.includes(long));assert(!demand.brief.includes(f.lead.url));assert.equal(reads,3);
 const old=f.input.client.request;f.input.client.request=async(path,options)=>{const result=await old(path,options);if(path==='/demands'&&options?.method==='POST')throw Error('ack lost');return result;};
 await assert.rejects(adapter.enqueue(demand,{slot}),/ack lost/);assert.equal((await adapter.lookup(slot.id,{slot})).state,'found');
 const restarted=await makeRuntime();assert.ok(await restarted.sourceStage.verifyDemand({slot,demand}));assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.equal(reads,3);
 await assert.rejects(createMultisiteCenterAdapter({...f.input,...topic,requireSourceStage:true}).prepare({slot,config:{}}),/not configured/);
});

test('dynamic PMC scope remains opt-in and separate from other site verifiers',()=>{
 validateSourceRuntimeConfiguration(undefined);validateSourceRuntimeConfiguration({enabled:false});
 const scope={siteId:'enter',workspaceId:'enter',sectionId:'forums'},staticRule={...scope,url:'https://source.example/article'};
 assert.throws(()=>validateSourceRuntimeConfiguration({enabled:true,pmc:{enabled:true,scopes:[scope]},rules:[staticRule]}),/cannot overlap/);
 assert.throws(()=>validateSourceRuntimeConfiguration({enabled:true,pmc:{enabled:false,scopes:[scope]}}),/cannot grant/);
 assert.doesNotThrow(()=>validateSourceRuntimeConfiguration({enabled:true,pmc:{enabled:true,scopes:[scope]},rules:[{...staticRule,sectionId:'other'}]}));
});

test('dynamic PMC topic freezes the actual official JATS before demand POST and survives restart',async t=>{
 const f=fixture(),home=await mkdtemp(join(tmpdir(),'rssd-multisite-pmc-'));t.after(()=>rm(home,{recursive:true,force:true}));const locator='https://pmc.ncbi.nlm.nih.gov/articles/PMC123/',doi='10.1000/example',license='https://creativecommons.org/licenses/by/4.0/',long='Synthetic methods in the original document. '.repeat(6),doc=`<pmc-articleset><article xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta><article-id pub-id-type="pmcid">PMC123</article-id><article-id pub-id-type="pmid">456</article-id><article-id pub-id-type="doi">${doi}</article-id><title-group><article-title>Actual original</article-title></title-group><permissions><license xlink:href="${license}"/></permissions></article-meta></front><body><sec><title>Methods</title><p>${long}</p></sec><sec><title>Results</title><p>${long}</p></sec></body></article></pmc-articleset>`;
 const config={enabled:true,pmc:{enabled:true,scopes:[{siteId:slot.siteId,workspaceId:slot.workspaceId,sectionId:slot.sectionId}]}},lead={title:'Paper',url:locator};f.input.client.identity=async()=>({protocolVersion:1,orgId:'org-one',workerId:'device-one',workspaceIds:['enter']});f.input.client.activeClaim=async()=>null;
 let fetches=0;const fetchPage=async url=>{fetches++;if(url==='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=123&retmode=json')return {reachable:true,originalUrl:url,finalUrl:url,contentType:'application/json',text:JSON.stringify({header:{type:'esummary'},result:{uids:['123'],'123':{uid:'123',articleids:[{idtype:'pmcid',value:'PMC123'},{idtype:'pmid',value:'456'},{idtype:'doi',value:doi}]}}})};if(url==='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=123&retmode=xml')return {reachable:true,originalUrl:url,finalUrl:url,contentType:'text/xml',text:doc};throw Error('unexpected network destination');};
 const runtime=await configuredSourceRuntime(config,{home,connection:f.input.connection,client:f.input.client,fetchPage}),topic=createConfiguredTopicAdapters({catalog:{},organizations:{enter:{siteId:'enter'}},sourceStage:runtime.sourceStage,requireSourceStage:true,fetchLeads:async()=>({...slot,leads:[lead]}),generateTopics:async({sourceSeeds})=>{assert.equal(sourceSeeds[0].url,locator);return [{title:'A new subject',brief:'Explain the actual method',sources:[lead]}];},judgeTopic:async()=>({duplicate:false,confidence:'high'}),judgeSource:async()=>({primarySource:true,supportsTopic:true,confidence:'high'})});
 const adapter=createMultisiteCenterAdapter({...f.input,...topic,sourceStage:runtime.sourceStage,requireSourceStage:true});const demand=await adapter.prepare({slot,config:{}});assert(!demand.brief.includes(long));assert(!demand.brief.includes(locator));const before=fetches;await adapter.enqueue(demand,{slot});
 const restarted=await configuredSourceRuntime(config,{home,connection:f.input.connection,client:f.input.client,fetchPage:()=>assert.fail('no source refetch')});assert.ok(await restarted.sourceStage.verifyDemand({slot,demand}));assert.equal(fetches,before);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
});
