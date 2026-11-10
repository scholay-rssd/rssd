import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {createHmac} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCommunityLinks,registerCommunityLinks,sourceFromPost,normalizedSource} from '../admin/community-links.mjs';
const secret='community-test-secret-for-signatures-only',source='https://metho.scholay.com/news/example/';
function cleanup(t,root,close){t.after(async()=>{await close?.();await rm(root,{recursive:true,force:true});});}
const sign=raw=>'sha256='+createHmac('sha256',secret).update(raw).digest('hex');
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'community-links-')),webRoot=join(root,'web');
  await mkdir(join(webRoot,'news/example'),{recursive:true});await writeFile(join(webRoot,'news/example/index.html'),'original published article');
  const config={mode:'pilot',sources:[source],authors:['学爸君'],sites:[{id:'metho',origin:'https://metho.scholay.com',webRoot}]};
  await writeFile(join(root,'config.json'),JSON.stringify(config));
  const options={root,secret,flushDelayMs:60000};return {root,config,options};
}
const post=(overrides={})=>({topic_id:415123,post_number:1,username:'学爸君',cooked:'<p>Full body and other <a href="https://metho.scholay.com/news/other/">link</a></p><hr><small>这是一个从 <a href="'+source+'">原文</a> 下的原始话题分离的讨论话题</small>',...overrides});
function event(p=post(),id='event-1',type='post_created'){
  const raw=Buffer.from(JSON.stringify({post:p}));return {raw,signature:sign(raw),eventId:id,eventType:type,instance:'https://enterscholar.com'};
}
test('provenance matching uses the explicit importer footer and rejects unsafe source routes',()=>{
  assert.equal(sourceFromPost(post()),source);
  assert.equal(sourceFromPost({raw:'[source]('+source+')'}),null);
  assert.equal(sourceFromPost({cooked:'<small>an unrelated reference <a href="'+source+'">source</a></small>'}),null);
  for(const url of ['https://evil.example/news/a/','https://metho.scholay.com/manage/','https://metho.scholay.com/news/a/?x=1','https://metho.scholay.com/news/a/#b','https://x@metho.scholay.com/news/a/','https://metho.scholay.com/news/%2e%2e/','https://metho.scholay.com/news/a%2fb/'])assert.equal(normalizedSource(url),null,url);
  assert.equal(normalizedSource(source).route,'/news/example/');
});
test('signed events create one cached mapping without editing the article or publication database',async t=>{
  const {root,options}=await fixture(t),links=createCommunityLinks(options);cleanup(t,root,()=>links.close());
  assert.equal(links.receive({...event(),signature:'sha256='+'0'.repeat(64)}).statusCode,401);
  assert.equal(links.receive({...event(),instance:'https://other.example'}).statusCode,403);
  assert.equal(links.receive(event()).body.status,'linked');await links.flush();
  const file=join(root,'public/metho/links.json'),before=await stat(file);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{version:1,links:{'/news/example/':'https://enterscholar.com/t/-/415123'}});
  assert.equal(links.receive(event()).body.status,'duplicate');
  assert.equal(links.receive(event(post(),'another-delivery')).body.status,'unchanged');await links.flush();
  assert.equal((await stat(file)).mtimeMs,before.mtimeMs,'duplicate events must not rewrite static metadata');
  assert.equal(await readFile(join(root,'web/news/example/index.html'),'utf8'),'original published article');
  assert.equal(links.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('documents','revisions','jobs','site_jobs')").get().n,0);
});
test('comments, private topics, unrelated authors, unpublished sources and out-of-pilot articles do not bind',async t=>{
  const {root,options}=await fixture(t),links=createCommunityLinks(options);cleanup(t,root,()=>links.close());
  const candidates=[post({post_number:2}),post({username:'someone-else'}),post({archetype:'private_message'}),post({cooked:'<small>这是一个从 <a href="https://metho.scholay.com/news/unpublished/">原文</a> 下的原始话题分离的讨论话题</small>'}),post({cooked:'<p>not an imported article</p>'})];
  for(const [i,p] of candidates.entries())assert.equal(links.receive(event(p,'ignore-'+i)).body.status,'ignored');
  assert.equal(links.db.prepare('SELECT count(*) AS n FROM links').get().n,0);
});
test('topic conflicts are not silently rebound; deletion removes the cached link and recovery restores it',async t=>{
  const {root,options}=await fixture(t),links=createCommunityLinks(options);cleanup(t,root,()=>links.close());
  links.receive(event());
  assert.equal(links.receive(event(post({topic_id:999}),'conflict')).body.status,'conflict');
  assert.equal(links.receive(event(post(),'deleted','post_destroyed')).body.status,'removed');await links.flush();
  assert.deepEqual(JSON.parse(await readFile(join(root,'public/metho/links.json'),'utf8')).links,{});
  assert.equal(links.receive(event(post(),'restored','post_recovered')).body.status,'linked');await links.flush();
});
test('pilot can promote using configuration only and committed links recover on restart',async t=>{
  const {root,config,options}=await fixture(t);await mkdir(join(root,'web/news/second'),{recursive:true});await writeFile(join(root,'web/news/second/index.html'),'second article');
  const other=post({topic_id:999,cooked:'<small>这是一个从 <a href="https://metho.scholay.com/news/second/">原文</a> 下的原始话题分离的讨论话题</small>'});
  let links=createCommunityLinks(options);cleanup(t,root,()=>links.close());assert.equal(links.receive(event(other,'before')).body.status,'ignored');
  await writeFile(join(root,'config.json'),JSON.stringify({...config,mode:'all'}));
  assert.equal(links.receive(event(other,'after')).body.status,'linked');await links.close();
  await rm(join(root,'public'),{recursive:true,force:true});links=createCommunityLinks(options);await links.flush();
  assert.equal(JSON.parse(await readFile(join(root,'public/metho/links.json'),'utf8')).links['/news/second/'],'https://enterscholar.com/t/-/999');
});
test('Fastify webhook verifies raw bytes while ordinary JSON routes retain their parser',async t=>{
  const {root,options}=await fixture(t),app=Fastify();await registerCommunityLinks(app,options);app.post('/ordinary',async req=>({value:req.body.value}));cleanup(t,root,()=>app.close());
  const e=event();const response=await app.inject({method:'POST',url:'/manage/api/community/discourse',headers:{'content-type':'application/json','x-discourse-event-signature':e.signature,'x-discourse-event-id':e.eventId,'x-discourse-event':e.eventType,'x-discourse-instance':e.instance},payload:e.raw});
  assert.equal(response.statusCode,200,response.body);assert.equal(response.json().status,'linked');
  assert.deepEqual((await app.inject({method:'POST',url:'/ordinary',payload:{value:42}})).json(),{value:42});
  const ping=Buffer.from('{"ping":"OK"}');assert.equal((await app.inject({method:'POST',url:'/manage/api/community/discourse',headers:{'content-type':'application/json','x-discourse-event-signature':sign(ping),'x-discourse-event':'ping'},payload:ping})).json().status,'pong');
});
test('topic metadata events read the first post only on the first binding',async t=>{
  const {root,config,options}=await fixture(t);await writeFile(join(root,'config.json'),JSON.stringify({...config,topicIds:[415123]}));
  let reads=0;const links=createCommunityLinks({...options,lookupPost:async()=>{reads++;return post();}});cleanup(t,root,()=>links.close());
  function topicEvent(id){const raw=Buffer.from(JSON.stringify({topic:{id:415123,archetype:'regular',created_by:{username:'学爸君'}}}));return {raw,signature:sign(raw),eventId:id,eventType:'topic_edited'};}
  assert.equal((await links.accept(topicEvent('metadata-1'))).body.status,'linked');
  assert.equal((await links.accept(topicEvent('metadata-2'))).body.status,'unchanged');
  assert.equal(reads,1);
  const deleted=topicEvent('metadata-3');deleted.eventType='topic_destroyed';assert.equal((await links.accept(deleted)).body.status,'removed');
  assert.equal(reads,1);
});
test('a webhook burst permits two public lookups and leaves further deliveries retryable',async t=>{
  const {root,config,options}=await fixture(t);await writeFile(join(root,'config.json'),JSON.stringify({...config,mode:'all'}));
  const pending=[];const links=createCommunityLinks({...options,lookupPost:id=>new Promise(done=>pending.push(()=>done(post({topic_id:id}))))});cleanup(t,root,()=>links.close());
  const incoming=id=>{const raw=Buffer.from(JSON.stringify({topic:{id,archetype:'regular',created_by:{username:'学爸君'}}}));return {raw,signature:sign(raw),eventId:'burst-'+id,eventType:'topic_edited'};};
  const one=links.accept(incoming(1)),two=links.accept(incoming(2));assert.equal((await links.accept(incoming(3))).statusCode,503);assert.equal(pending.length,2);
  pending.forEach(done=>done());assert.deepEqual((await Promise.all([one,two])).map(r=>r.body.status),['linked','conflict']);
  assert.equal(links.db.prepare("SELECT count(*) AS n FROM events WHERE id='burst-3'").get().n,0);
});
test('static metadata remains readable under the production service private umask',{skip:process.platform==='win32'},async t=>{
  const {root,options}=await fixture(t),previous=process.umask(0o077);let links;cleanup(t,root);
  try{links=createCommunityLinks(options);links.receive(event());await links.flush();
    assert.equal((await stat(join(root,'public/metho/links.json'))).mode&0o777,0o644);
    assert.equal((await stat(join(root,'public/metho'))).mode&0o777,0o755);
    assert.equal((await stat(join(root,'links.sqlite'))).mode&0o777,0o600);
  }finally{await links?.close();process.umask(previous);}
});
