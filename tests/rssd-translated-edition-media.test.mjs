import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import m from '../contracts/rssd-media.cjs';
import p from '../contracts/rssd-v1.cjs';
import {prepareEditionMedia,completeStoredEdition,stageMedia} from '../scripts/rssd-device-media.mjs';
import {CenterOutbox,CenterError,createCenterClient} from '../scripts/rssd-center-client.mjs';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import {notebookEdition} from '../desktop/scripts/agent/center-notebook.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYZkAAAAASUVORK5CYII=','base64');
const missing=()=>Object.assign(Error('not found'),{status:404});
async function temp(t){const home=await mkdtemp(join(tmpdir(),'rssd-edition-media-'));t.after(()=>rm(home,{recursive:true,force:true}));return home;}
function mediaUrl(origin,id){return origin+'/api/rssd/v1/media/'+id+'/raw';}
function notebookWithImages(title,urls){
 const blocks=[{id:'body',type:'paragraph',state:'ready',text:'Complete bilingual prose about the same two figures.',sourceIds:[]}];
 urls.forEach((url,i)=>blocks.push({id:'image-'+i,type:'image',state:'ready',text:url,alt:'Figure '+(i+1),sourceIds:[]},
  {id:'caption-'+i,type:'annotation',role:'caption',targetId:'image-'+i,state:'ready',text:'Caption '+(i+1),sourceIds:[]}));
 return {version:2,kind:'article',title,skills:[],fields:{},sources:[],blocks,blockNotes:{},internalNotes:{}};
}

