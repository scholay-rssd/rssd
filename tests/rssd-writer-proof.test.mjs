import test from 'node:test';
import assert from 'node:assert/strict';
import {createWriterProofAdapter} from '../scripts/rssd-writer-proof.mjs';
import {runMultisiteSupervisor} from '../scripts/rssd-multisite-supervisor.mjs';
const now=Date.parse('2026-11-02T00:00:00Z'),slot={siteId:'enter',workspaceId:'enter'};
const expected={...slot,runId:'run-one',receiverUnit:'receiver@enter',baselineSha256:'a'.repeat(64),artifactManifestSha256:'b'.repeat(64),artifactRevision:'revision-one'};
const live=({nonce})=>({version:1,...slot,runId:'run-one',nonce,observedAt:new Date(now).toISOString(),oldWriter:{adminActive:true,readOnlyFence:true,inFlight:0,publisherStopped:true,persistentHold:true,queueInFlight:0},receiver:{unit:expected.receiverUnit,active:true,accepting:true,baselineSha256:expected.baselineSha256,artifactManifestSha256:expected.artifactManifestSha256,artifactRevision:expected.artifactRevision,publicRelease:'admin-release'}});
test('proof is fresh, nonce-bound and excludes host data',async()=>{
 const nonces=[],read=createWriterProofAdapter({expected:async()=>expected,clock:()=>now,execute:async x=>{nonces.push(x.nonce);return live(x);}});
 const proof=await read({slot});await read({slot});assert.equal(nonces[0].length,64);assert.notEqual(nonces[0],nonces[1]);assert.equal(proof.artifactRevision,expected.artifactRevision);assert.equal(proof.exclusiveWriter,true);assert.equal(proof.nonce,undefined);
});
test('stale, replayed, mismatched and unfenced proofs fail closed',async()=>{
 const mutations=[p=>p.nonce='0'.repeat(64),p=>p.observedAt='2026-10-01T00:00:00Z',p=>p.oldWriter.queueInFlight=1,p=>p.receiver.artifactRevision='wrong',p=>p.receiver.baselineSha256='c'.repeat(64),p=>p.runId='wrong'];
 for(const mutate of mutations){const read=createWriterProofAdapter({expected:async()=>expected,clock:()=>now,execute:async x=>{const p=live(x);mutate(p);return p;}});await assert.rejects(read({slot}),/did not match/);}
});
test('supervisor stays disabled without configuration or service access',async()=>{assert.deepEqual(await runMultisiteSupervisor(),{state:'disabled'});});
