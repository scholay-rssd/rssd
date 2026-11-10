import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {profiles} from '../scripts/site-config.mjs';
import {createCloudQueue,durableCloudJson} from '../scripts/cloud-queue.mjs';
import {asEditorialRecord,recordMarkdown,recordFields} from '../scripts/editorial-record.mjs';
import {validate} from '../admin/model.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';

const site={...profiles.find(value=>value.id==='scholay-today'),languages:['zh-CN','en']};
const documentId='91e52c25-5d3b-4911-9b24-769157a52079',articleId='record-'+documentId;
const hash=value=>createHash('sha256').update(value).digest('hex');
function asset(suffix='one'){const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from(suffix)]);return {path:'/article-media/'+hash(bytes)+'.png',data:bytes.toString('base64')};}
async function fixture(t,{kind='openSource',intent='publish',buildStatus='success',continuation,owner='local'}={}){
 const root=await mkdtemp(join(tmpdir(),'cloud-record-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const tokenFile=join(root,'token');await writeFile(tokenFile,'ORIGINAL_RECORD_TOKEN',{mode:0o600});await protectPrivateFile(tokenFile);
 const base={title:'结构化记录',summary:'完整项目介绍。'.repeat(kind==='openSource'?800:10)};
 const fields=kind==='openSource'?{...base,date:'2020-01-01',category:site.sourceCategories[0],value:'保留完整价值与限制。',url:'https://example.org/project',relatedUrl:'https://example.org/source',status:'公开收录'}:kind==='year'?{...base,id:'year:editor:'+documentId,category:site.yearCategories[0],tags:[],start:'2027-01-01',end:null,dateBasis:'官方日程',body:'完整正文与限制。',bodyTruncated:false,sourceName:'官方来源',sourceUrl:'https://example.org/calendar',provenance:'原文资料',reviewedAt:null}:{title:base.title,id:'history:editor:'+documentId,dateKey:'01-01',year:1900,domain:'研究',eventType:'发现',importance:'A',factSummary:'完整历史事实。'.repeat(800),historicalSignificance:'保留历史意义。',sources:[{label:'原始资料',url:'https://example.org/history'}],preciseToDay:true};
 const data={id:articleId,title:fields.title,summary:'客户端短摘要。',markdown:recordMarkdown(kind,fields),date:'2020-01-01',category:'客户端栏目',author:'原客户端作者',assets:[asset()],record:{documentId,kind,fields}};
 const packet={siteId:site.id,spaceId:site.spaceId,origin:site.origin,intent,requestKey:'record-recovery-original-request',expectedVersion:0,expectedPublishedVersion:null,sourceSha256:'a'.repeat(64),data};
 const route=({openSource:'/open-source/',year:'/calendar/',history:'/history/'})[kind]+'existing-stable-route/';
 let saved,time=1000000;const counts={post:0,retry:0,lookup:0},remote={version:1,publishedVersion:1},controls={lookupStatus:200,buildStatus,mutate:value=>value,canonical:true};
 const receipt=()=>({articleId,revision:1,url:route,job:{id:'original-website-build',status:controls.buildStatus}});
 const stored=()=>validate(kind,{...recordFields(kind,fields,saved.data.markdown),assets:saved.data.assets},fields,site);
 const envelope=()=>controls.mutate(asEditorialRecord({id:documentId,kind,updated:Date.parse('2026-10-25T00:00:00Z')},stored()));
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin});
  assert.equal(options.headers.Authorization,'Bearer ORIGINAL_RECORD_TOKEN');
  if(options.method==='POST'){
   counts.post++;
   if(path.endsWith('/retry')){counts.retry++;controls.buildStatus='success';return Response.json(receipt());}
   saved=JSON.parse(options.body);return Response.json(intent==='draft'?{revision:1,version:1,publishedVersion:null}:receipt());
  }
  if(path.includes('/requests/')){counts.lookup++;return saved&&controls.lookupStatus===200?Response.json(intent==='draft'?{revision:1,version:1,publishedVersion:null}:receipt()):Response.json({error:'missing'},{status:controls.lookupStatus===200?404:controls.lookupStatus});}
  if(path==='/manage/api/news/'+articleId)return Response.json({...remote,data:envelope(),published:envelope(),url:route});
  if(path==='/manage/api/news/cloud/'+articleId)return Response.json({version:remote.version,publishedVersion:null,data:envelope(),url:route});
  assert.equal(path,route);return new Response(controls.canonical?'<link rel="canonical" href="'+site.origin+route+'">':'not ready');
 };
 // Public readback has no Authorization header; keep the mock's credential
 // assertion confined to the private news API.
 const wrappedFetch=(url,options={})=>new URL(url).pathname===route?Promise.resolve(new Response(controls.canonical?'<link rel="canonical" href="'+site.origin+route+'">':'not ready')):fetcher(url,options);
 const directory=join(root,'queue'),config={directory,sites:[{site,tokenFile}],fetcher:wrappedFetch,continuation,now:()=>time},queue=createCloudQueue(config),accepted=await queue.enqueue(site.id,packet,{continuationOwner:owner});
 const stateFile=join(directory,'jobs',accepted.jobId,'state.json'),state=async()=>JSON.parse(await readFile(stateFile,'utf8'));
 async function retainedFailure(){saved=structuredClone(packet);const old=await state();await durableCloudJson(stateFile,{...old,sends:1,status:'needs_review',stage:'verifying',error:'The currently published article differs from this task',receipt:{...receipt(),requestKey:packet.requestKey,intent:'publish',submittedAt:'2026-10-23T00:00:00Z'}});await queue.tick();}
 return {queue,config,accepted,packet,controls,counts,remote,root,directory,state,stateFile,retainedFailure,advance:()=>time+=30000};
}

