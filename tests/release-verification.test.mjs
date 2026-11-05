import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {verifyLive} from '../admin/release-verification.mjs';
import {byteHash} from '../web/engine/theme-homepage.mjs';
import {digest} from '../admin/model.mjs';

async function fixture(t,respond){
  const requests=[];let connections=0;
  const server=http.createServer((req,res)=>{requests.push(req.url);respond(req,res);});
  server.on('connection',()=>connections++);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return {origin:'http://127.0.0.1:'+server.address().port,requests,connections:()=>connections};
}
const marker={jobId:'test-job',release:'admin-test-job',snapshotHash:'expected'};

test('serial verification reuses one connection and checks every text and binary file',async t=>{
  const binary=Buffer.from([0xff,0xfe,0,128,1]),text='逐字校验 😀';
  const manifest={...marker,hashes:Object.fromEntries(Array.from({length:100},(_,i)=>['page-'+i+'.html',digest(text)])),byteHashes:{'asset.png':byteHash(binary)}};
  const f=await fixture(t,(req,res)=>res.end(req.url==='/release.json'?JSON.stringify(marker):req.url==='/asset.png'?binary:text));
  const stats=await verifyLive(manifest,f.origin,false);
  assert.equal(stats.files,102);assert.equal(f.requests.length,102);assert.equal(f.connections(),1);
  assert.equal(stats.bytes,Buffer.byteLength(JSON.stringify(marker))+100*Buffer.byteLength(text)+binary.length);
  assert(stats.durationMs>=0);
});

test('local resolution keeps the public Host while connecting to loopback',async t=>{
  let host;
  const f=await fixture(t,(req,res)=>{host=req.headers.host;res.end(JSON.stringify(marker));});
  const origin=f.origin.replace('127.0.0.1','publication.invalid');
  await verifyLive({...marker,hashes:{}},origin,true);
  assert.equal(host,new URL(origin).host);
});

for(const field of ['jobId','snapshotHash','release'])test('rejects a stale release '+field,async t=>{
  const f=await fixture(t,(req,res)=>res.end(JSON.stringify({...marker,[field]:'stale'})));
  await assert.rejects(verifyLive({...marker,hashes:{'next.html':digest('x')}},f.origin,false),/版本标记不一致/);
  assert.deepEqual(f.requests,['/release.json']);
});

test('stops on a hash mismatch without requesting the next file',async t=>{
  const f=await fixture(t,(req,res)=>res.end(req.url==='/release.json'?JSON.stringify(marker):'corrupt'));
  await assert.rejects(verifyLive({...marker,hashes:{'first.html':digest('right'),'next.html':digest('next')}},f.origin,false),/校验失败：first.html/);
  assert.deepEqual(f.requests,['/release.json','/first.html']);
});

test('rejects redirects instead of following a different host',async t=>{
  const f=await fixture(t,(req,res)=>{res.writeHead(302,{Location:'http://example.invalid/'});res.end();});
  await assert.rejects(verifyLive({...marker,hashes:{}},f.origin,false),/HTTP 302/);
});

test('enforces a whole-request timeout even while a body keeps arriving',async t=>{
  let interval;
  const f=await fixture(t,(req,res)=>{res.write(' ');interval=setInterval(()=>res.write(' '),5);res.on('close',()=>clearInterval(interval));});
  t.after(()=>clearInterval(interval));
  await assert.rejects(verifyLive({...marker,hashes:{}},f.origin,false,{timeoutMs:80}),/超时/);
});

test('bounds response memory and rejects truncated responses',async t=>{
  const large=await fixture(t,(req,res)=>res.end('x'.repeat(1000)));
  await assert.rejects(verifyLive({...marker,hashes:{}},large.origin,false,{maxBytes:100}),/大小限制/);
  const truncated=await fixture(t,(req,res)=>{res.writeHead(200,{'Content-Length':1000});res.write('partial');setImmediate(()=>res.destroy());});
  await assert.rejects(verifyLive({...marker,hashes:{}},truncated.origin,false));
});

test('rejects manifest paths that escape the site or add a query',async t=>{
  const f=await fixture(t,(req,res)=>res.end(JSON.stringify(marker)));
  for(const path of ['//example.invalid/a','../outside','a/../outside','foo?query','foo#hash','foo\\bar']){
    await assert.rejects(verifyLive({...marker,hashes:{[path]:digest('x')}},f.origin,false),/路径无效/);
  }
  assert(f.requests.every(path=>path==='/release.json'));
});
