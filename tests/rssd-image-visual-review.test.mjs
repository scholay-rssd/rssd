import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {requireVisualReview,verifyStoredVisualReview} from '../scripts/rssd-image-visual-review.mjs';
import {approveSyntheticReviews} from './fixtures/rssd-image-policy.mjs';

test('independent visual receipt binds exact bytes, original image request and policy',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-visual-review-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const bytes=Buffer.from('synthetic test bytes'),jobId='job',slot={blockId:'hero'},requestId='image-original',scope={jobId,blockId:slot.blockId,imagePolicy:{snapshotHash:'a'.repeat(64)},referenceSha256:'b'.repeat(64)};
 const args={directory,jobId,slot,requestId,scope,bytes};await assert.rejects(requireVisualReview(args),{code:'image_pending'});
 const root=join(directory,'image-visual-review'),files=await readdir(root),name=files.find(x=>x.endsWith('.request.json')),request=JSON.parse(await readFile(join(root,name),'utf8'));
 assert.equal(request.scopeHash,protocol.hash(scope));assert.equal(request.imagePolicyHash,'a'.repeat(64));assert.equal(request.imageSha256,createHash('sha256').update(bytes).digest('hex'));
 await approveSyntheticReviews(directory);const receiptPath=join(root,name.replace('.request.json','.receipt.json')),receipt=JSON.parse(await readFile(receiptPath,'utf8'));
 assert.equal((await requireVisualReview(args)).requestHash,request.requestHash);
 await writeFile(receiptPath,JSON.stringify({...receipt,decision:'rejected'}));await assert.rejects(requireVisualReview(args),{code:'image_pending'});
 await writeFile(receiptPath,JSON.stringify({...receipt,imageSha256:'f'.repeat(64)}));await assert.rejects(requireVisualReview(args),{code:'image_pending'});
 await writeFile(receiptPath,JSON.stringify(receipt));await assert.rejects(requireVisualReview({...args,scope:{...scope,imagePolicy:{snapshotHash:'c'.repeat(64)}}}),{code:'image_pending'});
 await assert.rejects(requireVisualReview({...args,bytes:Buffer.from('changed bytes')}),{code:'image_pending'});
});

test('legacy requests retain their original scope, and outbox review reads only matching saved evidence',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-visual-legacy-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const bytes=Buffer.from('old synthetic image'),jobId='old-job',blockId='hero',requestId='image-old',scope={jobId,blockId,requirement:'original old scope'},imageSha256=createHash('sha256').update(bytes).digest('hex'),image={blockId,requestId,manifest:{sha256:imageSha256},uploaded:true};
 const args={directory,jobId,slot:{blockId},requestId,scope,bytes};await assert.rejects(requireVisualReview(args),{code:'image_pending'});
 const stage=join(directory,'image-staging');await mkdir(stage);const stateFile=join(stage,protocol.hash([jobId,blockId])+'.json'),{uploaded,...result}=image;await writeFile(stateFile,JSON.stringify({requestId,scope,status:'staged',manifest:image.manifest,result}));
 await assert.rejects(verifyStoredVisualReview({directory,jobId,image}),{code:'image_pending'});
 await approveSyntheticReviews(directory);await verifyStoredVisualReview({directory,jobId,image});
 assert.deepEqual(JSON.parse(await readFile(stateFile,'utf8')).scope,scope);
 await assert.rejects(verifyStoredVisualReview({directory,jobId,image:{...image,requestId:'image-replacement'}}),{code:'image_pending'});
 await assert.rejects(verifyStoredVisualReview({directory,jobId,image:{...image,manifest:{sha256:'f'.repeat(64)}}}),{code:'image_pending'});
});
