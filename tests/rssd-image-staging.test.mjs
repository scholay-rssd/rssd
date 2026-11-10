import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageRequiredImage,prepareAndUploadRequiredImages} from '../scripts/rssd-image-staging.mjs';
import {uploadPacketMedia} from '../scripts/rssd-device-media.mjs';
import media from '../contracts/rssd-media.cjs';
import {fixtureImagePolicy,fixtureReferenceSha,approveSyntheticReviews} from './fixtures/rssd-image-policy.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
const slot={blockId:'hero',requirement:'A synthetic diagram for a test',alt:'一张用于测试的八乘八像素合成图片不代表任何真实研究',caption:'合成测试示意图',referenceSha256:fixtureReferenceSha};
const fixture=async t=>{const home=await mkdtemp(join(tmpdir(),'rssd-image-stage-'));t.after(()=>rm(home,{recursive:true,force:true}));return {home,jobDirectory:join(home,'job'),client:{origin:'https://center.example'},siteId:'metho',workspaceId:'metho',jobId:'job-1',slot,resolveImagePolicy:fixtureImagePolicy};};

test('missing provider blocks required image without inventing an asset',async t=>{
 const x=await fixture(t);await assert.rejects(stageRequiredImage(x),{code:'image_pending'});
});
test('a new site image request requires an explicit policy before calling any provider',async t=>{
 const x=await fixture(t);let called=0;
 const provider={id:'synthetic',async start(){called++;},async lookup(){called++;}};
 await assert.rejects(stageRequiredImage({...x,provider,resolveImagePolicy:undefined}),{code:'image_pending'});assert.equal(called,0);
});

test('uncertain generation resumes by original request id and uploads by content hash once',async t=>{
 const x=await fixture(t);let starts=0,lookups=0,original;
 const provider={id:'synthetic',async start({requestId}){starts++;original=requestId;return {status:'pending'};},async lookup({requestId}){lookups++;assert.equal(requestId,original);return {status:'ready',bytes:png,registration:{assetId:'asset-1',taskId:'task-1',sha256:media.imageManifest(png).sha256},provenance:{kind:'generated',provider:'synthetic'}};}};
 await assert.rejects(stageRequiredImage({...x,provider}),{code:'image_pending'});
 await assert.rejects(stageRequiredImage({...x,provider}),{code:'image_pending'});await approveSyntheticReviews(x.jobDirectory);
 const image=await stageRequiredImage({...x,provider});assert.equal(starts,1);assert.equal(lookups,2);assert.equal(image.manifest.bytes,png.length);assert.equal(image.reused,false);
 const same=await stageRequiredImage({...x,provider});assert.equal(same.id,image.id);assert.equal(same.reused,true);assert.equal(starts,1);assert.equal(lookups,2);
 const records=new Map();let uploads=0;
 const client={origin:x.client.origin,async request(path,options){if(options?.method==='POST'){uploads++;const id=image.id;const row={id,workspaceId:x.workspaceId,manifest:{sha256:options.body.sha256,mime:options.body.mime,bytes:options.body.bytes,path:options.body.path}};records.set(id,row);return row;}const id=path.split('/').pop();if(!records.has(id))throw Object.assign(Error('missing'),{status:404});return records.get(id);}};
 const packet={workspaceId:x.workspaceId,editions:[{media:[{id:image.id,alt:image.alt}]}]};
 await uploadPacketMedia({packet,directory:join(x.home,'media'),client});await uploadPacketMedia({packet,directory:join(x.home,'media'),client});assert.equal(uploads,1);
 const images=await prepareAndUploadRequiredImages({...x,slots:[slot],provider,client});assert.equal(images[0].id,image.id);assert.equal(uploads,1);
 await assert.rejects(prepareAndUploadRequiredImages({...x,slots:[],provider,client}),{code:'image_pending'});
 const bytes=await readFile(join(x.home,'media',(await import('../contracts/rssd-v1.cjs')).default.hash([client.origin,x.workspaceId,image.id])+'.image'));assert.deepEqual(bytes,png);
});

test('bad image data and changed slot fail closed with original request retained',async t=>{
 const x=await fixture(t);let calls=0;
 const provider={id:'synthetic',async start(){calls++;return {status:'ready',bytes:Buffer.from('not an image'),provenance:{kind:'generated'}};},async lookup(){return {status:'pending'};}};
 await assert.rejects(stageRequiredImage({...x,provider}));
 await assert.rejects(stageRequiredImage({...x,slot:{...slot,requirement:'A different request'},provider}),/changed/);
 await assert.rejects(stageRequiredImage({...x,provider}),{code:'image_pending'});assert.equal(calls,1);
});

test('an unfinished second required slot stops the whole image stage before upload',async t=>{
 const x=await fixture(t);let uploads=0;
 const ready={status:'ready',bytes:png,registration:{assetId:'asset-1',taskId:'task-1',sha256:media.imageManifest(png).sha256},provenance:{kind:'generated'}};
 const provider={id:'synthetic',async start({scope}){return scope.blockId==='hero'?ready:{status:'pending'};},async lookup({scope}){return scope.blockId==='hero'?ready:{status:'pending'};}};
 const client={origin:x.client.origin,async request(){uploads++;throw Error('unexpected upload');}};
 await assert.rejects(prepareAndUploadRequiredImages({...x,slots:[slot,{...slot,blockId:'body'}],client,provider}),{code:'image_pending'});await approveSyntheticReviews(x.jobDirectory);
 await assert.rejects(prepareAndUploadRequiredImages({...x,slots:[slot,{...slot,blockId:'body'}],client,provider}),{code:'image_pending'});assert.equal(uploads,0);
});

test('a pre-query pending request is looked up under its exact original ID',async t=>{
 const x=await fixture(t),protocol=(await import('../contracts/rssd-v1.cjs')).default,{mkdir,writeFile}=await import('node:fs/promises');
 const scope={origin:x.client.origin,workspaceId:x.workspaceId,jobId:x.jobId,blockId:slot.blockId,requirement:slot.requirement,alt:slot.alt,caption:slot.caption,referenceSha256:slot.referenceSha256},requestId='image-'+protocol.hash(scope).slice(0,48),dir=join(x.jobDirectory,'image-staging');await mkdir(dir,{recursive:true});await writeFile(join(dir,protocol.hash([x.jobId,slot.blockId])+'.json'),JSON.stringify({version:1,scope,requestId,providerId:'synthetic',status:'pending'}));
 let starts=0,lookups=0;const provider={id:'synthetic',async start(){starts++;},async lookup(input){lookups++;assert.equal(input.requestId,requestId);assert.deepEqual(input.scope,scope);return {status:'pending'};}};
 await assert.rejects(stageRequiredImage({...x,provider}),{code:'image_pending'});assert.equal(starts,0);assert.equal(lookups,1);
});
