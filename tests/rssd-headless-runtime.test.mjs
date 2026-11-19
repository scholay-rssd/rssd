import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installRuntime,withRuntimeLease,verifyRuntime} from '../desktop/scripts/agent/headless/artifact-runtime.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,version='1.0.0'){
  const home=await mkdtemp(join(tmpdir(),'rssd-runtime-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const source=join(home,'artifact'),base=join(home,'installed');await mkdir(source);
  const files={};
  for(const [name,body] of Object.entries({[process.platform==='win32'?'node.exe':'node']:'fake-runtime-for-test','desktop/scripts/agent/headless/standalone.mjs':'console.log("fixture")'})){
    await mkdir(dirname(join(source,name)),{recursive:true});await writeFile(join(source,name),body);files[name]={sha256:hash(body),executable:name.startsWith('node')};
  }
  const manifest={version,platform:process.platform,arch:process.arch,protocol:1,files};
  const save=()=>writeFile(join(source,'runtime-manifest.json'),JSON.stringify(manifest));await save();
  return {home,source,base,manifest,save};
}
test('headless installation verifies content and keeps immutable versions and device state',async t=>{
  const f=await fixture(t),first=await installRuntime(f.source,{base:f.base});
  assert.equal(first.status,'installed');await writeFile(join(f.base,'private-device-state.txt'),'keep');
  f.manifest.version='1.1.0';await f.save();const second=await installRuntime(f.source,{base:f.base});
  assert.equal(second.previous,(await readFile(join(f.base,'previous'),'utf8')).trim());
  assert.equal(await readFile(join(f.base,'private-device-state.txt'),'utf8'),'keep');
  assert.equal((await verifyRuntime(first.release)).manifest.version,'1.0.0');
  assert.equal((await installRuntime(f.source,{base:f.base})).status,'unchanged');
});
test('a running production lease blocks updates until the task exits',async t=>{
  const f=await fixture(t);await installRuntime(f.source,{base:f.base});const before=await readFile(join(f.base,'current'),'utf8');
  f.manifest.version='2.0.0';await f.save();
  await withRuntimeLease(async()=>{await assert.rejects(installRuntime(f.source,{base:f.base}),/still running/);assert.equal(await readFile(join(f.base,'current'),'utf8'),before);},{base:f.base});
  assert.equal((await installRuntime(f.source,{base:f.base})).version,'2.0.0');
});
test('corruption, incompatible targets and unsafe paths never activate a candidate',async t=>{
  const f=await fixture(t);await installRuntime(f.source,{base:f.base});const before=await readFile(join(f.base,'current'),'utf8');
  await assert.rejects(installRuntime(f.source,{base:f.base,expectedManifestHash:'f'.repeat(64)}),/checksum/);
  f.manifest.files['../escape']={sha256:'a'.repeat(64),executable:false};await f.save();await assert.rejects(installRuntime(f.source,{base:f.base}),/Invalid artifact path/);delete f.manifest.files['../escape'];
  f.manifest.arch='unsupported';await f.save();await assert.rejects(installRuntime(f.source,{base:f.base}),/Incompatible/);f.manifest.arch=process.arch;await f.save();
  await writeFile(join(f.source,'desktop/scripts/agent/headless/standalone.mjs'),'modified');await assert.rejects(installRuntime(f.source,{base:f.base}),/checksum/);
  assert.equal(await readFile(join(f.base,'current'),'utf8'),before);
});
test('a source checkout runs center commands without taking an installed runtime lease',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-checkout-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const entry=fileURLToPath(new URL('../desktop/scripts/agent/headless/standalone.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[entry,'center','--help'],{encoding:'utf8',timeout:10000,env:{...process.env,RSSD_RUNTIME_HOME:join(home,'runtime'),RSSD_CENTER_HOME:join(home,'center')}});
  assert.equal(result.status,0,result.stderr);assert.ok(JSON.parse(result.stdout).commands.length);
  assert.equal(existsSync(join(home,'runtime')),false);
});
