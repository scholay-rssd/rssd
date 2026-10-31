#!/usr/bin/env node
// Explicit, immutable recovery of exact cloud drafts. This is not a new batch:
// every member retains its original manifest, producer result and request.
import {readFile,readdir} from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {optional,hash,postizTick} from './publishing-flow.mjs';
import {validateBatchManifest} from './publishing-batch.mjs';
import {continuationArtifactSha256,readCloudContinuationEvidence} from './publishing-flow-artifact.mjs';
import {validateCloudHandoffGrant,bindCloudHandoffEvidence,cloudHandoffPacket} from './publishing-flow-handoff.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {durableWriteJson} from './durable-json.mjs';

const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{3,128}$/.test(value);
const hex=(value,length=64)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const fail=message=>{throw Error('Draft recovery cohort: '+message);};
const cohortPath=(directory,name)=>join(directory,'recovery-cohorts',name+'.json');
const memberKeys=['batchId','manifestSha256','section','siteId','articleId','requestKey','jobId','planId','revision','sha256','artifactSha256','grant'];
const sourceKey=value=>value.siteId+'/'+value.articleId;
const list=async directory=>(await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).filter(name=>name.endsWith('.json')).sort();

export function validateRecoveryCohort(cohort){
 if(!exact(cohort,['version','id','mode','authorization','expectedArticles','members'])||cohort.version!==1||!id(cohort.id)||cohort.mode!=='draft'||typeof cohort.authorization!=='string'||!cohort.authorization.trim()||cohort.authorization.length>4000)fail('an explicit draft-only cohort authorization is required');
 if(!Number.isSafeInteger(cohort.expectedArticles)||cohort.expectedArticles<1||cohort.expectedArticles>500||!Array.isArray(cohort.members)||cohort.members.length!==cohort.expectedArticles)fail('the exact authorized article count must match the member list');
 const sources=new Set(),jobs=new Set();
 for(const member of cohort.members){
  if(!exact(member,memberKeys)||!id(member.batchId)||!id(member.siteId)||!id(member.articleId)||!hex(member.manifestSha256)||!hex(member.jobId)||!hex(member.planId,40)||!hex(member.sha256)||!hex(member.artifactSha256)||!Number.isSafeInteger(member.revision)||member.revision<1||typeof member.requestKey!=='string'||!/^[a-zA-Z0-9_-]{12,128}$/.test(member.requestKey)||typeof member.section!=='string'||!member.section.startsWith(member.siteId+'/'))fail('invalid frozen member identity');
  if(sources.has(sourceKey(member))||jobs.has(member.jobId))fail('duplicate article or cloud job in the recovery scope');
  sources.add(sourceKey(member));jobs.add(member.jobId);
 }
 return cohort;
}

async function readRecords(directory){
 const records=[];
 for(const name of await list(join(directory,'recovery-cohorts'))){
  if(!id(name.slice(0,-5)))fail('invalid retained cohort filename');
  const record=await optional(join(directory,'recovery-cohorts',name));
  if(!exact(record,['version','cohort','cohortSha256','bindings'])||record.version!==1)fail('invalid retained recovery record');
  validateRecoveryCohort(record.cohort);
  if(record.cohort.id+'.json'!==name||continuationArtifactSha256(record.cohort)!==record.cohortSha256||!Array.isArray(record.bindings)||record.bindings.length!==record.cohort.members.length)fail('retained recovery scope changed');
  const packetIds=new Set();
  for(let index=0;index<record.bindings.length;index++){
   const binding=record.bindings[index],member=record.cohort.members[index];
   if(!exact(binding,['jobId','authorizationSha256','packets'])||binding.jobId!==member.jobId||!hex(binding.authorizationSha256)||!Array.isArray(binding.packets)||binding.packets.length!==member.grant.targets?.length)fail('invalid retained recovery packet bindings');
   for(const packet of binding.packets){if(!exact(packet,['id','bodySha256'])||!hex(packet.id,40)||!hex(packet.bodySha256)||packetIds.has(packet.id))fail('invalid or duplicate recovery packet identity');packetIds.add(packet.id);}
  }
  records.push(record);
 }
 return records;
}

async function batchResults(state){
 if(!Array.isArray(state.baselineResults))fail('the original batch baseline is missing');
 if(state.productionResults!==undefined){if(!Array.isArray(state.productionResults))fail('invalid frozen producer results');return state.productionResults;}
 const baseline=new Set(state.baselineResults),results=[];
 for(const name of (await readdir(state.manifest.resultsDirectory)).filter(name=>name.endsWith('.result.json')).sort()){
  if(!baseline.has(name)){const result=await optional(join(state.manifest.resultsDirectory,name));if(result)results.push(result);}
 }
 return results;
}

