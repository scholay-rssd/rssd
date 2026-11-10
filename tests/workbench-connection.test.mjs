import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyWebsite} from '../desktop/scripts/runtime/verify-website.mjs';
const token='test-only-not-a-real-token';
test('connection probe uses fixed HTTPS catalog, one record and rejects redirects',async()=>{
 const result=await verifyWebsite(token,async(url,options)=>{
  assert.equal(url,'https://today.scholay.com/manage/api/news/catalog?scope=all&limit=1');
  assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,`Bearer ${token}`);
  assert.ok(options.signal);return new Response(JSON.stringify({items:[]}));
 });assert.equal(result.connected,true);
});
test('credential, auth and transport errors cannot echo the token',async()=>{
 await assert.rejects(verifyWebsite('bad\n'),/令牌格式无效/);
 await assert.rejects(verifyWebsite(token,async()=>new Response('',{status:403})),/403/);
 await assert.rejects(verifyWebsite(token,async()=>{throw Error(token)}),/^Error: 无法连接官网，请检查网络$/);
 await assert.rejects(verifyWebsite(token,async()=>new Response('{}')),/目录返回格式错误/);
});
