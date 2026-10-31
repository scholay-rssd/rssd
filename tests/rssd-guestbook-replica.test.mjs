import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GuestbookMirror} from '../receiver/guestbook.mjs';
import {attachGuestbook} from '../web/engine/guestbook-page.mjs';
import {profiles} from '../scripts/site-config.mjs';
test('approved-message replica strips private fields, keeps the last good copy during failure and rejects invalid replacements',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-wall-'));t.after(()=>rm(directory,{recursive:true,force:true}));let now=0,body={messages:[{id:'message-1',kind:'message',name:'Synthetic',message:'Approved text',created:1,contact:'never public',details:{private:'never public'},visitor:'private identity'}]},failure=false;
 const mirror=new GuestbookMirror({siteId:'fixture',origin:'https://center.example.org',token:'fixture-token-'.repeat(4),directory},{now:()=>now,fetchImpl:async(url,options)=>{assert.equal(new URL(url).pathname,'/api/rssd/public/v1/guestbooks/fixture/messages');assert(options.headers['x-rssd-site-token']);if(failure)throw Error('offline');return new Response(JSON.stringify(body));}});
 await mirror.tick();const target=join(directory,'messages.json'),original=await readFile(target,'utf8');assert(!original.includes('private'));assert(!original.includes('contact'));
 failure=true;now+=60001;await assert.rejects(mirror.tick(),/offline/);assert.equal(await readFile(target,'utf8'),original);
 failure=false;body={messages:[{id:'bad',kind:'message',name:'Synthetic',message:'x'.repeat(3001),created:2}]};now+=60001;await assert.rejects(mirror.tick(),/message/);assert.equal(await readFile(target,'utf8'),original);
});
test('enabled guestbooks have static pages and public form definitions, with no administration files',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-wall-page-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const site={...profiles.find(s=>s.id==='lingxi'),services:{guestbook:{enabled:true}}},manifest={hashes:{}};
 await attachGuestbook({target:directory,site,manifest});assert.match(await readFile(join(directory,'guestbook/index.html'),'utf8'),/留言板/);
 const config=JSON.parse(await readFile(join(directory,'guestbook/config.json'),'utf8'));assert.equal(config.siteId,'lingxi');assert.equal(config.dailyLimit,2);assert.equal(Object.keys(manifest.hashes).length,4);
 await assert.rejects(access(join(directory,'guestbook/moderate.html')));
 const disabled={hashes:{}};await attachGuestbook({target:directory,site:{...site,services:{guestbook:{enabled:false}}},manifest:disabled});assert.deepEqual(disabled.hashes,{});
});
