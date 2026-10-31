import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readConfiguredLabels} from '../desktop/scripts/runtime/labels-source.mjs';
const token='rssd_device_'+'a'.repeat(48),origin='https://center.example.org';
const feed={schemaVersion:1,source:'scholay-cloud-labels',platforms:[],latest:[]};
async function fixture(fn){const home=await mkdtemp(join(tmpdir(),'rssd-labels-'));try{await fn(home);}finally{await rm(home,{recursive:true,force:true});}}
test('configured center is the only label source; failures never fall back to legacy credentials',async()=>fixture(async home=>{
 await writeFile(join(home,'connection.json'),JSON.stringify({origin,token}));
 let legacy=0,requests=0;
 const options={home,env:{},legacyCredential:async()=>{legacy++;return 'legacy-credential';}};
 assert.deepEqual(await readConfiguredLabels({...options,fetcher:async(url,request)=>{
  requests++;assert.equal(url,origin+'/api/rssd/v1/labels');assert.equal(request.headers.Authorization,'Bearer '+token);assert.equal(request.redirect,'error');
  return new Response(JSON.stringify(feed),{headers:{'content-type':'application/json'}});
 }}),{source:'center',feed});
 await assert.rejects(readConfiguredLabels({...options,fetcher:async()=>new Response('',{status:403})}),/中心设备无标签读取权限/);
 await assert.rejects(readConfiguredLabels({...options,env:{RSSD_CENTER_TOKEN:'bad'},fetcher:()=>{throw Error('unexpected network');}}),/中心设备凭据无效/);
 await assert.rejects(readConfiguredLabels({...options,env:{SCHOLAY_DESKTOP_RUNTIME:'1'},fetcher:()=>{throw Error('file token must not bypass vault');}}),/中心设备凭据无效/);
 assert.equal(legacy,0);assert.equal(requests,1);
}));
test('unconnected devices retain legacy read support; corrupted center config fails closed',async()=>fixture(async home=>{
 let legacy=0;const options={home,env:{},legacyCredential:async()=>{legacy++;return null;}};
 assert.deepEqual(await readConfiguredLabels(options),{source:'none',feed:null});assert.equal(legacy,1);
 await writeFile(join(home,'connection.json'),'{broken');
 await assert.rejects(readConfiguredLabels(options),/中心连接配置无法读取/);assert.equal(legacy,1);
 await writeFile(join(home,'connection.json'),JSON.stringify({token}));
 await assert.rejects(readConfiguredLabels(options),/中心连接配置无法读取/);assert.equal(legacy,1);
}));
