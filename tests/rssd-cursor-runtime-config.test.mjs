import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {configuredCursorImageRuntime} from '../scripts/rssd-cursor-runtime-config.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
test('CLI image runtime is opt-in and binds the site reference to exact bytes',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'rssd-image-config-')));t.after(()=>rm(dir,{recursive:true,force:true}));const id=join(dir,'identity.json'),ref=join(dir,'reference.png');await writeFile(id,JSON.stringify({version:1,files:{}}),{mode:0o600});await writeFile(ref,'synthetic');
 assert.equal(await configuredCursorImageRuntime(),undefined);assert.equal(await configuredCursorImageRuntime({enabled:false}),undefined);
 const value={enabled:true,runtimeIdentityPath:id,references:{one:{path:ref,sha256:sha('synthetic')}}},registrarFactory=async()=>({});
 const runtime=await configuredCursorImageRuntime(value,{registrarFactory,search:async()=>({complete:true,candidates:[]})});assert.equal((await runtime.resolveReference({siteId:'one'})).bytes.toString(),'synthetic');await assert.rejects(runtime.resolveReference({siteId:'other'}),{code:'image_pending'});
 await writeFile(ref,'changed');await assert.rejects(runtime.resolveReference({siteId:'one'}),{code:'image_pending'});
 await assert.rejects(configuredCursorImageRuntime(value),{code:'image_pending'});
});
test('references and runtime pin never follow symlinks',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'rssd-image-config-')));t.after(()=>rm(dir,{recursive:true,force:true}));const id=join(dir,'identity.json'),ref=join(dir,'ref'),link=join(dir,'link');await writeFile(id,JSON.stringify({version:1,files:{}}),{mode:0o600});await writeFile(ref,'fixture');await symlink(ref,link);
 const runtime=await configuredCursorImageRuntime({enabled:true,runtimeIdentityPath:id,references:{one:{path:link,sha256:sha('fixture')}}},{registrarFactory:async()=>({})});await assert.rejects(runtime.resolveReference({siteId:'one'}),{code:'image_pending'});
});

test('installed-runtime pin is an explicit non-overwriting CLI operation', {skip:process.platform!=='darwin'},async t=>{
 const {main}=await import('../scripts/rssd-multisite-cli.mjs'),{stat,readFile}=await import('node:fs/promises');const dir=await realpath(await mkdtemp(join(tmpdir(),'rssd-image-pin-')));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'runtime.json');
 assert.deepEqual(await main(['--image-identity',path]),{state:'image_identity_saved'});assert.equal((await stat(path)).mode&0o077,0);assert.equal(JSON.parse(await readFile(path,'utf8')).version,1);await assert.rejects(main(['--image-identity',path]),{code:'EEXIST'});
});
