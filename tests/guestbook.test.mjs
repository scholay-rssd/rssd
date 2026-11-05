import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openGuestbook} from '../admin/guestbook/store.mjs';
import {registerGuestbook} from '../admin/guestbook/api.mjs';
import {guestbookConfig,FORMS} from '../admin/guestbook/config.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {createApp} from '../admin/server.mjs';
async function fixture(t,id='lingxi',{english=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'today-guestbook-'));const path=join(dir,'guestbook.sqlite');
 const publicRoot=join(dir,'public');if(english){await mkdir(join(publicRoot,'current/en'),{recursive:true});await writeFile(join(publicRoot,'current/en/index.html'),'<h1>English</h1>');}
 let time=Date.parse('2026-10-14T15:59:00Z'),db,app;
 const site=profiles.find(s=>s.id===id),origin=site.origin;
 async function open(){db=openGuestbook(path,id);app=Fastify();await app.register(cookie);registerGuestbook(app,{db,site,origin,publicRoot,now:()=>time,session:r=>{if(r.headers['x-test-admin']!=='admin')throw Object.assign(Error('unauthorized'),{statusCode:401});if(r.method!=='GET'&&(r.headers.origin!==origin||r.headers['x-csrf-token']!=='test-csrf'))throw Object.assign(Error('csrf'),{statusCode:403});return {username:'owner'};}});}
 await open();t.after(async()=>{await app.close();db.close();await rm(dir,{recursive:true,force:true});});
 async function identity(){const r=await app.inject('/guestbook/api/session');return {cookie:r.cookies.map(c=>c.name+'='+c.value).join('; '),csrf:r.json().csrf,response:r};}
 const who=await identity();
 const payload=(changes={})=>({kind:guestbookConfig(site).forms[0].id,name:'测试访客',message:'<img src=x onerror=alert(1)>公开内容',contact:'private@example.org',details:Object.fromEntries(guestbookConfig(site).forms[0].fields.map(f=>[f.key,'私有补充 '+f.key])),requestKey:randomUUID(),...changes});
 const post=(p,headers={},actor=who)=>app.inject({method:'POST',url:'/guestbook/api/messages',headers:{origin,cookie:actor.cookie,'x-guestbook-csrf':actor.csrf,...headers},payload:p});
 return {get app(){return app;},get db(){return db;},site,path,who,payload,post,identity,nextDay:()=>time+=120000,restart:async()=>{await app.close();db.close();await open();}};
}
test('two per site day persists across reload/restart; concurrent tabs and rejected messages cannot bypass quota',async t=>{
 const f=await fixture(t);const replies=await Promise.all([f.post(f.payload()),f.post(f.payload()),f.post(f.payload())]);assert.deepEqual(replies.map(x=>x.statusCode).sort(),[201,201,429]);
 const id=replies.find(x=>x.statusCode===201).json().id;
 assert.equal((await f.app.inject({method:'POST',url:'/manage/api/guestbook/'+id+'/review',headers:{'x-test-admin':'admin','x-csrf-token':'test-csrf',origin:f.site.origin},payload:{status:'rejected'}})).statusCode,200);
 await f.restart();assert.equal((await f.post(f.payload())).statusCode,429);
 f.nextDay();assert.equal((await f.post(f.payload())).statusCode,201);
});
test('idempotent retry survives midnight and does not use another slot; changed payload is refused',async t=>{
 const f=await fixture(t);const p=f.payload(),one=await f.post(p);assert.equal(one.statusCode,201);f.nextDay();const retry=await f.post(p);assert.equal(retry.statusCode,200);assert.equal(retry.json().id,one.json().id);assert.equal(retry.json().remaining,2);
 assert.equal((await f.post({...p,message:'different'})).statusCode,409);
});
test('moderation hides drafts, contact and all private details; requires admin session and CSRF',async t=>{
 const f=await fixture(t);const created=await f.post(f.payload());assert.equal((await f.app.inject('/guestbook/api/messages')).json().messages.length,0);
 assert.equal((await f.app.inject('/manage/api/guestbook')).statusCode,401);
 const url='/manage/api/guestbook/'+created.json().id+'/review';assert.equal((await f.app.inject({method:'POST',url,headers:{'x-test-admin':'admin'},payload:{status:'approved'}})).statusCode,403);
 assert.equal((await f.app.inject({method:'POST',url,headers:{'x-test-admin':'admin','x-csrf-token':'test-csrf',origin:f.site.origin},payload:{status:'approved'}})).statusCode,200);
 const pub=(await f.app.inject('/guestbook/api/messages')).json().messages[0];assert.deepEqual(Object.keys(pub).sort(),['created','id','kind','message','name']);assert(!JSON.stringify(pub).includes('private@example.org'));assert(!JSON.stringify(pub).includes('私有补充'));
 const script=await f.app.inject('/guestbook/app.js');assert(!script.body.includes('innerHTML'));assert(script.body.includes('textContent=m.message'));
});
test('signed visitor cookies, same-origin and strict field validation protect submission',async t=>{
 const f=await fixture(t);assert.match(f.who.response.headers['set-cookie'],/HttpOnly/);assert.match(f.who.response.headers['set-cookie'],/Secure/);assert.match(f.who.response.headers['set-cookie'],/SameSite=Strict/);
 assert.equal((await f.post(f.payload(),{origin:'https://other.example'})).statusCode,403);
 assert.equal((await f.post(f.payload(),{cookie:'__Host-today-guest-lingxi=forged'})).statusCode,403);
 assert.equal((await f.post(f.payload(),{'x-guestbook-csrf':'中'.repeat(64)})).statusCode,403);
 for(const p of [f.payload({details:{}}),f.payload({message:''}),f.payload({kind:'story'}),f.payload({contact:'x'.repeat(201)}),f.payload({details:{unknown:'x'}}),{...f.payload(),status:'approved'}])assert.equal((await f.post(p)).statusCode,400);
 assert.equal((await f.post(f.payload())).json().remaining,1);
});
test('all configured guestbook sites have their own forms and separate visitor quotas; store cannot be reused for another site',async t=>{
 for(const site of profiles.filter(s=>FORMS[s.id])){const f=await fixture(t,site.id);const p=f.payload();assert.equal((await f.post(p)).statusCode,201);assert.equal((await f.post(f.payload())).statusCode,201);assert.equal((await f.post(f.payload())).statusCode,429);assert.throws(()=>openGuestbook(f.path,site.id==='pets'?'lingxi':'pets'),/another site/);}
});

