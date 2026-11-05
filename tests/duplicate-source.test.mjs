import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles,setSiteContext} from '../scripts/site-config.mjs';
import {openStore} from '../admin/store.mjs';
import {submitNews,submitNewsDraft} from '../admin/news-api.mjs';
import {recordMarkdown} from '../scripts/editorial-record.mjs';
import {linkOwner,continuationOwnerFor} from '../scripts/website-publication.mjs';
import {createApp} from '../admin/server.mjs';

const site={...profiles.find(x=>x.id==='enter'),languages:['zh-CN','en']};
const link='https://example.org/project';

function recordRequest(documentId,requestKey,url=link,expectedVersion=0,title='开放课程与工具'){
 const fields={title,date:'2026-10-23',category:site.sourceCategories[0],summary:'完整项目简介。',value:'使用方法与限制。',url,relatedUrl:'',status:'公开收录',sectionId:'courses'};
 const data={id:'record-'+documentId,title:fields.title,summary:fields.summary,markdown:recordMarkdown('openSource',fields),date:fields.date,category:site.columns[2],sectionId:'courses',author:site.author,assets:[],record:{documentId,kind:'openSource',fields}};
 return {requestKey,expectedVersion,expectedPublishedVersion:null,data};
}
const setSite=()=>setSiteContext(site);
async function fixture(t){
 setSiteContext(site);
 const root=await mkdtemp(join(tmpdir(),'duplicate-source-')),db=openStore(join(root,'admin.sqlite'));
 t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
 return db;
}
const counts=db=>({documents:db.prepare('SELECT count(*) AS n FROM documents').get().n,jobs:db.prepare('SELECT count(*) AS n FROM jobs').get().n,requests:db.prepare('SELECT count(*) AS n FROM content_requests').get().n});

test('a second record for an existing resource link is rejected with the existing record named and nothing written',async t=>{
 const db=await fixture(t),first='91e52c25-5d3b-4911-9b24-769157a52079',second='0b0c1d2e-3f40-4a51-8b62-73849a5b6c7d';
 const receipt=submitNews(db,recordRequest(first,'duplicate-first-request'),'today');
 const before=counts(db);
 assert.throws(()=>submitNews(db,recordRequest(second,'duplicate-second-request'),'today'),error=>error.statusCode===409&&error.code==='duplicate_source'&&error.existing.articleId==='record-'+first&&error.existing.path===receipt.url);
 assert.deepEqual(counts(db),before);
 // A draft save for the same link is rejected the same way.
 assert.throws(()=>submitNewsDraft(db,{...recordRequest(second,'duplicate-draft-request'),expectedPublishedVersion:null},'today'),error=>error.code==='duplicate_source');
 assert.deepEqual(counts(db),before);
});

test('updating the existing record and adding a record with another link still work',async t=>{
 const db=await fixture(t),first='91e52c25-5d3b-4911-9b24-769157a52079',second='0b0c1d2e-3f40-4a51-8b62-73849a5b6c7d';
 submitNews(db,recordRequest(first,'update-first-request'),'today');
 assert.doesNotThrow(()=>submitNews(db,recordRequest(second,'update-other-link-request','https://example.org/another',0,'另一个开放项目'),'today'));
 assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n,2);
});

test('the producer finds the record that owns a link and ignores its own record',()=>{
 const owner={key:'openSource:'+link,documentId:'91e52c25-5d3b-4911-9b24-769157a52079',articleId:'record-91e52c25-5d3b-4911-9b24-769157a52079',title:'已有记录'};
 const record={kind:'openSource',documentId:'0b0c1d2e-3f40-4a51-8b62-73849a5b6c7d',fields:{url:link}};
 assert.equal(linkOwner([owner],record),owner);
 assert.equal(linkOwner([owner],{...record,documentId:owner.documentId}),null);
 assert.equal(linkOwner([owner],{...record,fields:{url:'https://example.org/other'}}),null);
 assert.equal(linkOwner([owner],{kind:'history',documentId:record.documentId,fields:{}}),null);
 assert.equal(linkOwner(undefined,record),null);
});

test('the server answers a raw unique-key collision with 409, not a server error',async t=>{
 setSite();
 const root=await mkdtemp(join(tmpdir(),'duplicate-source-http-')),app=await createApp({dbPath:join(root,'admin.sqlite'),origin:site.origin});
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 // Register before the first request: Fastify seals routes once it starts handling them.
 app.get('/manage/test-collision',async()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE t(k TEXT UNIQUE)');db.prepare('INSERT INTO t VALUES(?)').run('a');db.prepare('INSERT INTO t VALUES(?)').run('a');});
 app.get('/manage/test-fault',async()=>{throw new Error('boom');});
 const collision=await app.inject({method:'GET',url:'/manage/test-collision'}),fault=await app.inject({method:'GET',url:'/manage/test-fault'});
 assert.equal(collision.statusCode,409);assert.match(collision.json().error,/重复/);
 assert.equal(fault.statusCode,500);
});

test('desktop pushes hand English to the cloud only for sites the cloud continues',()=>{
 const metho=profiles.find(x=>x.id==='metho'),legis=profiles.find(x=>x.id==='legis');
 assert.equal(continuationOwnerFor(metho,{continuationOwner:'cloud'}),'cloud');
 assert.equal(continuationOwnerFor(legis,{continuationOwner:'cloud'}),'local');
 assert.equal(continuationOwnerFor(metho,{continuationOwner:'local'}),'local');
 assert.equal(continuationOwnerFor(metho,{}),'local');
});
