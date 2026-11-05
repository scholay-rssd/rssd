import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import protocol from '../contracts/rssd-v1.cjs';
import {CenterOutbox,writeCenterJson} from '../scripts/rssd-center-client.mjs';
import {centerDesktopCall} from '../desktop/scripts/rssd-center.mjs';
import {expectedReferenceRevision,preparedReferencePreview,submitPreparedReferenceRevision} from '../scripts/rssd-prepared-reference-revision.mjs';
import {withFileLock} from '../scripts/editorial-lock.mjs';
import {notebookMarkdown} from '../desktop/scripts/agent/notebook.mjs';

async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'rssd-reference-review-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const body='# Title\n\nAn [example](https://example.org/a?utm_source=track).\n\n### References\n\n1. [Source B](https://example.org/b)\n';
 const notebook={version:2,kind:'article',title:'Title',blocks:[{id:'p',type:'paragraph',state:'ready',text:'An [example](https://example.org/a?utm_source=track).',sourceIds:['a','b'],locked:true}],sources:[{id:'a',title:'Source A',url:'https://example.org/a'},{id:'b',title:'Source B',url:'https://example.org/b'}],blockNotes:{p:{notes:{verification:'Private'}}},internalNotes:{verification:'Keep this'}};
 const current=protocol.edition({locale:'zh-CN',title:'Title',bodyMarkdown:body,summary:'Summary',sources:notebook.sources.map(s=>({title:s.title,url:s.id==='a'?s.url+'?utm_source=track':s.url})),metadata:{notebook,notebookBodyHash:protocol.hash(body)}});
 const packet=protocol.submission({requestId:'stable-request',workId:'work-one',workspaceId:'metho',sectionId:'methods',baseRevisions:{'zh-CN':1},editions:[expectedReferenceRevision(current)]});
 const data={version:1,state:'prepared_not_submitted',binding:{origin:'https://center.example',orgId:'org',workerId:'device'},source:{revision:1,sourceContentHash:protocol.hash(current)},packet:structuredClone(packet)};
 const file=join(home,'prepared-reference-revision.json'),save=()=>writeFile(file,JSON.stringify(data),{mode:0o600});await save();
 let receipt=null,posted=0,reads=0;const identity={orgId:'org',workerId:'device',workspaceIds:['metho']};
 const client={origin:'https://center.example',identity:async()=>identity,work:async()=>{reads++;return {id:'work-one',workspaceId:'metho',sectionId:'methods',editions:[{locale:'zh-CN',revision:1,payload:current}]};},submission:async()=>{if(!receipt)throw Object.assign(Error('missing'),{status:404});return receipt;},submit:async p=>{posted++;receipt={status:'accepted',requestId:p.requestId,workId:p.workId,workspaceId:p.workspaceId,editions:p.editions.map(e=>({locale:e.locale,revision:2,hash:protocol.hash(e)})),publicationIds:[]};return receipt;}};
 const outbox=new CenterOutbox({directory:join(home,'outbox'),client});return {home,current,packet,data,file,save,client,identity,outbox,get posted(){return posted;},get reads(){return reads;}};
}