test('EN reuse of ZH media IDs fills the edition manifest before submit, including resume and duplicate retry',async t=>{
 const home=await temp(t),origin='https://center.example',workspaceId='pets';
 const first=await stageMedia({directory:join(home,'media'),origin,workspaceId,bytes:png,name:'one'});
 const second=await stageMedia({directory:join(home,'media'),origin,workspaceId,bytes:Buffer.concat([png,Buffer.from([1])]),name:'two'});
 const urls=[mediaUrl(origin,first.id),mediaUrl(origin,second.id)];
 const chinese=notebookEdition({notebook:notebookWithImages('中文标题',urls),summary:'摘要'},{locale:'zh-CN'});
 assert.deepEqual(chinese.media.map(item=>item.id),[first.id,second.id]);
 const englishNotebook=notebookWithImages('English title fix',urls);
 const english=notebookEdition({notebook:englishNotebook,summary:'Summary'},{locale:'en',source:{payload:chinese}});
 assert.deepEqual(english.media.map(item=>item.id),[first.id,second.id]);
 assert.equal(english.media.length,2);
 const job=join(home,'job');
 await mkdir(job,{recursive:true,mode:0o700});
 const prepared=await prepareEditionMedia({edition:{...english,media:[]},home,directory:job,client:{origin},workspaceId,source:chinese});
 assert.deepEqual(prepared.media.map(item=>item.id).sort(),[first.id,second.id].sort());
 p.edition({...prepared,locale:'en'});
 assert.throws(()=>p.submission({requestId:'en-title-fix',workId:'work-pets',workspaceId,sectionId:'pet-news',editions:[{...english,locale:'en',media:[]}]}),{code:'missing_media'});
 const complete=p.submission({requestId:'en-title-fix',workId:'work-pets',workspaceId,sectionId:'pet-news',editions:[{...english,locale:'en'}]});
 const stored={...complete,editions:[{...complete.editions[0],media:[]}]};
 await writeFile(join(job,'en.packet.json'),JSON.stringify(stored));
 const completed=await completeStoredEdition({packet:stored,home,directory:job,client:{origin},source:chinese});
 assert.notEqual(p.hash(completed),p.hash(stored));
 assert.deepEqual(completed.editions[0].media.map(item=>item.id).sort(),[first.id,second.id].sort());
 const client={origin,submission:async()=>{throw missing();},submit:async packet=>{
  p.edition(packet.editions[0]);return {requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',editions:packet.editions.map(e=>({locale:e.locale,revision:1,hash:p.hash(e)}))};
 },request:async path=>{const id=path.split('/').at(-1);const asset=id===first.id?first:id===second.id?second:null;if(!asset)throw missing();return {id:asset.id,workspaceId,manifest:asset.manifest};}};
 const outboxDir=join(home,'outbox');
 await mkdir(outboxDir,{recursive:true,mode:0o700});
 const historical={version:1,origin,requestId:stored.requestId,payloadHash:p.hash(stored),packet:stored,state:'pending',attempts:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 await writeFile(join(outboxDir,p.hash(p.id(stored.requestId))+'.json'),JSON.stringify(historical,null,2)+'\n');
 const outbox=new CenterOutbox({directory:outboxDir,client});
 await assert.rejects(outbox.enqueue(completed),{code:'request_conflict'});
 const repaired=await outbox.repairUnsubmitted(stored.requestId,completed);
 assert.equal(repaired.state,'pending');assert.equal(repaired.packet.editions[0].media.length,2);
 const duplicate=await outbox.repairUnsubmitted(stored.requestId,completed);
 assert.equal(duplicate.payloadHash,repaired.payloadHash);
 const flushed=await outbox.flushOne(stored.requestId,{retry:true});
 assert.equal(flushed.state,'accepted');
 await assert.rejects(outbox.repairUnsubmitted(stored.requestId,completed),/Accepted request cannot change/);
});

test('missing or cross-workspace assets stay rejected and are never fabricated',async t=>{
 const home=await temp(t),origin='https://center.example',id='media-missingasset000000000000000000000000000000';
 const edition={locale:'en',title:'English',bodyMarkdown:'![Gone]('+mediaUrl(origin,id)+')',media:[]};
 assert.throws(()=>p.edition(edition),{code:'missing_media'});
 const listed=await prepareEditionMedia({edition,home,directory:join(home,'job'),client:{origin},workspaceId:'pets'});
 assert.deepEqual(listed.media.map(item=>item.id),[id]);
 const missingClient={origin,submission:async()=>{throw missing();},request:async()=>{throw missing();},submit:async()=>{throw Error('must not submit');}};
 const missingOutbox=new CenterOutbox({directory:join(home,'outbox-missing'),client:missingClient});
 await missingOutbox.enqueue({requestId:'missing-media',workId:'work',workspaceId:'pets',sectionId:'pet-news',editions:[{locale:'en',title:'English',bodyMarkdown:'Body',media:[{id}]}]});
 const missingResult=await missingOutbox.flushOne('missing-media');
 assert.equal(missingResult.state,'needs_attention');assert.equal(missingResult.error.code,'missing_media');
 const asset=await stageMedia({directory:join(home,'media'),origin,workspaceId:'pets',bytes:png});
 const client={origin,submission:async()=>{throw missing();},request:async()=>({id:asset.id,workspaceId:'other-site',manifest:asset.manifest}),submit:async()=>{throw Error('must not submit');}};
 const outbox=new CenterOutbox({directory:join(home,'outbox'),client});
 await outbox.enqueue({requestId:'cross-media',workId:'work',workspaceId:'pets',sectionId:'pet-news',editions:[{locale:'en',title:'English',bodyMarkdown:'Body',media:[{id:asset.id}]}]});
 const result=await outbox.flushOne('cross-media');
 assert.equal(result.state,'needs_attention');assert.equal(result.error.code,'media_conflict');
});

test('device website retry uses editorial requests, not owner publication retry or destinations',async()=>{
 const paths=[];
 const client=createCenterClient({origin:'https://center.example',token:'rssd_device_'+'a'.repeat(48),fetcher:async(url,opts)=>{
  paths.push({method:opts.method||'GET',path:new URL(url).pathname});
  if(String(url).includes('/destinations')||/\/publications\/[^/]+\/retry$/.test(url))return new Response(JSON.stringify({message:'Owner access required',code:'forbidden'}),{status:403});
  return new Response(JSON.stringify({queued:true,centerManaged:true}));
 }});
 const result=await client.editorialRetry('pets','editorial-request-one',{jobId:'job-one'});
 assert.deepEqual(result,{queued:true,centerManaged:true});
 assert.deepEqual(paths,[{method:'POST',path:'/api/rssd/v1/editorial/pets/requests/editorial-request-one/retry'}]);
 await assert.rejects(client.request('/publications/job-one/retry',{method:'POST',body:{}}),{status:403,code:'forbidden'});
 await assert.rejects(client.request('/destinations'),{status:403,code:'forbidden'});
 assert.equal(paths.filter(item=>item.path==='/api/rssd/v1/publications/job-one/retry'||item.path==='/api/rssd/v1/destinations').length,2);
});

test('production turn submits matching media manifests for both locales from reused body refs',async t=>{
 const home=await mkdtemp(join(tmpdir(),'rssd-bilingual-media-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const origin='https://center.example',workspaceId='pets';
 const first=await stageMedia({directory:join(home,'media'),origin,workspaceId,bytes:png,name:'one'});
 const second=await stageMedia({directory:join(home,'media'),origin,workspaceId,bytes:Buffer.concat([png,Buffer.from([2])]),name:'two'});
 const urls=[mediaUrl(origin,first.id),mediaUrl(origin,second.id)];
 const task={id:'demand-pets',generation:1,workspaceId,sectionId:'pet-news',state:'claimed',title:'Pets',kind:'write',claimToken:'claim-pets',payload:{requiredLocales:['zh-CN','en'],submittedLocales:[],policy:{version:1,targets:[]}}};
 const receipts=new Map(),packets=[];
 const client={origin,activeClaim:async()=>task,claim:async()=>task,work:async()=>{throw new CenterError('Not found',{status:404});},
  heartbeat:async()=>{},changeDemand:async()=>{},
  submission:async id=>{if(receipts.has(id))return receipts.get(id);throw new CenterError('Not found',{status:404});},
  submit:async packet=>{packets.push(packet);task.payload.submittedLocales.push(...packet.editions.map(e=>e.locale));const completed=task.payload.requiredLocales.every(locale=>task.payload.submittedLocales.includes(locale));const result={status:'accepted',requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,publicationIds:[],demandState:completed?'completed':'claimed',editions:packet.editions.map(e=>({locale:e.locale,revision:1,hash:p.hash(e)}))};receipts.set(packet.requestId,result);return result;},
  request:async path=>{const id=path.split('/').at(-1);const asset=id===first.id?first:id===second.id?second:null;if(!asset)throw missing();return {id:asset.id,workspaceId,manifest:asset.manifest};}};
 const result=await runProductionTurn({client,home,agentId:'example',workspaceIds:['pets'],producer:async({locale,source})=>{
  if(locale==='en'){assert.equal(packets.length,1);assert.equal(source.payload.media.length,2);}
  return notebookEdition({notebook:notebookWithImages(locale==='zh-CN'?'中文标题':'English title',urls),summary:'Summary'},{locale,source});
 }});
 assert.equal(result.state,'accepted');assert.equal(packets.length,2);
 for(const packet of packets){assert.equal(packet.editions[0].media.length,2);p.edition(packet.editions[0]);}
 assert.deepEqual(packets[1].editions[0].media.map(item=>item.id).sort(),packets[0].editions[0].media.map(item=>item.id).sort());
});
