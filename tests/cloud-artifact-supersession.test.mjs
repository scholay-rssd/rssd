import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {profiles,validateSite,publicationDirectory} from '../scripts/site-config.mjs';
import {continuationArtifactSha256,saveCloudContinuationArtifact,readCloudContinuationEvidence} from '../scripts/publishing-flow-artifact.mjs';
import {supersedeCloudContinuationArtifact} from '../scripts/publishing-flow-artifact-supersession.mjs';
import {queuePublicationBinding} from '../scripts/publication-queue-status.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {durableWriteJson} from '../scripts/durable-json.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {withFileLock} from '../scripts/editorial-lock.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {authorizeCloudHandoff} from '../scripts/publishing-flow-handoff.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const load=async file=>JSON.parse(await readFile(file,'utf8'));
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'artifact-supersession-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const site=validateSite({...profiles.find(value=>value.id==='metho'),languages:['zh-CN','en']}),articleId='reviewed-artifact-source',requestKey='original-chinese-request',jobId=hash([site.id,requestKey]);
 await durableWriteJson(join(root,'.site.json'),site);
 const source={id:articleId,title:'研究原稿',summary:'原始研究完整保留。',markdown:'# 研究原稿\n\n原始研究完整保留。',date:'2026-10-25',category:site.columns[0],author:site.author,assets:[]},sourceSha256=sourceContentSha256(source),flowId=hash([site.id,articleId,1,sourceSha256]).slice(0,40);
 const packet={siteId:site.id,spaceId:site.spaceId,origin:site.origin,intent:'publish',requestKey,sourceSha256:'a'.repeat(64),expectedVersion:0,expectedPublishedVersion:null,data:source};
 const oldEdition={title:'Research source',summary:'Original research is preserved.',markdown:'# Research source\n\nOriginal research was corrected when published.'},newEdition={...oldEdition,markdown:'# Research source\n\nOriginal research was corrected after publication.'};
 const artifact={version:1,jobId,siteId:site.id,origin:site.origin,articleId,requestKey,continuationOwner:'cloud',flowId,revision:1,sourceSha256,sourceUrl:site.origin+'/news/'+articleId+'/',brand:{name:site.name,slogan:site.slogan||''},source,edition:oldEdition,chinese:{status:'verified',url:site.origin+'/news/'+articleId+'/',revision:1},english:{status:'verified',url:site.origin+'/en/news/'+articleId+'/',revision:1},community:{status:'verified',url:'https://enterscholar.com/t/-/12345'}};
 const responseFor=value=>({version:1,status:'ready',jobId,siteId:site.id,articleId,requestKey,continuationOwner:'cloud',artifactSha256:continuationArtifactSha256(value),artifact:value});
 const old=responseFor(artifact),next=responseFor({...structuredClone(artifact),edition:newEdition,english:{...artifact.english,revision:2}}),websiteReceipt={requestKey,revision:1,url:'/news/'+articleId+'/',publicReadback:true,job:{id:'original-chinese-build',status:'success'}};
 const receipt={...websiteReceipt,intent:'publish',sourceSha256:packet.sourceSha256,asyncQueue:{version:1,owner:'cloud',continuationOwner:'cloud',jobId,endpoint:'https://queue.example.test',phase:'complete',packetSha256:hash(packet),continuation:{id:flowId,status:'complete',owner:'cloud'}}};receipt.asyncQueue.binding=queuePublicationBinding(site,packet,receipt);
 const ref=await saveCloudContinuationArtifact({root,siteId:site.id,articleId,receipt,response:old});receipt.asyncQueue.continuation.artifact=ref;
 const directory=join(publicationDirectory(root),articleId),remote=join(root,'.local/publishing-flow/remote'),handoffDirectory=join(root,'handoff');await mkdir(handoffDirectory);
 await durableWriteJson(join(root,'.local/publishing-flow/policy.json'),{version:1,siteId:site.id,origin:site.origin,enabled:true,authorization:'Existing original workspace handoff policy',targets:[],handoffDirectory});
 await durableWriteJson(join(directory,'prepared.json'),packet);await durableWriteJson(join(directory,'receipt.json'),receipt);
 const tokenFile=join(root,'original-token');await writeFile(tokenFile,'ORIGINAL_PRIVATE_TOKEN',{mode:0o600});await protectPrivateFile(tokenFile);
 const recovered={version:1,status:'ready',jobId,siteId:site.id,articleId,requestKey,continuationOwner:'cloud',packetSha256:continuationArtifactSha256(packet),sourceSha256,packet,receipt:websiteReceipt};
 const input={version:1,root,site,articleId,jobId,requestKey,handoffDirectory,tokenFile,expectedReceiptSha256:hash(receipt),expectedOldArtifactSha256:old.artifactSha256,expectedNewArtifactSha256:next.artifactSha256,expectedNewEditionSha256:hash(newEdition),newReviewedEdition:newEdition,reviewed:true,reason:'Reviewed the correction timing against the original source'};
 const calls=[],mode={pending:false,error:false,response:next,recovered,live:{version:1,publishedVersion:1,sha256:sourceSha256},hook:null};
 const fetcher=async(url,options)=>{
  calls.push({url,method:options.method});assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer ORIGINAL_PRIVATE_TOKEN');assert.equal(options.headers['X-Scholay-Site'],site.id);assert.equal(options.redirect,'error');if(mode.hook)await mode.hook(url);
  if(mode.error)return Response.json({error:'Not accepted'},{status:404});
  if(url.includes('/flow-source/'))return Response.json(mode.live);
  if(url.endsWith('/recovery-packet'))return Response.json(mode.recovered);
  if(url.endsWith('/continuation-artifact'))return Response.json(mode.pending?{version:1,status:'pending',jobId,siteId:site.id,articleId,requestKey,continuationOwner:'cloud'}:mode.response);
  assert.fail('Unexpected URL '+url);
 };
 const adopt=options=>supersedeCloudContinuationArtifact(input,{fetcher,now:100,...options});
 const evidence=async()=>readCloudContinuationEvidence({root,siteId:site.id,articleId,receipt:await load(join(directory,'receipt.json'))});
 return {root,site,articleId,jobId,flowId,input,old,next,packet,receipt,directory,remote,handoffDirectory,mode,calls,fetcher,adopt,evidence,artifactFile:join(remote,jobId+'.json'),pointerFile:join(remote,jobId+'.supersession.json'),archiveFile:join(remote,'superseded',jobId+'-'+old.artifactSha256+'.json')};
}

