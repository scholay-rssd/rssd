import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCursorGalleryProvider} from '../scripts/rssd-cursor-image-provider.mjs';
import protocol from '../contracts/rssd-v1.cjs';
import {fixtureImagePolicy} from './fixtures/rssd-image-policy.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
const scope={origin:'https://center.example',workspaceId:'metho',jobId:'job-1',blockId:'hero',requirement:'Synthetic shape',alt:'一张用于测试的八乘八像素合成图片不代表任何真实研究',caption:'合成图'};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'rssd-cursor-image-'));t.after(()=>rm(root,{recursive:true,force:true}));const gallery=join(root,'.local/workbench/gallery');await mkdir(gallery,{recursive:true});const digest=createHash('sha256').update(png).digest('hex'),id=digest.slice(0,24),path=join(gallery,id+'.png');await writeFile(path,png);return {root,id,digest,path};}
test('original gallery task is recovered after ambiguous dispatch without duplicate generation',async t=>{
 const f=await fixture(t);let starts=0,dispatches=0,complete=false;
 const task={id:'task-1',agentId:'cursor',mode:'image',runtime:{status:'已完成',busy:false},assets:[{id:f.id,taskId:'task-1',storage:'gallery',origin:'generated',path:'.local/workbench/gallery/'+f.id+'.png'}]};
 const history=[{role:'tool',tool:{title:'Generate Image',status:'completed'}},{role:'tool',tool:{title:'scholay-workbench-asset_register: asset_register',status:'completed'}}];
 const bridge={async call(method){if(method==='task_create'){starts++;return task;}if(method==='gallery_prompt'){dispatches++;throw Error('synthetic disconnect after dispatch');}if(method==='task_get')return task;if(method==='status')return {busy:!complete,pending:[],history};throw Error('unexpected call');}};
 const provider=createCursorGalleryProvider({bridge,workspace:f.root,stateDirectory:join(f.root,'state'),enabled:true});
 assert.equal((await provider.start({requestId:'image-1',scope})).status,'pending');complete=true;
 const result=await provider.lookup({requestId:'image-1',scope});assert.equal(result.status,'ready');assert.equal(result.registration.sha256,f.digest);assert.deepEqual(result.bytes,png);
 await provider.start({requestId:'image-1',scope});assert.equal(starts,1);assert.equal(dispatches,1);
});
test('disabled, unresolved, unregistered and outside-gallery files remain pending',async t=>{
 const f=await fixture(t);let calls=0;const bridge={async call(method){calls++;if(method==='task_create')return {id:'task-1'};if(method==='gallery_prompt')return {runId:'run-1'};if(method==='task_get')return {id:'task-1',agentId:'cursor',mode:'image',runtime:{busy:false,status:'已完成'},assets:[{id:f.id,taskId:'task-1',storage:'gallery',origin:'generated',path:'../outside.png'}]};if(method==='status')return {busy:false,pending:[],history:[]};throw Error('unexpected');}};
 const disabled=createCursorGalleryProvider({bridge,workspace:f.root,stateDirectory:join(f.root,'disabled'),enabled:false});assert.equal((await disabled.start({requestId:'image-1',scope})).status,'pending');assert.equal(calls,0);
 const active=createCursorGalleryProvider({bridge,workspace:f.root,stateDirectory:join(f.root,'active'),enabled:true});assert.equal((await active.start({requestId:'image-2',scope})).status,'pending');assert.equal((await active.lookup({requestId:'image-2',scope})).status,'pending');
});
test('a pinned brand reference is passed as an actual image attachment and a mismatch blocks dispatch',async t=>{
 const f=await fixture(t);let created=0,received;
 const bridge={async call(method,args){if(method==='task_create'){created++;return {id:'task-1'};}if(method==='gallery_prompt'){received=args.attachments;return {runId:'run-1'};}if(method==='task_get')return {id:'task-1',agentId:'cursor',mode:'image',runtime:{busy:true},assets:[]};if(method==='status')return {busy:true,pending:[],history:[]};throw Error('unexpected');}};
 const scoped={...scope,referenceSha256:f.digest};
 const missing=createCursorGalleryProvider({bridge,workspace:f.root,stateDirectory:join(f.root,'missing'),enabled:true});assert.equal((await missing.start({requestId:'image-1',scope:scoped})).status,'pending');assert.equal(created,0);
 const active=createCursorGalleryProvider({bridge,workspace:f.root,stateDirectory:join(f.root,'present'),enabled:true,reference:{bytes:png}});
 assert.equal((await active.start({requestId:'image-2',scope:scoped})).status,'pending');assert.equal(received.length,1);assert.equal(received[0].type,'image');assert.equal(received[0].mimeType,'image/png');assert.deepEqual(Buffer.from(received[0].data,'base64'),png);assert.equal(created,1);
});
test('site-specific frozen image skill is included and persisted before the prompt is sent',async t=>{
 const f=await fixture(t),stateDirectory=join(f.root,'policy-state'),policy=await fixtureImagePolicy({siteId:'metho',workspaceId:'metho',referenceSha256:f.digest});let sent;
 const bridge={async call(method,args){if(method==='task_create')return {id:'task-policy'};if(method==='gallery_prompt'){const saved=JSON.parse(await readFile(join(stateDirectory,protocol.hash('image-policy')+'.json'),'utf8'));assert.equal(saved.prompt,args.text);assert.equal(saved.imagePolicyHash,policy.snapshotHash);sent=args.text;return {runId:'run-policy'};}if(method==='task_get')return {id:'task-policy',agentId:'cursor',mode:'image',runtime:{busy:true},assets:[]};if(method==='status')return {busy:true,pending:[],history:[]};throw Error('unexpected');}};
 const provider=createCursorGalleryProvider({bridge,workspace:f.root,stateDirectory,enabled:true,reference:{bytes:png}});
 await provider.start({requestId:'image-policy',scope:{...scope,referenceSha256:f.digest,imagePolicy:policy}});assert.match(sent,/Synthetic image policy for tests only/);
});
