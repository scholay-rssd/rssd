import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCloudLabels, LABEL_CLOUD_URL} from '../desktop/scripts/runtime/labels-cloud-read.mjs';
const token = 'isolated-read-credential';
// chmod on Windows cannot establish the POSIX 0600 contract. Its native runtime
// supplies a vault token instead; legacy files must keep failing closed there.
const legacyToken = process.platform==='win32' ? null : token;
const feed = {schemaVersion:1,source:'scholay-cloud-labels',platforms:[],latest:[]};
const response = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('desktop reads only the fixed cloud cache, with no provider request or redirect', async()=>{
  let calls = 0;
  assert.deepEqual(await readCloudLabels(token,async(url,options)=>{
    calls++; assert.equal(url,LABEL_CLOUD_URL); assert.equal(options.method,'GET'); assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,`Bearer ${token}`); return response(feed);
  }),feed);
  assert.equal(calls,1);
});
test('unbound desktop makes no network request', async()=>{
  await assert.rejects(readCloudLabels(null,()=>{throw Error('must not fetch');}),/绑定官网/);
});
test('network error and server errors never expose credentials or arbitrary response text', async()=>{
  await assert.rejects(readCloudLabels(token,()=>{throw Error(token);}),/^Error: 无法拉取/);
  for(const status of [401,403,404,500]) await assert.rejects(readCloudLabels(token,async()=>new Response(token,{status})),error=>!error.message.includes(token));
});
test('rejects a large declared or streamed response and unexpected format', async()=>{
  for(const result of [new Response('{}',{headers:{'content-length':String(3*1024*1024),'content-type':'application/json'}}),response({}),new Response('<html/>',{headers:{'content-type':'text/html'}}),response({ ...feed, latest:null })])
    await assert.rejects(readCloudLabels(token,async()=>result),/过大|格式错误/);
  await assert.rejects(readCloudLabels(token,async()=>new Response(' '.repeat(2*1024*1024+1),{headers:{'content-type':'application/json'}})),/过大/);
});

