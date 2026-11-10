import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles,setSiteContext} from '../scripts/site-config.mjs';
import {validateNews,newsFingerprint} from '../admin/news.mjs';
import {editionArticleId,sourceContentSha256} from '../contracts/language-editions.mjs';
import {openStore,createDocument,setReview,enqueue,claim,finish,readDocument,saveDocument} from '../admin/store.mjs';
import {submitNews,retryNews} from '../admin/news-api.mjs';

const site={...profiles.find(x=>x.id==='metho'),languages:['zh-CN','en']};setSiteContext(site);
const original={id:'test-language-source',title:'研究方法原稿',summary:'保持中文原稿和逐篇链接。',markdown:'# 研究方法原稿\n\n样本共有 120 人，效应为 0.25。\n\n[来源](https://example.org/source)',date:'2026-10-22',category:site.columns[0],author:site.author,assets:[]};
const translated=(source=original,revision=1)=>({...source,id:editionArticleId(source.id,'en'),title:'Research methods',summary:'An English edition of the Chinese source.',markdown:'# Research methods\n\nThe sample includes 120 people and the effect is 0.25.\n\n[Source](https://example.org/source)',locale:'en',translationOf:{articleId:source.id,revision,sha256:sourceContentSha256(source)}});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-editions-'));const db=openStore(join(root,'admin.sqlite'));t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});const row=createDocument(db,'news',original,'author');setReview(db,row.id,1,'approved','author');const queued=enqueue(db,row.id,1,'publish',Date.now(),'author'),job=claim(db);finish(db,queued.id,{ok:true,hash:job.snapshot_hash,release:'admin-'+queued.id});return {db,row};}

test('English has a deterministic identity, independent URL and receipt; retry never creates another article',async t=>{
 const {db,row}=await fixture(t),data=translated();
 const request={data,requestKey:'language-request-first',expectedVersion:0,expectedPublishedVersion:null};
 const result=submitNews(db,request,'today-pilot');
 assert.equal(result.url,'/en/news/'+original.id+'/');
 assert.deepEqual(submitNews(db,request,'today-pilot'),result);
 const job=claim(db);assert.equal(job.document_id,result.id);finish(db,job.id,{ok:true,hash:job.snapshot_hash,release:'admin-'+job.id});
 assert.equal(readDocument(db,row.id).latest_revision,1);
 assert.deepEqual(readDocument(db,row.id).published,validateNews(original));
 assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n,2);
});

test('a late translation cannot publish after the Chinese administrator edits the source',async t=>{
 const {db,row}=await fixture(t);saveDocument(db,row.id,{...original,summary:'管理员的新摘要'},1,'administrator');
 assert.throws(()=>submitNews(db,{data:translated(),requestKey:'late-language-request',expectedVersion:0},'today-pilot'),/中文版本已变化/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n,1);
});

test('a queued translation is stopped before building when its source changes',async t=>{
 const {db,row}=await fixture(t);const result=submitNews(db,{data:translated(),requestKey:'queued-language-request',expectedVersion:0},'today-pilot');
 saveDocument(db,row.id,{...original,summary:'另一个管理员修订'},1,'administrator');
 assert.equal(claim(db),null);
 assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(result.job.id).status,'failed');
 assert.equal(readDocument(db,result.id).published_revision,null);
});

test('old edits retain edition identity and disabled sites reject English without changing Chinese normalization',()=>{
 const data=validateNews(translated());
 const {locale,translationOf,...legacy}=data;
 assert.equal(validateNews(legacy,data).locale,'en');
 assert.throws(()=>validateNews({...data,locale:'zh-CN'},data),/不能改变既有译文/);
 assert.throws(()=>validateNews({...data,id:'another-english-record'}),/译文编号/);
 assert.throws(()=>validateNews(data,null,{...site,languages:['zh-CN']}),/尚未启用/);
 assert.deepEqual(Object.keys(validateNews(original)),['id','title','summary','markdown','date','category','author','assets']);
});


test('failed build retry is request-bound, idempotent and refuses changed Chinese source',async t=>{
 const {db,row}=await fixture(t),key='retry-language-request';
 const originalJob=submitNews(db,{data:translated(),requestKey:key,expectedVersion:0},'today-pilot');const job=claim(db);finish(db,job.id,{ok:false,error:'temporary build failure'});
 assert.throws(()=>retryNews(db,key,job.id,'another-actor'),/不存在/);
 const retry=retryNews(db,key,job.id,'today-pilot');assert.notEqual(retry.job.id,job.id);
 assert.deepEqual(retryNews(db,key,job.id,'today-pilot'),retry);
 const second=claim(db);finish(db,second.id,{ok:false,error:'still unavailable'});
 saveDocument(db,row.id,{...original,summary:'changed'},1,'administrator');
 assert.throws(()=>retryNews(db,key,second.id,'today-pilot'),/中文版本已变化/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n,2);
});