async function retainedBatches(directory){
 const current=await optional(join(directory,'today-batch.json'));
 if(current?.version!==1||!['idle','producing','settled','complete'].includes(current.status))fail('retain the original valid Today batch gate');
 const states=current.status==='idle'?[]:[current];
 for(const name of await list(join(directory,'today-batches'))){
  if(!id(name.slice(0,-5)))continue;
  const state=await optional(join(directory,'today-batches',name));
  if(state?.id+'.json'!==name)fail('an archived batch identity changed');states.push(state);
 }
 const ids=new Set();
 for(const state of states){
  if(state?.version!==1||!id(state.id)||!['producing','settled','complete'].includes(state.status)||ids.has(state.id))fail('the retained owner is ambiguous or invalid');
  ids.add(state.id);validateBatchManifest(state.manifest);
 }
 return Promise.all(states.map(async state=>({state,results:await batchResults(state)})));
}

function authorizePolicy(policy,member){
 if(!policy?.enabled||typeof policy.authorization!=='string'||!policy.authorization.trim()||!Array.isArray(policy.sources)||!Array.isArray(policy.targets))fail('retain the separately authorized Postiz policy');
 if(!policy.sources.some(source=>source.siteId===member.siteId&&(source.articleId==='*'||source.articleId===member.articleId&&source.sha256===member.sha256)))fail('the article is outside the existing Postiz source policy');
 for(const target of member.grant.targets||[])if(!policy.targets.some(allowed=>isDeepStrictEqual(allowed,target)))fail('the exact destination is outside the existing Postiz policy');
}

async function prepareMember(directory,member,batches,policy){
 authorizePolicy(policy,member);
 // Other articles in this section do not invalidate this exact result. A
 // second owner, section or request for this same article remains ambiguous.
 const owners=batches.map(batch=>({...batch,matches:batch.results.filter(result=>result?.site===member.siteId&&result.articleId===member.articleId&&!result.noPublish)})).filter(batch=>batch.matches.length);
 if(owners.length!==1||owners[0].state.id!==member.batchId)fail('the article has no unique original batch owner');
 const {state,matches}=owners[0];
 if(hash(state.manifest)!==member.manifestSha256)fail('the original batch manifest changed');
 if(matches.some(result=>member.siteId+'/'+result.sectionId!==member.section||result.requestKey!==member.requestKey))fail('the original producer result has an ambiguous section or request');
 const entries=state.manifest.entries.filter(entry=>entry.siteId+'/'+entry.sectionId===member.section);
 if(entries.length!==1||!entries[0].requireFlow||entries[0].siteId==='pets')fail('the article is not an original academic continuation');
 const entry=entries[0],receipt=await optional(join(entry.publicationDirectory,member.articleId,'receipt.json'));
 if(receipt?.requestKey!==member.requestKey||receipt.revision!==member.revision||receipt.asyncQueue?.continuationOwner!=='cloud'||receipt.asyncQueue.jobId!==member.jobId)fail('the original accepted cloud request changed');
 const evidence=await readCloudContinuationEvidence({root:entry.root,siteId:member.siteId,articleId:member.articleId,receipt});
 if(!evidence)fail('the complete cloud translation artifact is still pending');
 const {plan}=evidence;
 for(const key of ['siteId','articleId','revision','sha256'])if(plan[key]!==member[key])fail('the completed source differs from the authorized recovery member');
 if(plan.id!==member.planId||evidence.jobId!==member.jobId||evidence.artifactSha256!==member.artifactSha256)fail('the completed cloud job or artifact changed');
 if(!evidence.state.complete||['chinese','english','community'].some(stage=>evidence.state[stage]?.status!=='verified')||evidence.state.chinese.revision!==member.revision)fail('all internal publication evidence must be complete');
 validateCloudHandoffGrant(member.grant,evidence);
 const frozen={version:1,jobId:member.jobId,planId:member.planId,batchId:member.batchId,manifestSha256:member.manifestSha256,section:member.section,requestKey:member.requestKey,grant:structuredClone(member.grant)};
 const bound=bindCloudHandoffEvidence(evidence,frozen),packets=member.grant.targets.map(target=>cloudHandoffPacket(bound,target));
 const binding={jobId:member.jobId,authorizationSha256:bound.authorizationSha256,packets:packets.map(packet=>({id:packet.id,bodySha256:packet.bodySha256}))};
 return {member,entry,receipt,evidence,bound,frozen,packets,binding};
}

async function prepareCohort(directory,cohort){
 validateRecoveryCohort(cohort);const batches=await retainedBatches(directory),policy=await optional(join(directory,'postiz-policy.json')),prepared=[];
 for(const member of cohort.members)prepared.push(await prepareMember(directory,member,batches,policy));
 return prepared;
}