test('explicit supersession retains complete old evidence, GETs the original packet and only replaces the artifact reference',async t=>{
 const f=await fixture(t);assert.equal((await f.evidence()).artifactSha256,f.old.artifactSha256);
 await assert.rejects(saveCloudContinuationArtifact({root:f.root,siteId:f.site.id,articleId:f.articleId,receipt:f.receipt,response:f.next}),/frozen publication/);
 assert.equal((await f.adopt()).status,'superseded');const receipt=await load(join(f.directory,'receipt.json')),expected=structuredClone(f.receipt);expected.asyncQueue.continuation.artifact.sha256=f.next.artifactSha256;assert.deepEqual(receipt,expected);
 const archive=await load(f.archiveFile);assert.deepEqual(archive.original,{receipt:f.receipt,artifact:f.old});assert.deepEqual(archive.proof.recoveryPacket.packet,f.packet);assert.equal((await f.evidence()).artifactSha256,f.next.artifactSha256);assert.deepEqual(await load(join(f.directory,'prepared.json')),f.packet);assert(f.calls.every(call=>call.method==='GET'));
 const count=f.calls.length;assert.equal((await f.adopt()).alreadySuperseded,true);assert.equal(f.calls.length,count);assert(!JSON.stringify(archive).includes('ORIGINAL_PRIVATE_TOKEN'));await assert.rejects(readFile(join(f.root,'.local/publishing-flow/jobs',f.flowId,'state.json')),error=>error.code==='ENOENT');
});

test('pending or unknown remote outcomes leave the old receipt and artifact untouched',async t=>{
 const f=await fixture(t);f.mode.pending=true;assert.equal((await f.adopt()).status,'pending');f.mode.error=true;await assert.rejects(f.adopt(),/Not accepted/);
 assert.deepEqual(await load(join(f.directory,'receipt.json')),f.receipt);assert.deepEqual(await load(f.artifactFile),f.old);await assert.rejects(readFile(f.pointerFile),error=>error.code==='ENOENT');
});

test('canonical handoff policy prevents choosing an empty directory and rejects absent or concurrently changed bindings',async t=>{
 const f=await fixture(t),empty=join(f.root,'empty-handoff');await mkdir(empty);await durableWriteJson(join(f.handoffDirectory,'cloud-authorizations',f.jobId+'.json'),{jobId:f.jobId});
 f.input.handoffDirectory=empty;await assert.rejects(f.adopt(),/canonical workspace policy/);assert.equal(f.calls.length,0);assert.deepEqual(await load(f.artifactFile),f.old);
 f.input.handoffDirectory=f.handoffDirectory;const policyFile=join(f.root,'.local/publishing-flow/policy.json'),policy=await load(policyFile);await rm(policyFile);await assert.rejects(f.adopt(),/existing workspace policy binding/);assert.equal(f.calls.length,0);
 await durableWriteJson(policyFile,policy);await rm(join(f.handoffDirectory,'cloud-authorizations',f.jobId+'.json'));f.mode.hook=async()=>durableWriteJson(policyFile,{...policy,authorization:'Concurrent policy edit'});await assert.rejects(f.adopt(),/policy binding changed/);await assert.rejects(readFile(f.pointerFile),error=>error.code==='ENOENT');
});

