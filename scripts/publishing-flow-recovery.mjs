// Only explicitly submitted publications enter here. Drafts, old history and
// unfinished authoring tasks are untouched by the continuation service.
import {readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic,optional,flowDirectory,validateFlowPolicy,retryableFlowError,flowStatus,absoluteSource,validateTranslation,markdownDestinations,hash} from './publishing-flow.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {withFileLock} from './editorial-lock.mjs';

// A single substituted destination has an unambiguous original. Never guess
// between several missing references, add images at arbitrary positions, or
// rewrite translated prose. Those cases need a new bounded language attempt.
export function repairTranslationDestinations(source,candidate){
 if(typeof candidate?.markdown!=='string')return null;
 let edition={...candidate},repairs=[];
 for(const kind of ['image','link']){
  const original=[...new Set(markdownDestinations(source.markdown).filter(x=>x.kind===kind).map(x=>x.url))];
  const translated=[...new Set(markdownDestinations(edition.markdown).filter(x=>x.kind===kind).map(x=>x.url))];
  const lost=original.filter(url=>!translated.includes(url)),extra=translated.filter(url=>!original.includes(url));
  if(lost.length===1&&extra.length===1){edition.markdown=edition.markdown.split(extra[0]).join(lost[0]);repairs.push({kind,from:extra[0],to:lost[0]});}
 }
 try{const qa=validateTranslation(source,edition);return {edition,qa,repairs};}catch{return null;}
}

// Requeue only the continuation of this frozen Chinese revision. In particular,
// this does not submit Chinese again, create a new flow, or discard an English
// request whose outcome may still be unknown.
export async function retryTranslation({root,site,id,readSource,edition,now=Date.now()}){
 if(!/^[a-f0-9]{40}$/.test(id||''))throw Error('Invalid flow ID');
 return withFileLock(join(flowDirectory(root),'today.lock'),async()=>{
  const job=(await flowStatus(root)).find(x=>x.plan.id===id);if(!job)throw Error('Unknown flow');
  const {plan,state}=job;if(plan.siteId!==site.id||plan.origin!==site.origin)throw Error('Flow workspace identity mismatch');
  if(state.complete)return {id,status:'complete',requeued:false};
  const live=await readSource(plan.articleId,{identityOnly:true,plan});
  if(live.version!==plan.revision||live.publishedVersion!==plan.revision||(live.sha256||sourceContentSha256(live.data))!==plan.sha256)throw Error('Source changed; cannot retry this frozen translation');
  const dir=join(flowDirectory(root),'jobs',id),source=absoluteSource(plan.source,plan.origin),checkpoint=await optional(join(dir,'translation-result.json'));
  if(checkpoint&&(checkpoint.planId!==id||checkpoint.sourceSha256!==plan.sha256))throw Error('Translation checkpoint source mismatch');
  const publication=await optional(join(dir,'website-en.json'));
  const submitted=publication?.request||state.english?.status==='verified';
  if(edition&&submitted&&(!state.edition||hash(state.edition)!==hash(edition)))throw Error('English publication already has a durable request; resume its original edition');
  let recovered;
  if(edition){const qa=validateTranslation(source,edition);recovered={edition,qa,repairs:[]};}
  else if(state.edition){recovered={edition:state.edition,qa:validateTranslation(source,state.edition),repairs:[]};}
  else if(!submitted){
   const candidate=checkpoint?.edition||state.translation?.candidatePath&&await optional(state.translation.candidatePath);
   if(candidate)recovered=repairTranslationDestinations(source,candidate);
  }
  if(submitted&&!recovered)throw Error('English publication already has a durable request; retain it for reconciliation');
  const previous=state.translation||{};
  if(recovered){
   state.edition=recovered.edition;
   state.translation={...previous,status:'ready',qa:recovered.qa,recovered:true,...(edition?{reviewed:true,reviewedSourceSha256:plan.sha256,reviewedEditionSha256:hash(edition)}:{}),repairedDestinations:recovered.repairs,retriedAt:now};
   delete state.translation.error;
  }else{
   if(plan.policy.translate===false)throw Error('Translation is disabled for this flow');
   // Archive the old provider response before clearing its active pointer.
   // Leaving it active would fail the same QA again before a model can retry.
   if(checkpoint){await atomic(join(dir,'translation-rejected',randomUUID()+'.json'),checkpoint);await rm(join(dir,'translation-result.json'));}
   state.translation={status:'queued',attempts:0,retriedAt:now,previousAttempts:previous.attempts||0,previousError:previous.error||state.error,rejectedCandidatePath:previous.candidatePath};
  }
  state.status='waiting';state.failures=0;state.retryAt=now;delete state.error;state.checkedAt=now;
  await atomic(join(dir,'state.json'),state);
  return {id,status:recovered?'recovered':'queued',requeued:true,modelCalls:0,repairedDestinations:recovered?.repairs||[]};
 },{timeout:100});
}

export async function recordPublicationIntent({root,site,articleId,packet,submittedAt}){
 const policy=await optional(process.env.SCHOLAY_FLOW_POLICY_FILE||join(flowDirectory(root),'policy.json'));
 if(!policy?.enabled||!policy.autoRun||packet.intent==='draft'||packet.data.locale)return;
 validateFlowPolicy(policy,{...site,languages:['zh-CN','en']});
 if(!policy.articleIds.includes('*')&&!policy.articleIds.includes(packet.data.id))return;
 if(policy.notBefore&&Date.parse(submittedAt)<Date.parse(policy.notBefore))return;
 const file=join(flowDirectory(root),'submissions',packet.requestKey+'.json');
 if(!await optional(file))await atomic(file,{articleId,requestKey:packet.requestKey,policy,submittedAt,status:'pending'});
}
export async function pendingSubmissions(root,now=Date.now()){
 const dir=join(flowDirectory(root),'submissions'),names=await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e;});const result=[];
 for(const name of names.filter(n=>/^[a-zA-Z0-9_-]{12,128}\.json$/.test(n))){const file=join(dir,name),intent=await optional(file);if(intent?.status==='pending'&&!(intent.retryAt>now))result.push({file,intent});}
 return result;
}
export async function recoverSubmissions({root,site,tokenFile,now=Date.now(),publisher}){
 const pending=await pendingSubmissions(root,now);if(!pending.length)return [];
 const {createWebsitePublisher}=await import('./website-publication.mjs');
 const client=publisher||createWebsitePublisher({root,site,tokenFile}),results=[];
 for(const {file,intent} of pending.slice(0,3)){
  try{
   const result=await client.resumeSubmission(intent.articleId,intent);
   intent.result={publicReadback:!!result.publicReadback,job:result.job?.status,requestKey:result.requestKey};
   if(result.publicReadback&&['queued','complete','disabled','out_of_scope'].includes(result.publishingFlow?.status))intent.status='verified';
   else if(result.status==='rejected')intent.status='needs_review';
   delete intent.error;intent.failures=0;
  }catch(e){intent.error=e.message;intent.failures=(intent.failures||0)+1;if(!retryableFlowError(e)||intent.failures>=8)intent.status='needs_review';}
  intent.retryAt=now+Math.min(300000,30000*2**Math.min(intent.failures||0,4));intent.checkedAt=now;
  await atomic(file,intent);results.push({articleId:intent.articleId,status:intent.status,error:intent.error});
 }
 return results;
}
