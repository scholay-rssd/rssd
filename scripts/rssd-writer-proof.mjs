// Adapter for a separately installed, authenticated live writer-proof
// command. It does not contain a host-specific path or execute SSH itself.
import {randomBytes} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';

const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function createWriterProofAdapter({execute,expected,clock=Date.now,maxAgeMs=60000}){
 if(typeof execute!=='function'||typeof expected!=='function'||typeof clock!=='function')throw Error('Explicit live proof executor and expected cutover evidence are required');
 protocol.integer(maxAgeMs,'maxAgeMs',1000,60000);
 return async({slot,signal})=>{
  if(signal?.aborted)throw Object.assign(Error('Writer proof cancelled'),{name:'AbortError'});
  const siteId=protocol.id(slot?.siteId,'siteId'),workspaceId=protocol.id(slot?.workspaceId,'workspaceId'),nonce=randomBytes(32).toString('hex');
  const baseline=await expected({siteId,workspaceId,signal});
  if(baseline?.siteId!==siteId||baseline.workspaceId!==workspaceId||typeof baseline.runId!=='string'||!baseline.runId||!digest(baseline.baselineSha256)||!digest(baseline.artifactManifestSha256)||typeof baseline.receiverUnit!=='string'||!baseline.receiverUnit||typeof baseline.artifactRevision!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(baseline.artifactRevision))throw Error('Expected cutover evidence is missing');
  const p=await execute({siteId,workspaceId,runId:baseline.runId,nonce,signal});
  if(signal?.aborted)throw Object.assign(Error('Writer proof cancelled'),{name:'AbortError'});
  const observed=Date.parse(p?.observedAt||''),now=Number(clock()),old=p?.oldWriter,receiver=p?.receiver;
  if(p?.version!==1||p.siteId!==siteId||p.workspaceId!==workspaceId||p.runId!==baseline.runId||p.nonce!==nonce||!Number.isFinite(observed)||!Number.isFinite(now)||observed>now+1000||now-observed>maxAgeMs||old?.adminActive!==true||old.readOnlyFence!==true||old.inFlight!==0||old.publisherStopped!==true||old.persistentHold!==true||old.queueInFlight!==0||receiver?.unit!==baseline.receiverUnit||receiver.active!==true||receiver.accepting!==true||receiver.baselineSha256!==baseline.baselineSha256||receiver.artifactManifestSha256!==baseline.artifactManifestSha256||receiver.artifactRevision!==baseline.artifactRevision||typeof receiver.publicRelease!=='string'||!receiver.publicRelease.trim())throw Error('Live writer proof did not match current cutover evidence');
  return {siteId,workspaceId,runId:p.runId,baselineSha256:receiver.baselineSha256,artifactManifestSha256:receiver.artifactManifestSha256,artifactRevision:receiver.artifactRevision,observedAt:p.observedAt,oldWriterStopped:true,contentFenceReadOnly:true,queueDrained:true,inFlight:0,exclusiveWriter:true};
 };
}