test('public guestbooks share the current site identity while the private inbox stays private',async t=>{
 for(const site of profiles.filter(s=>FORMS[s.id])){
  const f=await fixture(t,site.id),html=(await f.app.inject('/guestbook/')).body;
  assert.ok(html.includes('property="og:url" content="'+site.origin+'/guestbook/"'));
  assert.ok(html.includes('property="og:site_name" content="'+site.name+'"'));
  assert.match(html,/<meta name="twitter:image" content="https:\/\//);
  assert.doesNotMatch((await f.app.inject('/manage/guestbook/')).body,/property="og:/);
 }
});
test('dynamic guestbooks use the shared control only for English content that actually exists',async t=>{
 const bilingual=await fixture(t,'enter',{english:true}),untranslated=await fixture(t,'lingxi');
 const html=(await bilingual.app.inject('/guestbook/')).body;
 assert.equal((html.match(/class="site-language-control"/g)||[]).length,1);assert.match(html,/href="\/site-language\.css"/);assert.match(html,/href="\/en\/"/);assert.match(html,/<small>目录<\/small>/);
 const unavailable=(await untranslated.app.inject('/guestbook/')).body;assert.match(unavailable,/aria-disabled="true"/);assert.doesNotMatch(unavailable,/href="\/en\/"/);
 assert.doesNotMatch((await bilingual.app.inject('/manage/guestbook/')).body,/site-language/);
});

test('guestbooks retain their base stylesheet and serve navigation styles allowed by their CSP',async t=>{
 const {readFile}=await import('node:fs/promises');
 const academic=profiles.find(s=>s.legacy),original=await readFile('web/guestbook/style.css','utf8');
 for(const site of profiles.filter(s=>FORMS[s.id])){
  const f=await fixture(t,site.id),response=await f.app.inject('/guestbook/style.css');
  assert.equal(response.statusCode,200);
  assert.match(response.headers['content-type'],/text\/css/);
  assert.ok(response.body.startsWith(original));assert.match(response.body,/\.guestbook-header\{display:grid/);
  if(site.id===academic.id)assert.match(response.body,/\.academic-nav\{display:flex/);
  else assert.match(response.body,/color-scheme:light dark/);
  assert.doesNotMatch((await f.app.inject('/guestbook/')).body,/<style\b/);
 }
});

test('academic guestbook retains the same navigation destinations without changing other sites',async t=>{
 const academic=await fixture(t,'scholay-today'),other=await fixture(t,'lingxi');
 const html=(await academic.app.inject('/guestbook/')).body;
 const nav=html.match(/<nav class="academic-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
 assert.deepEqual([...nav.matchAll(/<a[^>]*>(.*?)<\/a>/g)].map(m=>m[1]),['首页','今日学术','昔日学术','学术新闻','留言板']);
 assert.match(nav,/data-nav="guestbook" class="active" aria-current="page"/);
 assert.doesNotMatch((await other.app.inject('/guestbook/')).body,/academic-nav/);
});
test('guestbook is opt-in and independent of publication database in real admin application',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'today-guestbook-admin-'));
 const dbPath=join(dir,'admin.sqlite');let app=await createApp({dbPath,guestbookEnabled:false});t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});assert.equal((await app.inject('/guestbook/')).statusCode,404);await app.close();
 app=await createApp({dbPath,guestbookEnabled:true});assert.equal((await app.inject('/guestbook/')).statusCode,200);assert.equal((await app.inject('/manage/api/guestbook')).statusCode,401);assert.equal(app.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='messages'").get().n,0);assert.equal(app.db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
});
