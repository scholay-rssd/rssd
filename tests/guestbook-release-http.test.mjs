import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openGuestbook} from '../admin/guestbook/store.mjs';
import {registerGuestbook} from '../admin/guestbook/api.mjs';
import {verifyLive} from '../admin/release-verification.mjs';
import {digest} from '../admin/model.mjs';
import {attachGuestbook} from '../web/engine/guestbook-page.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {FORMS} from '../contracts/guestbook.mjs';

test('real HTTP publication checks every guestbook artifact while preserving dynamic routes and old releases',async t=>{
 for(const site of profiles.filter(s=>FORMS[s.id]))await t.test(site.id,async t=>{
  const dir=await mkdtemp(join(tmpdir(),'guestbook-release-http-')),root=join(dir,'public'),current=join(root,'current');
  await mkdir(current,{recursive:true});
  const db=openGuestbook(join(dir,'guestbook.sqlite'),site.id),app=Fastify();await app.register(cookie);
  registerGuestbook(app,{db,site,origin:site.origin,publicRoot:root,session:()=>{throw Object.assign(Error('unauthorized'),{statusCode:401});}});
  app.get('/release.json',async(_req,reply)=>reply.type('application/json').send(await readFile(join(current,'release.json'))));
  app.get('/ordinary.html',async(_req,reply)=>reply.type('text/html').send(await readFile(join(current,'ordinary.html'))));
  app.get('/en/index.html',async(_req,reply)=>reply.type('text/html').send(await readFile(join(current,'en/index.html'))));
  const origin=await app.listen({port:0,host:'127.0.0.1'});
  t.after(async()=>{await app.close();db.close();await rm(dir,{recursive:true,force:true});});
  assert.equal((await fetch(origin+'/guestbook/')).status,200);
  assert.equal((await fetch(origin+'/guestbook/app.js')).status,200);
  assert.equal((await fetch(origin+'/guestbook/style.css')).status,200);
  assert.equal((await fetch(origin+'/guestbook/index.html')).status,404);
  assert.equal((await fetch(origin+'/guestbook/config.json')).status,404);
  const manifest={jobId:'synthetic',snapshotHash:'test',release:'fixture',hashes:{'ordinary.html':digest('ordinary')}};
  await writeFile(join(current,'ordinary.html'),'ordinary');
  if(site.id==='enter'){await mkdir(join(current,'en'));await writeFile(join(current,'en/index.html'),'English');manifest.hashes['en/index.html']=digest('English');}
  await attachGuestbook({target:current,site:{...site,services:{guestbook:{enabled:true}}},manifest});
  await writeFile(join(current,'release.json'),JSON.stringify(manifest));
  for(const name of ['index.html','style.css','app.js','config.json']){
   const response=await fetch(origin+'/guestbook/'+name);
   assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(join(current,'guestbook',name)));
  }
  const page=await fetch(origin+'/guestbook/');assert.equal(page.status,200);
  const html=await page.text();assert.equal(html,await readFile(join(current,'guestbook/index.html'),'utf8'));
  assert.match(html,/class="site-language-control"/);
  if(site.id==='enter')assert.match(html,/href="\/en\/"/);else assert.match(html,/aria-disabled="true"/);
  const session=await fetch(origin+'/guestbook/api/session'),cookieHeader=session.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),body=await session.json();
  assert.equal(session.status,200);
  const form=body.config.forms[0],payload={kind:form.id,name:'测试访客',message:'合成留言',contact:'',details:Object.fromEntries(form.fields.map(f=>[f.key,'测试'])),requestKey:randomUUID()};
  const post=()=>fetch(origin+'/guestbook/api/messages',{method:'POST',headers:{origin:site.origin,cookie:cookieHeader,'content-type':'application/json','x-guestbook-csrf':body.csrf},body:JSON.stringify(payload)});
  const created=await post(),receipt=await created.json();assert.equal(created.status,201);
  const replay=await post();assert.equal(replay.status,200);assert.equal((await replay.json()).id,receipt.id);
  assert.equal((await fetch(origin+'/guestbook/api/messages')).status,200);
  assert.equal((await fetch(origin+'/manage/api/guestbook')).status,401);
  assert.equal((await verifyLive(manifest,origin,false)).files,site.id==='enter'?7:6);
  const style=await readFile(join(current,'guestbook/style.css'));
  await writeFile(join(current,'guestbook/style.css'),'corrupt');
  await assert.rejects(verifyLive(manifest,origin,false),/校验失败：guestbook\/style.css/);
  await writeFile(join(current,'guestbook/style.css'),style);
  await rm(join(current,'guestbook/app.js'));
  assert.equal((await fetch(origin+'/guestbook/app.js')).status,404);
  await assert.rejects(verifyLive(manifest,origin,false),/HTTP 404：\/guestbook\/app.js/);
  await writeFile(join(current,'ordinary.html'),'corrupt');
  await assert.rejects(verifyLive(manifest,origin,false),/校验失败：ordinary.html/);
  await rm(join(current,'guestbook/index.html'));
  assert.equal((await fetch(origin+'/guestbook/')).status,404);
 });
});