import {mkdtemp,mkdir,writeFile,readFile,stat,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolveLabelCloudCredential} from '../desktop/scripts/runtime/labels-cloud-credential.mjs';
async function credentialWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(),'scholay-label-credential-'));
  const file = join(root,'.local/today/publish-token');
  await mkdir(join(root,'.local/today'),{recursive:true,mode:0o700});
  try { await run({root,file}); } finally { await rm(root,{recursive:true,force:true}); }
}
test('native/environment credential takes precedence and vault-required mode never checks legacy files', async()=>{
  let workspaces = 0;
  const workspace = () => { workspaces++; throw Error('must not access legacy'); };
  assert.equal(await resolveLabelCloudCredential({env:{SCHOLAY_TODAY_TOKEN:token,SCHOLAY_REQUIRE_VAULT:'1'},workspace}),token);
  assert.equal(await resolveLabelCloudCredential({env:{SCHOLAY_REQUIRE_VAULT:'1'},workspace}),null);
  assert.equal(await resolveLabelCloudCredential({env:{SCHOLAY_TODAY_TOKEN:'invalid whitespace token'},workspace}),null);
  assert.equal(workspaces,0);
});
test('legacy workspace credentials honor the host permission contract without migrating the file', async()=>{
  await credentialWorkspace(async({root,file})=>{
    await writeFile(file,token+'\n',{mode:0o600});
    let workspaces=0;
    assert.equal(await resolveLabelCloudCredential({env:{},workspace:()=>{workspaces++;return root;}}),legacyToken);
    assert.equal(workspaces,1);
    assert.equal(await readFile(file,'utf8'),token+'\n');if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600);
    let calls=0;
    const awaitedCredential=await resolveLabelCloudCredential({env:{},workspace:()=>root});
    const read=()=>readCloudLabels(awaitedCredential,async()=>{calls++;return response(feed);});
    if(legacyToken){assert.deepEqual(await read(),feed);assert.equal(calls,1);}
    else {await assert.rejects(read(),/绑定官网/);assert.equal(calls,0);}
    assert.equal(await resolveLabelCloudCredential({env:{SCHOLAY_REQUIRE_VAULT:'1'},workspace:()=>root}),null);
  });
});
test('legacy fallback validates regular file, private 0600 mode, nonempty token and bounded file size', async()=>{
  await credentialWorkspace(async({root,file})=>{
    const resolve = () => resolveLabelCloudCredential({env:{},workspace:()=>root});
    assert.equal(await resolve(),null);
    for(const contents of ['', ' \n', 'short', 'a'.repeat(2049), 'bad\nembedded-token-value']) {
      await writeFile(file,contents,{mode:0o600}); await chmod(file,0o600); assert.equal(await resolve(),null);
    }
    await writeFile(file,token); await chmod(file,0o644); assert.equal(await resolve(),null);
    await chmod(file,0o400); assert.equal(await resolve(),null);
    await chmod(file,0o600); assert.equal(await resolve(),legacyToken);
    await rm(file); await mkdir(file,{mode:0o600}); assert.equal(await resolve(),null);
    await rm(file,{recursive:true});
    const target=join(root,'private-token');await writeFile(target,token,{mode:0o600});await symlink(target,file);
    assert.equal(await resolve(),null);
  });
});
test('legacy explicit file override stays subordinate to native token and vault-only protection', async()=>{
  await credentialWorkspace(async({file})=>{
    await writeFile(file,token,{mode:0o600});
    const workspace=()=>{throw Error('must not resolve workspace');};
    assert.equal(await resolveLabelCloudCredential({env:{SCHOLAY_TODAY_TOKEN_FILE:file},workspace}),legacyToken);
    assert.equal(await resolveLabelCloudCredential({env:{SCHOLAY_TODAY_TOKEN:'another-isolated-credential',SCHOLAY_TODAY_TOKEN_FILE:file},workspace}),'another-isolated-credential');
    assert.equal(await resolveLabelCloudCredential({env:{SCHOLAY_REQUIRE_VAULT:'1',SCHOLAY_TODAY_TOKEN_FILE:file},workspace}),null);
  });
});
test('workspace/read failures and malformed entrypoint input cannot print raw data or credentials', async()=>{
  assert.equal(await resolveLabelCloudCredential({env:{},workspace:()=>{throw Error(token);}}),null);
  for(const input of [`{"method":"${token}"}\n`, `{"secret":"${token}"\n`]) {
    const result=spawnSync(process.execPath,['desktop/scripts/labels-cloud.mjs'],{cwd:new URL('..',import.meta.url),input,encoding:'utf8',env:{...process.env,SCHOLAY_REQUIRE_VAULT:'1',SCHOLAY_TODAY_TOKEN:''}});
    assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'未知标签操作');assert.ok(!result.stderr.includes(token));
  }
});

test('read-only CLI uses the platform credential with an isolated fetch and keeps the file intact', async()=>{
  await credentialWorkspace(async({root,file})=>{
    await writeFile(file,token+'\n',{mode:0o600});
    const preload=join(root,'isolated-fetch.mjs');
    await writeFile(preload,`globalThis.fetch=async(url,options)=>{if(url!==${JSON.stringify(LABEL_CLOUD_URL)}||options.method!=='GET'||options.redirect!=='error'||options.headers.Authorization!==${JSON.stringify('Bearer '+token)})throw Error('unexpected isolated request');return new Response(${JSON.stringify(JSON.stringify(feed))},{headers:{'content-type':'application/json'}});};`,{mode:0o600});
    const result=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,'desktop/scripts/labels-cloud.mjs'],{cwd:new URL('..',import.meta.url),input:'{"method":"read"}\n',encoding:'utf8',env:{...process.env,SCHOLAY_REQUIRE_VAULT:'0',SCHOLAY_TODAY_TOKEN:process.platform==='win32'?token:'',SCHOLAY_TODAY_TOKEN_FILE:file}});
    assert.equal(result.status,0);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout),feed);assert.ok(!result.stdout.includes(token));
    assert.equal(await readFile(file,'utf8'),token+'\n');if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600);
  });
});
