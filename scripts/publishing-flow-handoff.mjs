// Cloud results are evidence only. A separate, exact local grant selects the
// Postiz accounts and freezes draft delivery without creating a local flow job.
import {join,isAbsolute} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {optional,externalPackage,validateFlowPolicy} from './publishing-flow.mjs';
import {readCloudContinuationEvidence,continuationArtifactSha256} from './publishing-flow-artifact.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {durableWriteJson} from './durable-json.mjs';

const grantKeys=['version','siteId','articleId','revision','sha256','artifactSha256','targets','mode','authorization'];
const bindingKeys=['version','jobId','planId','batchId','manifestSha256','section','requestKey','grant'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const fail=message=>{throw Error('Cloud Postiz handoff: '+message);};
const authorizationFile=(directory,jobId)=>join(directory,'cloud-authorizations',jobId+'.json');

function validateGrant(grant,evidence){
 const {plan,artifactSha256}=evidence;
 if(!exact(grant,grantKeys)||grant.version!==1||grant.mode!=='draft'||typeof grant.authorization!=='string'||!grant.authorization.trim()||grant.authorization.length>2000)fail('an explicit per-article draft authorization is required');
 for(const key of ['siteId','articleId','revision','sha256'])if(grant[key]!==plan[key])fail('the authorization source differs from the completed article');
 if(grant.artifactSha256!==artifactSha256)fail('the authorization artifact differs from the completed translation');
 if(!Array.isArray(grant.targets)||!grant.targets.length)fail('select at least one exact destination');
 for(const target of grant.targets){
  const keys=target.platform==='discord'?['platform','locale','integrationId','channelId','format']:['platform','locale','integrationId','format'];
  if(target.platform==='devto'&&target.username!==undefined){keys.push('username');if(typeof target.username!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(target.username))fail('the DEV.to username must identify one author');}
  if(!exact(target,keys))fail('destinations must name exact accounts and supported settings');
 }
 validateFlowPolicy({version:1,siteId:plan.siteId,origin:plan.origin,enabled:true,authorization:grant.authorization,articleIds:[plan.articleId],targets:grant.targets},{id:plan.siteId,origin:plan.origin,languages:['en']});
 return grant;
}

async function immutable(file,value){
 const prior=await optional(file);
 if(prior){if(!isDeepStrictEqual(prior,value))fail('the frozen authorization or packet differs; retain the original');return;}
 await durableWriteJson(file,value);
}

function bind(evidence,frozen){
 const plan={...evidence.plan,policy:{authorization:frozen.grant.authorization,targets:frozen.grant.targets}};
 return {...evidence,plan,authorization:frozen,authorizationSha256:continuationArtifactSha256(frozen)};
}

export function cloudHandoffPacket(evidence,target){
 const frozen=evidence.authorization;
 if(!frozen?.grant.targets.some(item=>isDeepStrictEqual(item,target)))fail('the packet destination is outside the frozen authorization');
 return {...externalPackage(evidence.plan,target,evidence.state.edition,evidence.state.community.url),cloudContinuation:{version:1,jobId:evidence.jobId,artifactSha256:evidence.artifactSha256,authorizationSha256:evidence.authorizationSha256,batchId:frozen.batchId,mode:'draft'}};
}

export async function readCloudHandoffEvidence({root,siteId,articleId,receipt,handoffDirectory,batchId,manifestSha256,section}){
 if(!isAbsolute(root||'')||!isAbsolute(handoffDirectory||''))fail('absolute workspace and handoff directories are required');
 const evidence=await readCloudContinuationEvidence({root,siteId,articleId,receipt});if(!evidence)return null;
 const frozen=await optional(authorizationFile(handoffDirectory,evidence.jobId));if(!frozen)return null;
 if(!exact(frozen,bindingKeys)||frozen.version!==1||frozen.jobId!==evidence.jobId||frozen.planId!==evidence.plan.id||frozen.requestKey!==receipt.requestKey||frozen.batchId!==batchId||frozen.manifestSha256!==manifestSha256||frozen.section!==section)fail('the frozen authorization does not belong to this publication batch');
 validateGrant(frozen.grant,evidence);return bind(evidence,frozen);
}

async function prepare(options,{writeAuthorization=false,writePackets=false}={}){
 const {root,siteId,articleId,receipt,handoffDirectory,authorization,batchId}=options;
 if(!isAbsolute(root||'')||!isAbsolute(handoffDirectory||''))fail('absolute workspace and handoff directories are required');
 const evidence=await readCloudContinuationEvidence({root,siteId,articleId,receipt});
 if(!evidence)return {status:'waiting_for_artifact'};
 const prior=await optional(authorizationFile(handoffDirectory,evidence.jobId));
 if(!authorization&&!prior)return {status:'waiting_for_authorization',jobId:evidence.jobId,artifactSha256:evidence.artifactSha256};
 // The batch reads production results and the on-disk receipt itself. Callers
 // cannot supply a made-up batch binding or silently claim an older article.
 const {findCloudBatchOwner}=await import('./publishing-batch.mjs');
 const owner=await findCloudBatchOwner(handoffDirectory,{root,siteId,articleId,receipt,evidence,batchId});
 const grant=validateGrant(authorization||prior.grant,evidence);
 const frozen={version:1,jobId:evidence.jobId,planId:evidence.plan.id,batchId:owner.batchId,manifestSha256:owner.manifestSha256,section:owner.section,requestKey:receipt.requestKey,grant:structuredClone(grant)};
 if(prior&&!isDeepStrictEqual(prior,frozen))fail('the original authorization must be preserved when resuming');
 if(!prior&&!writeAuthorization)return {status:'waiting_for_authorization',jobId:evidence.jobId,artifactSha256:evidence.artifactSha256};
 const bound=bind(evidence,frozen),packets=grant.targets.map(target=>cloudHandoffPacket(bound,target));
 // Validate every destination before emitting any packet. The existing slot
 // receipt still owns uncertain writes, including an earlier local flow.
 for(const packet of packets){
  const slot=await optional(join(handoffDirectory,'slots',packet.slot+'.json'));
  if(slot&&slot.id!==packet.id)fail('this article and account already have another delivery revision');
  const old=await optional(join(handoffDirectory,'outbox',packet.id+'.json'));
  if(old&&!isDeepStrictEqual(old,packet))fail('an existing packet differs from this frozen handoff');
 }
 if(writeAuthorization)await immutable(authorizationFile(handoffDirectory,evidence.jobId),frozen);
 if(writePackets)for(const packet of packets)await immutable(join(handoffDirectory,'outbox',packet.id+'.json'),packet);
 return {status:writePackets?'ready':'authorized',jobId:evidence.jobId,artifactSha256:evidence.artifactSha256,authorizationSha256:bound.authorizationSha256,batchId:owner.batchId,packets:packets.map(packet=>packet.id)};
}

export const authorizeCloudHandoff=options=>withFileLock(join(options.handoffDirectory,'postiz.lock'),()=>prepare(options,{writeAuthorization:true}),{timeout:120000});
export const handoffCloudContinuation=options=>withFileLock(join(options.handoffDirectory,'postiz.lock'),()=>prepare(options,{writeAuthorization:Boolean(options.authorization),writePackets:true}),{timeout:120000});

// Recovery cohorts reuse the exact ordinary grant and packet encoding.
export {validateGrant as validateCloudHandoffGrant,bind as bindCloudHandoffEvidence};
