import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {durableWriteJson} from '../scripts/durable-json.mjs';
import {DEFAULT_SITE} from '../scripts/site-config.mjs';
import {sha} from '../scripts/editorial-workspace.mjs';
import {indexPublicationQueue,settlePublicationQueue,publicationQueueSnapshot,queuePublicationBinding} from '../scripts/publication-queue-status.mjs';
import {publicationRecoveryCandidates,resumePublicationQueue} from '../scripts/publication-queue-recover.mjs';
import {publicationQueueClient,validateQueueEndpoint,cloudPublicationJobId} from '../scripts/publication-queue-client.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {continuationArtifactSha256,readCloudContinuationEvidence} from '../scripts/publishing-flow-artifact.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-transport-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,site:DEFAULT_SITE,globalData:null};}
async function queued(options,id,extra={}){
 const packet={requestKey:'original-request-'+id,data:{id,title:'原稿 '+id},intent:'publish',sourceSha256:'a'.repeat(64)},directory=join(options.root,'.local/today',id);
 const receipt={requestKey:packet.requestKey,sourceSha256:packet.sourceSha256,job:{id:packet.requestKey,status:'queued'},asyncQueue:{version:1,owner:'local',phase:'queued',packetSha256:sha(JSON.stringify(packet)),...extra}};
 await durableWriteJson(join(directory,'prepared.json'),packet);await durableWriteJson(join(directory,'receipt.json'),receipt);await indexPublicationQueue(options.root,options.site,id,packet.data.title);return {packet,receipt,directory};
}
test('startup recovery enumerates only accepted original tasks and resumes without network or new publication identity',async t=>{
 const options=await fixture(t),original=await queued(options,'original-article');
 const before=await readFile(join(original.directory,'prepared.json'),'utf8');
 const snapshot=await publicationRecoveryCandidates(options);assert.equal(snapshot.candidates.length,1);assert.equal(snapshot.candidates[0].id,'original-article');
 const calls=[];const result=await resumePublicationQueue(snapshot.candidates[0],{kick:async value=>calls.push(value)});
 assert.equal(result.resumed,true);assert.equal(calls.length,1);assert.equal(calls[0].root,options.root);assert.equal(calls[0].site.id,options.site.id);
 assert.equal(await readFile(join(original.directory,'prepared.json'),'utf8'),before);
 await durableWriteJson(join(original.directory,'prepared.json'),{...original.packet,requestKey:'replacement-not-approved'});
 await assert.rejects(resumePublicationQueue(snapshot.candidates[0],{kick:async()=>assert.fail('must not start')}),/身份已变化/);
});
test('complete transport history is bounded while original receipts remain and review tasks are retained',async t=>{
 const options=await fixture(t);
 for(let i=0;i<23;i++){const id='complete-'+String(i).padStart(3,'0');await queued(options,id,{phase:'complete'});await settlePublicationQueue(options.root,options.site,id);}
 await queued(options,'needs-attention',{phase:'needs_review',error:'原请求需核对'});
 const index=JSON.parse(await readFile(join(options.root,'.local/today/queue-index.json'),'utf8'));
 assert.equal(Object.keys(index.history).length,20);assert.equal(Object.keys(index.items).length,1);
 const snapshot=await publicationQueueSnapshot(options);assert.equal(snapshot.jobs.length,21);assert.equal(snapshot.jobs[0].status,'needs_review');
 assert.equal((await publicationRecoveryCandidates(options)).candidates.length,0);
 assert((await readdir(join(options.root,'.local/today'))).includes('complete-000'));
});
test('Chinese success does not hide a failed English continuation and snapshot remains read only',async t=>{
 const options=await fixture(t),job=await queued(options,'chinese-done',{owner:'cloud',phase:'complete',continuation:{status:'waiting',translation:{status:'failed'},error:'原译文保留待处理'}});
 const before=await readFile(join(job.directory,'receipt.json'),'utf8');
 const snapshot=await publicationQueueSnapshot(options);assert.equal(snapshot.jobs[0].status,'needs_review');assert.match(snapshot.jobs[0].phase,/中文已发布/);
 assert.equal(await readFile(join(job.directory,'receipt.json'),'utf8'),before);
});
test('invalid successful HTTP acknowledgement remains retryable and redirects cannot change the trusted queue',async()=>{
 const client=publicationQueueClient({endpoint:'http://127.0.0.1:8765',site:DEFAULT_SITE,token:'synthetic-private-token',fetcher:async(_url,request)=>{assert.equal(request.redirect,'error');return new Response('<html>temporary proxy</html>',{status:200});}});
 await assert.rejects(client.submit({requestKey:'original-request-value',data:{id:'original-article'}}),error=>error.statusCode===502);
 assert.throws(()=>validateQueueEndpoint('https://user:secret@example.com/'),/HTTPS/);
 assert.throws(()=>validateQueueEndpoint('http://public.example/'),/HTTPS/);
});
test('archived prepared packets retain strict read-only cloud recovery through their frozen source identity',async t=>{
 const options=await fixture(t),id='archived-publication',job=await queued(options,id,{owner:'cloud',phase:'complete',endpoint:'http://127.0.0.1:9876',continuationOwner:'cloud',continuation:{owner:'cloud',status:'queued'}});
 const receipt={...job.receipt,intent:'publish',status:'submitted',revision:1,url:'/news/'+id+'/',publicReadback:true,job:{id:'original-website-job',status:'success'}};receipt.asyncQueue.binding=queuePublicationBinding(options.site,job.packet,receipt);receipt.asyncQueue.jobId=cloudPublicationJobId(options.site.id,receipt.requestKey);
 const cloud={articleId:id,version:1,publishedVersion:1,sourceSha256:job.packet.sourceSha256,archiveId:'b'.repeat(64),archiveSha256:'b'.repeat(64)};
 await durableWriteJson(join(options.root,'_ops/inventory/article-index.json'),{articles:{},cloudArticles:{[id]:{shortTitle:'原稿',cloud}}});await durableWriteJson(join(job.directory,'release.json'),{phase:'complete',cloud});await durableWriteJson(join(job.directory,'receipt.json'),receipt);await durableWriteJson(join(job.directory,'sync.json'),{remoteId:id,revision:1,fingerprint:'original-frozen-fingerprint'});await rm(join(job.directory,'prepared.json'));
 let kicks=0;await resumePublicationQueue({root:options.root,site:options.site,id},{kick:async()=>kicks++});assert.equal(kicks,1);
 const tokenFile=join(options.root,'token');await writeFile(tokenFile,'PRIVATE_ARCHIVE_TEST_TOKEN',{mode:0o600});await protectPrivateFile(tokenFile);let reads=0,complete=false;
 const source={...job.packet.data,summary:'原始摘要。',markdown:'# 原稿\n\n原始完整正文。',date:'2026-10-23',category:options.site.columns[0],author:options.site.author,assets:[]},sourceSha256=sourceContentSha256(source),flowId=sha(JSON.stringify([options.site.id,id,1,sourceSha256])).slice(0,40),sourceUrl=options.site.origin+receipt.url;
 const artifact={version:1,jobId:receipt.asyncQueue.jobId,siteId:options.site.id,origin:options.site.origin,articleId:id,requestKey:receipt.requestKey,continuationOwner:'cloud',flowId,revision:1,sourceSha256,sourceUrl,brand:{name:options.site.name,slogan:options.site.slogan||''},source,edition:{title:'Original article',summary:'Original summary.',markdown:'# Original article\n\nComplete original content.'},chinese:{status:'verified',url:sourceUrl,revision:1},english:{status:'verified',url:options.site.origin+'/en/news/'+id+'/',revision:1},community:{status:'verified',url:'https://enterscholar.com/t/-/12345'}};
 const publisher=()=>createWebsitePublisher({root:options.root,site:options.site,tokenFile,queueKick:async()=>{},fetcher:async(url,request)=>{assert.equal(request.method,'GET');assert.match(url,/\/v1\/jobs\//);reads++;if(url.endsWith('/continuation-artifact'))return Response.json({version:1,status:'ready',jobId:artifact.jobId,siteId:artifact.siteId,articleId:id,requestKey:receipt.requestKey,continuationOwner:'cloud',artifactSha256:continuationArtifactSha256(artifact),artifact});return Response.json({siteId:options.site.id,articleId:id,requestKey:receipt.requestKey,jobId:receipt.asyncQueue.jobId,status:'complete',continuationOwner:'cloud',receipt:{revision:1,url:receipt.url,publicReadback:true,job:{id:'original-website-job',status:'success'}},continuation:{id:flowId,status:complete?'complete':'waiting'},updatedAt:new Date().toISOString()});}});
 assert.equal((await publisher().runQueued(id)).receipt.asyncQueue.continuation.status,'waiting');complete=true;const completed=(await publisher().runQueued(id)).receipt;assert.equal(completed.asyncQueue.continuation.status,'complete');assert(await readCloudContinuationEvidence({root:options.root,siteId:options.site.id,articleId:id,receipt:completed}));assert.equal(reads,3);await assert.rejects(readFile(join(job.directory,'prepared.json')),error=>error.code==='ENOENT');
 cloud.sourceSha256='c'.repeat(64);await durableWriteJson(join(options.root,'_ops/inventory/article-index.json'),{articles:{},cloudArticles:{[id]:{shortTitle:'原稿',cloud}}});const saved=JSON.parse(await readFile(join(job.directory,'receipt.json'),'utf8'));saved.asyncQueue.continuation={status:'waiting',owner:'cloud'};await durableWriteJson(join(job.directory,'receipt.json'),saved);await assert.rejects(resumePublicationQueue({root:options.root,site:options.site,id},{kick:async()=>assert.fail('Changed archive cannot resume')}),/归档身份已变化/);assert.equal(reads,3);
});
test('failed continuations survive completed-history pruning without automatic attention-task restarts',async t=>{
 const options=await fixture(t),id='english-needs-review',job=await queued(options,id,{owner:'local',phase:'complete',continuation:{owner:'local',id:'d'.repeat(40),status:'queued'}}),state=join(options.root,'.local/publishing-flow/jobs','d'.repeat(40),'state.json');
 await durableWriteJson(state,{status:'needs_review',translation:{status:'failed',error:'Preserved translation requires review'}});await settlePublicationQueue(options.root,options.site,id);
 for(let i=0;i<22;i++){const next='finished-'+i;await queued(options,next,{phase:'complete'});await settlePublicationQueue(options.root,options.site,next);}
 const index=JSON.parse(await readFile(join(options.root,'.local/today/queue-index.json'),'utf8'));assert(index.items[id]);assert.equal(Object.keys(index.history).length,20);assert.equal((await publicationQueueSnapshot(options)).jobs.find(value=>value.articleId===id).status,'needs_review');assert.equal((await publicationRecoveryCandidates(options)).candidates.length,0);
 let kicked=0;await resumePublicationQueue({root:options.root,site:options.site,id},{kick:async()=>kicked++});assert.equal(kicked,1);
 await durableWriteJson(state,{complete:true,status:'waiting',english:{status:'verified'},community:{status:'verified'}});assert.deepEqual((await publicationRecoveryCandidates(options)).candidates.map(value=>value.id),[id]);assert.equal(JSON.parse(await readFile(join(job.directory,'receipt.json'),'utf8')).asyncQueue.continuation.status,'queued');
});