for(const kind of ['year','history','openSource'])test('real '+kind+' readback accepts CMS-derived envelopes and full structured prose',async t=>{
 const f=await fixture(t,{kind});const [done]=await f.queue.tick();assert.equal(done.status,'complete');assert.equal(done.receipt.publicReadback,true);assert.equal(f.counts.post,1);assert.deepEqual(await readdir(join(f.directory,'pending')),[]);
});

test('structured cloud draft and failed-build recovery compare persisted fields, including long summaries',async t=>{
 const draft=await fixture(t,{intent:'draft'});assert.equal((await draft.queue.tick())[0].status,'draft_saved');assert.equal(draft.counts.post,1);
 const failed=await fixture(t,{buildStatus:'failed'});assert.equal((await failed.queue.tick())[0].status,'waiting');assert.equal(failed.counts.retry,1);failed.advance();assert.equal((await failed.queue.tick())[0].status,'complete');assert.equal(failed.counts.post,2);
});

test('record body, source, document identity and image changes remain conflicts despite matching display fields',async t=>{
 const mutations=[data=>({...data,record:{...data.record,fields:{...data.record.fields,value:'Different stored body'}}}),data=>({...data,record:{...data.record,fields:{...data.record.fields,url:'https://example.org/different'}}}),data=>({...data,record:{...data.record,documentId:'a'.repeat(36)}}),data=>({...data,assets:[asset('changed')]}),data=>({...data,assets:[{...data.assets[0],data:asset('tampered').data}]})];
 for(const mutate of mutations){const f=await fixture(t);f.controls.mutate=mutate;assert.equal((await f.queue.tick())[0].status,'needs_review');assert.equal(f.counts.post,1);}
});

test('controlled reverify uses only the original credential and GETs, then freezes continuation once',async t=>{
 let continuations=0;const f=await fixture(t,{owner:'cloud',continuation:async({packet,receipt,credentialId})=>{continuations++;assert.equal(packet.requestKey,'record-recovery-original-request');assert.equal(receipt.publicReadback,true);assert.equal(credentialId,hash('ORIGINAL_RECORD_TOKEN'));return {status:'queued',id:'a'.repeat(40)};}});await f.retainedFailure();
 await writeFile(join(f.root,'token'),'ROTATED_CONFIGURED_TOKEN');
 const before=await f.state(),done=await f.queue.reverify(site.id,f.accepted.jobId);assert.equal(done.status,'complete');assert.equal(done.reverified,true);assert.equal(done.continuation.id,'a'.repeat(40));assert.equal(done.receipt.requestKey,before.requestKey);assert.equal(continuations,1);assert.equal(f.counts.post,0);
 const after=await f.state();assert.equal(after.sends,before.sends);assert.equal(after.packetSha256,before.packetSha256);assert.equal(after.credentialId,before.credentialId);assert.equal(after.reverification.previousError,before.error);assert.deepEqual(await readdir(join(f.directory,'pending')),[]);
 assert.equal((await f.queue.reverify(site.id,f.accepted.jobId)).status,'complete');assert.equal(continuations,1);assert.equal(f.counts.post,0);
});

test('reverify never submits an absent request or accepts a changed revision, body or public route',async t=>{
 for(const change of [f=>{f.controls.lookupStatus=404;},f=>{f.controls.lookupStatus=503;},f=>{f.remote.publishedVersion=2;},f=>{f.remote.version=2;},f=>{f.controls.mutate=data=>({...data,record:{...data.record,fields:{...data.record.fields,value:'Changed'}}});},f=>{f.controls.canonical=false;},f=>{f.controls.buildStatus='failed';}]){
  const f=await fixture(t);await f.retainedFailure();const before=await f.state();change(f);await assert.rejects(f.queue.reverify(site.id,f.accepted.jobId));assert.deepEqual(await f.state(),before);assert.equal(f.counts.post,0);
 }
});

test('reverify rejects another site, changed durable packet and unrelated review errors',async t=>{
 const f=await fixture(t);await f.retainedFailure();await assert.rejects(f.queue.reverify('study',f.accepted.jobId),error=>error.statusCode===404);
 const original=await f.state();await durableCloudJson(f.stateFile,{...original,receipt:{...original.receipt,job:{status:'success'}}});await assert.rejects(f.queue.reverify(site.id,f.accepted.jobId),/Only a retained structured/);
 await durableCloudJson(f.stateFile,{...original,error:'Original request remains absent after bounded replay; review required'});await assert.rejects(f.queue.reverify(site.id,f.accepted.jobId),/Only a retained structured/);
 await durableCloudJson(f.stateFile,original);await durableCloudJson(join(f.directory,'jobs',f.accepted.jobId,'packet.json'),{...f.packet,data:{...f.packet.data,summary:'tampered'}});await assert.rejects(f.queue.reverify(site.id,f.accepted.jobId),/missing or changed/);assert.equal(f.counts.post,0);
});

test('a failed continuation handoff keeps the original recovery available without re-posting',async t=>{
 let attempts=0;const f=await fixture(t,{owner:'cloud',continuation:async()=>{if(++attempts===1)throw Error('temporary plan write failure');return {status:'queued',id:'a'.repeat(40)};}});await f.retainedFailure();
 await assert.rejects(f.queue.reverify(site.id,f.accepted.jobId),/temporary plan write/);assert.equal((await f.state()).status,'needs_review');assert.equal((await f.queue.reverify(site.id,f.accepted.jobId)).status,'complete');assert.equal(attempts,2);assert.equal(f.counts.post,0);
});
