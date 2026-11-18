import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCodexImageProvider,drawingModelFromBytes} from '../scripts/rssd-codex-image-provider.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
// The C2PA softwareAgent map as OpenAI writes it, in CBOR: {"name":"ChatGPT","version":"gpt-image"}.
const cborText=s=>Buffer.concat([Buffer.from([0x60+Buffer.byteLength(s)]),Buffer.from(s)]);
const signed=Buffer.concat([png,Buffer.from('msoftwareAgent','latin1'),Buffer.from([0xa2]),cborText('name'),cborText('ChatGPT'),cborText('version'),cborText('gpt-image')]);
const scope={workspaceId:'pets',jobId:'job-1',blockId:'hero',requirement:'A rabbit eating hay',alt:'一只家兔在干草堆旁低头咀嚼牧草的安静室内场景',caption:'牧草是家兔饮食的基础。'};
const thread='01a1ee10-8435-7373-a71b-a8e39fc71ba7';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'rssd-codex-image-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const codexHome=join(root,'codex'),draw=async(bytes=signed)=>{const dir=join(codexHome,'generated_images',thread);await mkdir(dir,{recursive:true});await writeFile(join(dir,'exec-1.png'),bytes);};
 return {root,codexHome,draw,stateDirectory:join(root,'state')};
}

test('the drawing model is read from the picture and is absent when the picture states none',()=>{
 assert.deepEqual(drawingModelFromBytes(signed),{service:'ChatGPT',model:'gpt-image'});
 assert.equal(drawingModelFromBytes(png),null);
});

test('one Codex run draws one picture, recorded with its model for internal review',async t=>{
 const f=await fixture(t);let runs=0,sent;
 const provider=createCodexImageProvider({stateDirectory:f.stateDirectory,codexHome:f.codexHome,enabled:true,run:async({prompt})=>{runs++;sent=prompt;await f.draw();return {threadId:thread};}});
 const result=await provider.start({requestId:'image-1',scope});
 assert.equal(result.status,'ready');assert.deepEqual(result.bytes,signed);
 assert.equal(result.registration.sha256,createHash('sha256').update(signed).digest('hex'));assert.equal(result.registration.taskId,thread);
 assert.equal(result.provenance.kind,'generated');assert.equal(result.provenance.agent,'Codex');assert.equal(result.provenance.model,'gpt-image');
 assert.match(sent,/A rabbit eating hay/);assert.match(sent,/exactly once/);
 // A repeat start never draws again; it reads the original thread's picture.
 assert.equal((await provider.start({requestId:'image-1',scope})).status,'ready');assert.equal(runs,1);
});

test('a run that fails after starting is looked up by its thread, never redrawn',async t=>{
 const f=await fixture(t);let runs=0;
 const provider=createCodexImageProvider({stateDirectory:f.stateDirectory,codexHome:f.codexHome,enabled:true,run:async()=>{runs++;throw Object.assign(Error('connection lost'),{threadId:thread});}});
 assert.equal((await provider.start({requestId:'image-2',scope})).status,'pending');
 await f.draw();
 assert.equal((await provider.lookup({requestId:'image-2',scope})).status,'ready');
 assert.equal((await provider.start({requestId:'image-2',scope})).status,'ready');assert.equal(runs,1);
});

test('disabled, changed-scope and several-picture requests stay pending or fail closed',async t=>{
 const f=await fixture(t);
 const off=createCodexImageProvider({stateDirectory:f.stateDirectory,codexHome:f.codexHome,run:async()=>assert.fail('must not run')});
 assert.equal((await off.start({requestId:'image-3',scope})).status,'pending');
 const provider=createCodexImageProvider({stateDirectory:f.stateDirectory,codexHome:f.codexHome,enabled:true,run:async()=>{await f.draw();await writeFile(join(f.codexHome,'generated_images',thread,'exec-2.png'),png);return {threadId:thread};}});
 const two=await provider.start({requestId:'image-4',scope});assert.equal(two.status,'pending');assert.match(two.reason,/more than one/);
 await assert.rejects(provider.lookup({requestId:'image-4',scope:{...scope,requirement:'Something else'}}),/scope differs/);
});
