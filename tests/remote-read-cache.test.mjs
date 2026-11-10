import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cachedRemoteRead,retryAfterMs,REMOTE_READ_TTL} from '../scripts/remote-read-cache.mjs';
import {siteCalendar} from '../desktop/scripts/publication-center.mjs';
import {profiles} from '../scripts/site-config.mjs';
const run=promisify(execFile);
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-read-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,file:join(root,'read.json')};}
test('five minute durable cache coalesces reads, limits manual refresh and isolates identities',async t=>{
 const {file}=await fixture(t);let time=10000,calls=0;
 const read=(extra={})=>cachedRemoteRead({file,identity:'site-a',now:()=>time,load:async()=>({value:{calls:++calls}}),...extra});
 await Promise.all(Array.from({length:20},()=>read()));assert.equal(calls,1);
 time+=REMOTE_READ_TTL-1;assert.equal((await read()).calls,1);time++;assert.equal((await read()).calls,2);
 await read({force:true});assert.equal(calls,2);time+=5000;await read({force:true});assert.equal(calls,3);
 time++;await read({force:true,minInterval:0});assert.equal(calls,4);
 await read({identity:'site-b'});assert.equal(calls,5);
});
test('independent desktop worker processes share one network load',async t=>{
 const {file,root}=await fixture(t),counter=join(root,'counter'),moduleUrl=new URL('../scripts/remote-read-cache.mjs',import.meta.url).href;
 const script=`import {cachedRemoteRead} from ${JSON.stringify(moduleUrl)};import {readFile,writeFile} from 'node:fs/promises';await cachedRemoteRead({file:process.argv[1],identity:'same-site',load:async()=>{let n=0;try{n=Number(await readFile(process.argv[2],'utf8'))}catch{};await writeFile(process.argv[2],String(n+1));await new Promise(r=>setTimeout(r,100));return {value:{ok:true}};}});`;
 await Promise.all(Array.from({length:6},()=>run(process.execPath,['--input-type=module','-e',script,file,counter])));assert.equal(await readFile(counter,'utf8'),'1');
});
test('failures preserve content with exponential backoff and Retry-After; revoked access fails closed',async t=>{
 const {file}=await fixture(t);let time=10000,calls=0,fail;
 const read=(extra={})=>cachedRemoteRead({file,identity:'site',now:()=>time,load:async()=>{calls++;if(fail)throw fail;return {value:{title:'cached'}};},...extra});
 await read();time+=REMOTE_READ_TTL;fail=Error('offline');assert.match((await read()).notice,/缓存/);
 for(let i=0;i<20;i++)await read();assert.equal(calls,2);time+=30000;await read();assert.equal(calls,3);
 time+=59999;await read();assert.equal(calls,3);time++;fail=Object.assign(Error('rate limited'),{statusCode:429,retryAfterMs:600000});await read();assert.equal(calls,4);
 time+=599999;await read();assert.equal(calls,4);time++;fail=Object.assign(Error('revoked'),{statusCode:401});await assert.rejects(read(),/revoked/);await assert.rejects(read(),/暂缓/);assert.equal(calls,5);
});
test('304 reuses payload, validators reset after a new response; calendar sends conditional GET',async t=>{
 const {file,root}=await fixture(t);let time=1,phase=0;
 const read=()=>cachedRemoteRead({file,identity:'site',now:()=>time,ttl:1,load:async headers=>{
  if(phase++===0)return {value:{one:true},etag:'first'};
  assert.equal(headers.etag,'first');return phase===2?{notModified:true}:{value:{two:true}};
 }});
 await read();time++;assert.deepEqual(await read(),{one:true});time++;await read();assert.equal(JSON.parse(await readFile(file,'utf8')).etag,undefined);
 await writeFile(join(root,'.site.json'),JSON.stringify(profiles.find(x=>x.id==='pets')));
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(options.method||'GET','GET');if(calls===2){assert.equal(options.headers['If-None-Match'],'"calendar-one"');return new Response(null,{status:304});}return Response.json({version:1,siteId:'pets',records:[]},{headers:{etag:'"calendar-one"'}});};
 await Promise.all(Array.from({length:20},()=>siteCalendar({root,fetcher})));assert.equal(calls,1);
 const path=join(root,'.local/publication-center/site-calendar-read.json'),state=JSON.parse(await readFile(path,'utf8'));state.checkedAt=0;await writeFile(path,JSON.stringify(state));await siteCalendar({root,fetcher});assert.equal(calls,2);
 assert.equal(retryAfterMs(new Response(null,{headers:{'Retry-After':'120'}})),120000);
});
test('upgrading offline retains a matching old calendar snapshot and still backs off',async t=>{
 const {root}=await fixture(t);await writeFile(join(root,'.site.json'),JSON.stringify(profiles.find(x=>x.id==='pets')));
 const folder=join(root,'.local/publication-center');await mkdir(folder,{recursive:true});const file=join(folder,'site-calendar.json'),old={version:1,siteId:'pets',records:[{id:'old-record'}],updatedAt:'2026-10-01T00:00:00Z'};await writeFile(file,JSON.stringify(old));
 let calls=0;const fetcher=async()=>{calls++;throw Error('offline');};
 for(let i=0;i<10;i++){const result=await siteCalendar({root,fetcher});assert.deepEqual(result.records,old.records);assert.match(result.notice,/缓存/);}
 assert.equal(calls,1);assert.deepEqual(JSON.parse(await readFile(file,'utf8')),old);
});