test('supersession rejects source, job, revision, candidate, full packet, receipt and credential changes',async t=>{
 for(const mutation of ['source','job','revision','candidate','packet','receipt','credential']){
  const f=await fixture(t);
  if(mutation==='source')f.mode.live.version=2;
  if(mutation==='job'){f.mode.response=structuredClone(f.next);f.mode.response.jobId='b'.repeat(64);}
  if(mutation==='revision'){f.mode.response=structuredClone(f.next);f.mode.response.artifact.english.revision=1;f.mode.response.artifactSha256=continuationArtifactSha256(f.mode.response.artifact);f.input.expectedNewArtifactSha256=f.mode.response.artifactSha256;}
  if(mutation==='candidate'){f.input.newReviewedEdition={...f.input.newReviewedEdition,markdown:'Different reviewed content'};f.input.expectedNewEditionSha256=hash(f.input.newReviewedEdition);}
  if(mutation==='packet'){f.mode.recovered=structuredClone(f.mode.recovered);f.mode.recovered.packet.data.author='Changed';f.mode.recovered.packetSha256=continuationArtifactSha256(f.mode.recovered.packet);f.mode.recovered.sourceSha256=sourceContentSha256(f.mode.recovered.packet.data);}
  if(mutation==='receipt'){f.input.expectedReceiptSha256='d'.repeat(64);}
  const previous=process.env.SCHOLAY_TODAY_TOKEN;if(mutation==='credential')process.env.SCHOLAY_TODAY_TOKEN='ambient';
  try{await assert.rejects(f.adopt());}finally{if(previous===undefined)delete process.env.SCHOLAY_TODAY_TOKEN;else process.env.SCHOLAY_TODAY_TOKEN=previous;}
  assert.deepEqual(await load(f.artifactFile),f.old);assert.deepEqual(await load(join(f.directory,'receipt.json')),f.receipt);await assert.rejects(readFile(f.pointerFile),error=>error.code==='ENOENT');
 }
});

test('every frozen distribution form blocks replacement, while unrelated grants are untouched',async t=>{
 const forms=[['cloud-authorizations',{jobId:'JOB'}],['outbox',{cloudContinuation:{jobId:'JOB'}}],['receipts',{source:{jobId:'JOB'},status:'unknown'}],['recovery-cohorts',{cohort:{members:[{jobId:'JOB',grant:{mode:'draft'}}]}}],['grants',{planId:'PLAN'}]];
 for(const [directory,value] of forms){const f=await fixture(t),record=JSON.parse(JSON.stringify(value).replaceAll('JOB',f.jobId).replaceAll('PLAN',f.flowId));await durableWriteJson(join(f.handoffDirectory,directory,'record.json'),record);await assert.rejects(f.adopt(),/frozen distribution/);assert.equal(f.calls.length,0);}
 const f=await fixture(t);await durableWriteJson(join(f.handoffDirectory,'recovery-cohorts','other.json'),{cohort:{members:[{jobId:'f'.repeat(64),planId:'e'.repeat(40),grant:{siteId:f.site.id,articleId:f.articleId,revision:2,sha256:'d'.repeat(64),artifactSha256:'c'.repeat(64)}}]}});assert.equal((await f.adopt()).status,'superseded');
});

test('all five durable interruptions block readers and ordinary publication/authorization until exact resume',async t=>{
 for(let stop=1;stop<=5;stop++){
  const f=await fixture(t);let writes=0;await assert.rejects(f.adopt({writeJson:async(file,value)=>{await durableWriteJson(file,value);if(++writes===stop)throw Error('power loss');}}),/power loss/);
  if(stop<5){
   await assert.rejects(f.evidence(),/frozen publication/);
   const publisher=createWebsitePublisher({root:f.root,site:f.site,tokenFile:f.input.tokenFile,fetcher:async()=>assert.fail('No network while supersession is prepared')});
   await assert.rejects(publisher.refreshCloudContinuation(f.articleId,{requestKey:f.input.requestKey,jobId:f.jobId}),/frozen publication/);
   await assert.rejects(authorizeCloudHandoff({root:f.root,siteId:f.site.id,articleId:f.articleId,receipt:await load(join(f.directory,'receipt.json')),handoffDirectory:f.handoffDirectory,authorization:{}}),/frozen publication/);
  }
  assert.equal((await f.adopt()).status,'superseded');assert.equal((await f.evidence()).artifactSha256,f.next.artifactSha256);assert.deepEqual((await load(f.archiveFile)).original.artifact,f.old);
 }
});

test('pending transaction refuses changed snapshots and locks exclude workers and authorization before network',async t=>{
 const f=await fixture(t);for(const path of [join(f.handoffDirectory,'postiz.lock'),join(f.directory,'queue-worker.lock'),join(f.directory,'operation.lock'),f.artifactFile+'.lock']){
  let enter,release;const ready=new Promise(resolve=>enter=resolve),hold=new Promise(resolve=>release=resolve),locked=withFileLock(path,async()=>{enter();await hold;});await ready;
  try{await assert.rejects(f.adopt(),/文件正在保存/);assert.equal(f.calls.length,0);}finally{release();await locked;}
 }
 let writes=0;await assert.rejects(f.adopt({writeJson:async(file,value)=>{await durableWriteJson(file,value);if(++writes===1)throw Error('power loss');}}));
 await durableWriteJson(join(f.directory,'receipt.json'),{...f.receipt,unexpected:true});await assert.rejects(f.adopt(),/outside the pending/);
});