async function ensureNoConflicts(directory,prepared){
 for(const {frozen,packets} of prepared){
  const oldGrant=await optional(join(directory,'cloud-authorizations',frozen.jobId+'.json'));
  if(oldGrant&&!isDeepStrictEqual(oldGrant,frozen))fail('retain the original per-article authorization');
  for(const packet of packets){
   const slot=await optional(join(directory,'slots',packet.slot+'.json')),old=await optional(join(directory,'outbox',packet.id+'.json')),receipt=await optional(join(directory,'receipts',packet.id+'.json'));
   if(slot&&slot.id!==packet.id)fail('an earlier delivery already owns the article/account slot');
   if(old&&!isDeepStrictEqual(old,packet))fail('retain the original exact outbox packet');
   if(receipt&&(receipt.id!==packet.id||receipt.bodySha256!==packet.bodySha256||receipt.delivery?.mode!=='draft'))fail('an existing receipt must be reconciled in its original delivery mode');
  }
 }
}

async function immutable(file,value){const old=await optional(file);if(old){if(!isDeepStrictEqual(old,value))fail('the frozen recovery authorization cannot be replaced');}else await durableWriteJson(file,value);}
function requireDirectory(directory){if(!isAbsolute(directory||''))fail('an absolute original handoff directory is required');}
const summary=record=>({id:record.cohort.id,mode:'draft',articles:record.cohort.members.length,packets:record.bindings.reduce((sum,binding)=>sum+binding.packets.length,0),cohortSha256:record.cohortSha256});

export async function authorizeRecoveryCohort({handoffDirectory,cohort}){
 requireDirectory(handoffDirectory);
 return withFileLock(join(handoffDirectory,'postiz.lock'),async()=>{
  validateRecoveryCohort(cohort);const records=await readRecords(handoffDirectory);
  for(const record of records)if(record.cohort.id!==cohort.id&&record.cohort.members.some(old=>cohort.members.some(member=>sourceKey(member)===sourceKey(old)||member.jobId===old.jobId)))fail('this article already belongs to another frozen recovery cohort');
  const prior=records.find(record=>record.cohort.id===cohort.id);
  if(prior&&!isDeepStrictEqual(prior.cohort,cohort))fail('retain the original exact recovery cohort');
  const prepared=await prepareCohort(handoffDirectory,cohort);await ensureNoConflicts(handoffDirectory,prepared);
  const record={version:1,cohort:structuredClone(cohort),cohortSha256:continuationArtifactSha256(cohort),bindings:prepared.map(value=>value.binding)};
  await immutable(cohortPath(handoffDirectory,cohort.id),record);return {...summary(record),status:'authorized'};
 },{timeout:120000});
}

async function selectedRecord(directory,name){if(!id(name))fail('invalid cohort ID');const record=(await readRecords(directory)).find(value=>value.cohort.id===name);if(!record)fail('the frozen recovery cohort does not exist');return record;}
function verifyBindings(record,prepared){if(!isDeepStrictEqual(record.bindings,prepared.map(value=>value.binding)))fail('the frozen recovery packet or grant binding changed');}

export async function handoffRecoveryCohort({handoffDirectory,id:name}){
 requireDirectory(handoffDirectory);
 return withFileLock(join(handoffDirectory,'postiz.lock'),async()=>{
  const record=await selectedRecord(handoffDirectory,name),prepared=await prepareCohort(handoffDirectory,record.cohort);verifyBindings(record,prepared);await ensureNoConflicts(handoffDirectory,prepared);
  // Validate every member before the first write. A restart resumes these
  // identical files; Postiz itself remains the only delivery consumer.
  for(const item of prepared){
   await immutable(join(handoffDirectory,'cloud-authorizations',item.frozen.jobId+'.json'),item.frozen);
   for(const packet of item.packets)await immutable(join(handoffDirectory,'outbox',packet.id+'.json'),packet);
  }
  return {...summary(record),status:'ready',packetIds:prepared.flatMap(item=>item.packets.map(packet=>packet.id))};
 },{timeout:120000});
}

async function matchingMember(directory,{siteId,articleId,planId,jobId}){
 const matches=[];
 for(const record of await readRecords(directory))for(let index=0;index<record.cohort.members.length;index++){
  const member=record.cohort.members[index];
  if(member.siteId===siteId&&member.articleId===articleId||planId&&member.planId===planId||jobId&&member.jobId===jobId)matches.push({record,member,index});
 }
 if(matches.length>1)fail('the article recovery scope is ambiguous');return matches[0];
}

async function prepareMatch(directory,match){
 const prepared=await prepareMember(directory,match.member,await retainedBatches(directory),await optional(join(directory,'postiz-policy.json')));
 if(!isDeepStrictEqual(prepared.binding,match.record.bindings[match.index]))fail('the frozen recovery packet or grant binding changed');return prepared;
}

