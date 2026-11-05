import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readWebsiteCatalog} from '../scripts/website-catalog.mjs';
import {cachedRemoteRead} from '../scripts/remote-read-cache.mjs';
const offline=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});
const page=(items,next,generation=1)=>({items:items.map(id=>({id})),next,generation,scope:'all'});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'today-catalog-'));t.after(()=>rm(root,{recursive:true,force:true}));return join(root,'progress.json');}
const cursor=path=>Number(new URL(path,'https://example.test').searchParams.get('after'));

test('a temporary page failure retries only that page with bounded backoff',async()=>{
 const calls=[],delays=[];let failed=false;
 const result=await readWebsiteCatalog({all:true,wait:async ms=>delays.push(ms),api:async path=>{
  const after=cursor(path);calls.push(after);if(after===80&&!failed){failed=true;throw offline();}
  return after===0?page(['first'],80):page(['second'],null);
 }});
 assert.deepEqual(calls,[0,80,80]);assert.deepEqual(result.items.map(x=>x.id),['first','second']);assert.equal(delays.length,1);assert.ok(delays[0]>=1000&&delays[0]<1250);
});

test('first load preserves partial pages, backs off across processes, and resumes the failed page',async t=>{
 const file=await fixture(t),cacheFile=file+'.cache',calls=[];let time=1,fail=true;
 const api=async path=>{const after=cursor(path);calls.push(after);if(after===80&&fail)throw offline();return after===0?page(['first'],80):page(['second'],null);};
 const read=()=>cachedRemoteRead({file:cacheFile,identity:'same',now:()=>time,load:async()=>({value:await readWebsiteCatalog({all:true,api,file,identity:'same',wait:async()=>{}})})});
 const result=await read();assert.equal(result.partial,true);assert.deepEqual(result.items,[{id:'first'}]);assert.match(result.notice,/尚未完整/);assert.deepEqual(calls,[0,80,80,80]);
 for(let n=0;n<10;n++)await read();assert.equal(calls.length,4);
 time+=30000;fail=false;const complete=await read();assert.equal(complete.partial,undefined);assert.deepEqual(complete.items,[{id:'first'},{id:'second'}]);assert.deepEqual(calls,[0,80,80,80,80]);
 await assert.rejects(readFile(file),{code:'ENOENT'});
});

test('a failed refresh retains the entire prior catalog instead of replacing it with partial pages',async t=>{
 const file=await fixture(t);let time=1,fail=false;
 const read=()=>cachedRemoteRead({file,identity:'same',force:true,now:()=>time,load:async()=>{
  if(fail)throw Object.assign(offline(),{partialValue:{items:[{id:'partial'}],partial:true}});
  return {value:{items:[{id:'old-one'},{id:'old-two'}]}};
 }});
 await read();time+=30000;fail=true;const result=await read();assert.equal(result.partial,undefined);assert.equal(result.items.length,2);assert.match(result.notice,/缓存/);
 assert.equal(JSON.parse(await readFile(file,'utf8')).value.items.length,2);
});

test('changed generations discard partial checkpoints and restart once without mixing records',async t=>{
 const file=await fixture(t);let fail=true;const calls=[];
 const api=async path=>{const after=cursor(path);calls.push(after);if(fail){if(after)throw offline();return page(['old'],80);}if(after===80)throw Object.assign(Error('changed'),{statusCode:409});return page(['new'],null,2);};
 await assert.rejects(readWebsiteCatalog({all:true,api,file,identity:'same',wait:async()=>{}}));
 fail=false;const result=await readWebsiteCatalog({all:true,api,file,identity:'same',wait:async()=>{}});
 assert.deepEqual(result.items,[{id:'new'}]);assert.deepEqual(calls.slice(-2),[80,0]);
});

test('different sites never reuse partial checkpoints',async t=>{
 const file=await fixture(t);
 await assert.rejects(readWebsiteCatalog({all:true,file,identity:'site-a',wait:async()=>{},api:async path=>{if(cursor(path))throw offline();return page(['site-a'],80);}}));
 const calls=[];const result=await readWebsiteCatalog({all:true,file,identity:'site-b',api:async path=>{calls.push(cursor(path));return page(['site-b'],null);}});
 assert.deepEqual(calls,[0]);assert.deepEqual(result.items,[{id:'site-b'}]);
});

test('no immediate retry for revoked credentials, rate limits or invalid JSON; total retry budget is finite',async()=>{
 for(const statusCode of [401,403,429]){
  let calls=0;await assert.rejects(readWebsiteCatalog({api:async()=>{calls++;throw Object.assign(Error('denied'),{statusCode});},wait:async()=>assert.fail('unexpected retry')}));assert.equal(calls,1);
 }
 let limited=0;await assert.rejects(readWebsiteCatalog({api:async()=>{limited++;throw Object.assign(Error('busy'),{statusCode:503,retryAfterMs:60000});},wait:async()=>assert.fail('server requested a pause')}));assert.equal(limited,1);
 let calls=0;await assert.rejects(readWebsiteCatalog({api:async()=>{calls++;throw new SyntaxError('invalid JSON');},wait:async()=>assert.fail('unexpected retry')}));assert.equal(calls,1);
 const attempts=new Map();let delays=0;
 await assert.rejects(readWebsiteCatalog({wait:async()=>{delays++;},api:async path=>{const after=cursor(path),n=(attempts.get(after)||0)+1;attempts.set(after,n);if(n===1)throw offline();return page([after],after+80);}}));
 assert.equal(delays,4);assert.equal(attempts.size,5);
});