test('private prepared revision verifies source, preserves notes, submits once and recovers original request',async t=>{
 const f=await fixture(t),preview=await preparedReferencePreview(f.home);assert.equal(preview.baseRevision,1);assert.equal(preview.requestId,'stable-request');
 const result=await submitPreparedReferenceRevision(f);assert.equal(result.state,'accepted');assert.equal(f.posted,1);
 assert.equal(result.packet.editions[0].metadata.notebook.blocks[0].locked,true);assert.deepEqual(result.packet.editions[0].metadata.notebook.blockNotes,f.current.metadata.notebook.blockNotes);
 assert.equal(result.packet.editions[0].sources[0].url,'https://example.org/a');
 assert.equal(result.packet.editions[0].bodyMarkdown,notebookMarkdown(result.packet.editions[0].metadata.notebook,{site:null,locale:'zh-CN'}));
 assert.equal((await submitPreparedReferenceRevision(f)).state,'accepted');assert.equal(f.posted,1);assert.equal(f.reads,1);
});
test('reference-only correction refuses unrelated body divergence and altered existing citation detail',async t=>{
 const f=await fixture(t),current=structuredClone(f.current);
 current.bodyMarkdown=current.bodyMarkdown.replace('An [example]','An unauthorized [example]');current.metadata.notebookBodyHash=protocol.hash(current.bodyMarkdown);
 assert.throws(()=>expectedReferenceRevision(current),/正文与 notebook 不一致/);
 const source=structuredClone(f.current);source.bodyMarkdown=source.bodyMarkdown.replace('[Source B]','[Different citation detail]');source.metadata.notebookBodyHash=protocol.hash(source.bodyMarkdown);
 assert.throws(()=>expectedReferenceRevision(source),/改变原有参考文献详情/);
 const paragraph=structuredClone(f.current);paragraph.bodyMarkdown=paragraph.bodyMarkdown.replace('1. [Source B]','[Different citation detail]');paragraph.metadata.notebookBodyHash=protocol.hash(paragraph.bodyMarkdown);
 assert.throws(()=>expectedReferenceRevision(paragraph),/改变原有参考文献详情/);
 assert.equal(f.posted,0);
});
test('identity, revision, content, notes and lock mismatch never post',async t=>{
 const f=await fixture(t);f.data.binding.orgId='different';await f.save();await assert.rejects(submitPreparedReferenceRevision(f),/不一致/);assert.equal(f.posted,0);
 f.data.binding.orgId='org';f.data.packet.editions[0].metadata.notebook.blockNotes.p.notes.verification='replaced';await f.save();await assert.rejects(submitPreparedReferenceRevision(f),/超出/);assert.equal(f.posted,0);
 f.data.packet=f.packet;await f.save();const actual=f.client.work;f.client.work=async()=>({...await actual(),editions:[{locale:'zh-CN',revision:2,payload:f.current}]});await assert.rejects(submitPreparedReferenceRevision(f),/已改变/);assert.equal(f.posted,0);
 await withFileLock(join(f.home,'daemon.lock'),async()=>assert.rejects(submitPreparedReferenceRevision(f)));assert.equal(f.posted,0);
});
test('unknown original request is queried before retry and its identity is preserved',async t=>{
 const f=await fixture(t);await f.outbox.enqueue(f.packet);let calls=0;f.client.submission=async()=>{calls++;throw Object.assign(Error('offline'),{code:'network_error'});};
 await assert.rejects(submitPreparedReferenceRevision(f),/offline/);assert.equal(calls,1);assert.equal(f.posted,0);assert.equal((await f.outbox.list())[0].requestId,'stable-request');
});

test('desktop bridge submits the complete private revision through an authenticated isolated HTTP center',async t=>{
 const f=await fixture(t),calls=[];let receipt;const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;calls.push({method:req.method,path:req.url,authorization:req.headers.authorization});res.setHeader('content-type','application/json');
  if(req.url==='/api/rssd/v1/identity')return res.end(JSON.stringify(f.identity));
  if(req.url==='/api/rssd/v1/works/work-one')return res.end(JSON.stringify({id:'work-one',workspaceId:'metho',sectionId:'methods',editions:[{locale:'zh-CN',revision:1,payload:f.current}]}));
  if(req.url==='/api/rssd/v1/submissions/stable-request'){if(receipt)return res.end(JSON.stringify(receipt));res.statusCode=404;return res.end('{}');}
  if(req.url==='/api/rssd/v1/submissions'&&req.method==='POST'){const packet=JSON.parse(body);receipt={status:'accepted',requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,publicationIds:[],editions:packet.editions.map(e=>({locale:e.locale,revision:2,hash:protocol.hash(e)}))};return res.end(JSON.stringify(receipt));}
  res.statusCode=404;res.end('{}');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port,token='rssd_device_'+'a'.repeat(48);f.data.binding.origin=origin;await f.save();await writeCenterJson(join(f.home,'connection.json'),{origin,token,identity:f.identity});
 const result=await centerDesktopCall('submit_prepared_revision',{},f.home);assert.equal(result.state,'accepted');assert.equal(result.requestId,'stable-request');assert.equal(calls.filter(x=>x.method==='POST').length,1);assert(calls.every(x=>x.authorization==='Bearer '+token));
 assert(!JSON.stringify(await centerDesktopCall('status',{},f.home)).includes(token));
});