export async function findRecoveryCloudOwner({handoffDirectory,root,siteId,articleId,receipt,evidence,batchId}){
 const match=await matchingMember(handoffDirectory,{siteId,articleId,planId:evidence?.plan?.id,jobId:evidence?.jobId});if(!match)return null;
 const item=await prepareMatch(handoffDirectory,match),member=item.member;
 if(resolve(root)!==resolve(item.entry.root)||receipt.requestKey!==member.requestKey||!isDeepStrictEqual(evidence,item.evidence)||batchId!==undefined&&batchId!==member.batchId)fail('the handoff differs from its original recovery owner');
 return {batchId:member.batchId,manifestSha256:member.manifestSha256,section:member.section};
}

export async function verifyRecoveryCloudPacket({handoffDirectory,packet}){
 const match=await matchingMember(handoffDirectory,{siteId:packet.source?.siteId,articleId:packet.source?.articleId,planId:packet.planId,jobId:packet.cloudContinuation?.jobId});if(!match)return false;
 if(packet.cloudContinuation?.mode!=='draft')fail('recovery only permits the original cloud draft');
 const item=await prepareMatch(handoffDirectory,match),grant=await optional(join(handoffDirectory,'cloud-authorizations',item.member.jobId+'.json'));
 if(!isDeepStrictEqual(grant,item.frozen)||!item.packets.some(expected=>isDeepStrictEqual(expected,packet)))fail('the draft differs from its frozen grant, target or complete body');
 return true;
}

export async function recoveryCohortStatus({handoffDirectory,id:name}){
 requireDirectory(handoffDirectory);const record=await selectedRecord(handoffDirectory,name),prepared=await prepareCohort(handoffDirectory,record.cohort);verifyBindings(record,prepared);
 const members=[];
 for(const item of prepared){const deliveries=[];for(const packet of item.packets){const receipt=await optional(join(handoffDirectory,'receipts',packet.id+'.json'));deliveries.push({id:packet.id,target:packet.target,status:receipt?.status||'not_submitted',postId:receipt?.postId,public:false});}members.push({siteId:item.member.siteId,articleId:item.member.articleId,batchId:item.member.batchId,deliveries});}
 return {...summary(record),status:'valid',members};
}

export async function tickRecoveryCohort({handoffDirectory,id:name,adapterOptions={}}){
 requireDirectory(handoffDirectory);const record=await selectedRecord(handoffDirectory,name),members=record.cohort.members;
 const {postizAdapter}=await import('./publishing-flow-postiz.mjs');
 const adapter=postizAdapter({...adapterOptions,handoffDirectory,allowedSources:members.map(({siteId,articleId,sha256})=>({siteId,articleId,sha256})),allowedTargets:members.flatMap(member=>member.grant.targets),delivery:'draft'});
 const readback=adapter.readback;
 adapter.readback=async(packet,receipt)=>{
  const index=record.bindings.findIndex(binding=>binding.packets.some(value=>value.id===packet.id&&value.bodySha256===packet.bodySha256)),member=members[index],binding=record.bindings[index];
  if(!member||packet.source?.siteId!==member.siteId||packet.source.articleId!==member.articleId||packet.source.revision!==member.revision||packet.source.sha256!==member.sha256||packet.planId!==member.planId||packet.cloudContinuation?.jobId!==member.jobId||packet.cloudContinuation.artifactSha256!==member.artifactSha256||packet.cloudContinuation.authorizationSha256!==binding.authorizationSha256||packet.cloudContinuation.mode!=='draft'||!member.grant.targets.some(target=>isDeepStrictEqual(target,packet.target)))fail('the existing receipt packet differs from the frozen recovery scope');
  return readback(packet,receipt);
 };
 return postizTick({handoffDirectory,adapter,packetIds:record.bindings.flatMap(binding=>binding.packets.map(packet=>packet.id))});
}

async function main([command,directory,value]){
 requireDirectory(directory);
 if(command==='authorize')return authorizeRecoveryCohort({handoffDirectory:directory,cohort:JSON.parse(await readFile(value,'utf8'))});
 if(command==='handoff')return handoffRecoveryCohort({handoffDirectory:directory,id:value});
 if(command==='status')return recoveryCohortStatus({handoffDirectory:directory,id:value});
 if(command==='tick')return tickRecoveryCohort({handoffDirectory:directory,id:value});
 throw Error('Usage: publishing-recovery-cohort.mjs authorize <handoff> <exact-cohort.json> | handoff|status|tick <handoff> <cohort-id>');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await main(process.argv.slice(2))));}catch(error){console.error(error.message);process.exitCode=1;}
}
