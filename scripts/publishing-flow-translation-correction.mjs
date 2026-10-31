// Explicit reviewed correction of a successful English publication before its
// cloud continuation has completed. Remote operations here are GET-only.
import {readFile,open} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {flowDirectory,optional,hash,absoluteSource,validateTranslation} from './publishing-flow.mjs';
import {flowCredential} from './publishing-flow-credentials.mjs';
import {flowWebsite} from './publishing-flow-website.mjs';
import {validateSite} from './site-config.mjs';
import {CLOUD_CONTINUATION_SITES,validateCloudContinuationArtifact,createCloudContinuationArtifact} from './publishing-flow-artifact.mjs';
import {validateTranslationFacts} from './translation-facts.mjs';
import {sourceContentSha256,editionArticleId,editionRoute} from '../contracts/language-editions.mjs';
import {validateNews} from '../admin/news.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {durableWriteJson} from './durable-json.mjs';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const hex=(value,length=64)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value);
const key=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{12,128}$/.test(value);
const fail=message=>{throw Object.assign(Error('Reviewed English correction: '+message),{statusCode:409});};
const inputKeys=['version','root','site','planId','expectedOriginalEnglishRequestKey','expectedOriginalEnglishJobId','expectedEnglishRevision','expectedOldEditionSha','expectedNewEditionSha','newReviewedEdition','reviewed','reason'];
const editionKeys=['title','summary','markdown'];
function identity(input,site){return {planId:input.planId,siteId:site.id,origin:site.origin,originalRequestKey:input.expectedOriginalEnglishRequestKey,originalJobId:input.expectedOriginalEnglishJobId,englishRevision:input.expectedEnglishRevision,oldEditionSha256:input.expectedOldEditionSha,newEditionSha256:input.expectedNewEditionSha,reviewed:true,reason:input.reason,...(input.expectedCompleted===true?{expectedCompleted:true,artifactSha256:input.expectedArtifactSha256}:{})};}
function assertPointer(pointer,selected){
 if(!exact(pointer,['version','phase','intentSha256','intent'])||pointer.version!==1||!['prepared','committed'].includes(pointer.phase)||pointer.intentSha256!==hash(pointer.intent)||!isDeepStrictEqual(pointer.intent.identity,selected))fail('resume the exact retained correction; never replace its frozen identity');
 return pointer.intent;
}

export async function prepareReviewedTranslationCorrection(input,{fetcher=fetch,writeJson=durableWriteJson,now=Date.now()}={}){
 const completed=input?.expectedCompleted===true;
 if(!exact(input,completed?[...inputKeys,'expectedCompleted','expectedArtifactSha256','originalArtifact']:inputKeys)||input.version!==1||!isAbsolute(input.root||'')||!hex(input.planId,40)||!key(input.expectedOriginalEnglishRequestKey)||!key(input.expectedOriginalEnglishJobId)||!Number.isSafeInteger(input.expectedEnglishRevision)||input.expectedEnglishRevision<1||!hex(input.expectedOldEditionSha)||!hex(input.expectedNewEditionSha)||input.expectedOldEditionSha===input.expectedNewEditionSha||!exact(input.newReviewedEdition,editionKeys)||hash(input.newReviewedEdition)!==input.expectedNewEditionSha||input.reviewed!==true||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>4000||completed&&(!hex(input.expectedArtifactSha256)||input.originalArtifact?.artifactSha256!==input.expectedArtifactSha256))fail('use an exact reviewed edition, both edition hashes and the successful original English request');
 const site=validateSite(input.site),bound=await optional(join(input.root,'.site.json'));
 if(!CLOUD_CONTINUATION_SITES.includes(site.id)||bound?.id!==site.id||bound.origin!==site.origin)fail('workspace site identity differs');
 const directory=join(flowDirectory(input.root),'jobs',input.planId),paths={plan:join(directory,'plan.json'),state:join(directory,'state.json'),translationResult:join(directory,'translation-result.json'),website:join(directory,'website-en.json'),pointer:join(directory,'translation-correction.json'),archive:join(directory,'translation-corrections',input.expectedOriginalEnglishRequestKey+'.json')};
 return withFileLock(join(flowDirectory(input.root),'today.lock'),async()=>{
  const plan=await optional(paths.plan),selected=identity(input,site),pointer=await optional(paths.pointer),resume=pointer?assertPointer(pointer,selected):null;
  if(plan?.version!==1||plan.id!==input.planId||plan.siteId!==site.id||plan.origin!==site.origin||plan.id!==hash([plan.siteId,plan.articleId,plan.revision,plan.sha256]).slice(0,40)||sourceContentSha256(plan.source||{})!==plan.sha256||!hex(plan.publicationCredential)||!Array.isArray(plan.policy?.targets)||plan.policy.targets.length||plan.policy.translate===false)fail('retain an original credential-bound cloud source without external targets');
  const current={state:await optional(paths.state),translationResult:await optional(paths.translationResult),website:await optional(paths.website)};
  if(resume&&resume.planSha256!==hash(plan))fail('the immutable source plan changed');
  if(completed&&resume&&!isDeepStrictEqual(input.originalArtifact,resume.proof.originalArtifact))fail('the retained original artifact changed');
  if(resume&&pointer.phase==='committed'){
   if(!isDeepStrictEqual(await optional(paths.archive),resume)||hash(current.state?.edition)!==selected.newEditionSha256||hash(current.translationResult?.edition)!==selected.newEditionSha256||!isDeepStrictEqual(current.website?.request,resume.replacement.website.request))fail('a later edition, request or correction archive changed; do not rewind it');
   return {status:'prepared',alreadyPrepared:true,planId:plan.id,requestKey:current.website.request.requestKey,expectedVersion:input.expectedEnglishRevision,editionSha256:selected.newEditionSha256};
  }
  const old=resume?.original||current;
  if(!old.state||(completed?old.state.complete!==true:old.state.complete)||old.state.translation?.status!=='ready'||hash(old.state.edition)!==selected.oldEditionSha256||(completed?Object.keys(old.state.dispatch||{}).length:Object.values(old.state.dispatch||{}).some(value=>value?.status==='ready'))||old.translationResult?.planId!==plan.id||old.translationResult.sourceSha256!==plan.sha256||hash(old.translationResult.edition)!==selected.oldEditionSha256||old.website?.request?.requestKey!==selected.originalRequestKey)fail('retain the selected completion state, exact ready translation and original English request without dispatch');
  const artifact=completed?validateCloudContinuationArtifact(input.originalArtifact,{siteId:site.id,origin:site.origin,articleId:plan.articleId,flowId:plan.id,revision:plan.revision,sourceSha256:plan.sha256}):null;
  const originalRequest=old.website.request,translationOf={articleId:plan.articleId,revision:plan.revision,sha256:plan.sha256},englishId=editionArticleId(plan.articleId,'en'),editionSite={...site,languages:['zh-CN','en']};
  const oldData=validateNews({...plan.source,...old.state.edition,id:englishId,assets:[],locale:'en',translationOf},null,editionSite);
  if(!isDeepStrictEqual(originalRequest.data,oldData)||old.website.result?.job?.id&&old.website.result.job.id!==selected.originalJobId)fail('the old request body or build differs from the retained edition');
  const source=absoluteSource(plan.source,plan.origin),qa=validateTranslation(source,input.newReviewedEdition),facts={};
  for(const field of editionKeys)facts[field]=validateTranslationFacts(source[field]||'',input.newReviewedEdition[field]);
  const newData=validateNews({...oldData,...input.newReviewedEdition},null,editionSite);
  // The plan selects a fixed private path and verifies its submitter hash.
  // Ambient tokens and operator-supplied token paths are never accepted.
  const token=await flowCredential(input.root,plan,{required:true});
  const api=async path=>{
   const response=await fetcher(site.origin+'/manage/api/news'+path,{method:'GET',headers:{Authorization:'Bearer '+token,'X-Scholay-Site':site.id,'X-Scholay-Protocol':'1'},redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Object.assign(Error('Original English correction GET failed (HTTP '+response.status+')'),{statusCode:response.status});return response.json();
  };
  const checkSource=async()=>{
   const live=await api('/flow-source/'+plan.articleId+'?identity=1');
   if(live.version!==plan.revision||live.publishedVersion!==plan.revision||live.sha256!==plan.sha256)fail('Chinese source changed; retain this frozen revision');
  };
  const checkEnglish=async()=>{
   const remote=await api('/'+englishId);
   if(remote.version!==selected.englishRevision||remote.publishedVersion!==selected.englishRevision||remote.url!==editionRoute(oldData)||!isDeepStrictEqual(remote.data,oldData)||!isDeepStrictEqual(remote.published,oldData))fail('current or published English content changed');
  };
  const oldResult=await api('/requests/'+selected.originalRequestKey);
  if(oldResult.articleId!==englishId||oldResult.requestKey!==undefined&&oldResult.requestKey!==selected.originalRequestKey||oldResult.revision!==selected.englishRevision||oldResult.url!==editionRoute(oldData)||oldResult.job?.id!==selected.originalJobId||oldResult.job.status!=='success')fail('the original English outcome is not the exact successful publication');
  await checkSource();await checkEnglish();
  const publicReadback=await flowWebsite({root:input.root,site:editionSite,fetcher,requireBoundCredential:true}).verify(oldData,selected.englishRevision,{plan});
  // Recheck after public verification. A later concurrent write is still
  // rejected by normal Chinese-source and English optimistic-version gates.
  await checkEnglish();await checkSource();
  if(completed){
   const chinese=await api('/requests/'+artifact.requestKey);
   if(chinese.articleId!==plan.articleId||chinese.requestKey!==undefined&&chinese.requestKey!==artifact.requestKey||chinese.revision!==plan.revision||site.origin+chinese.url!==plan.sourceUrl||!chinese.job?.id||chinese.job.status!=='success')fail('the original Chinese request is not the same successful publication');
   const rebuilt=createCloudContinuationArtifact({queueState:{continuationOwner:'cloud',credentialId:plan.publicationCredential,siteId:site.id,status:'complete',jobId:artifact.jobId,requestKey:artifact.requestKey,articleId:plan.articleId,continuation:{id:plan.id},receipt:{...chinese,requestKey:artifact.requestKey,publicReadback:true}},packet:{requestKey:artifact.requestKey,data:plan.source},plan,state:old.state,publication:old.website,site});
   if(!isDeepStrictEqual(rebuilt,input.originalArtifact))fail('the retained complete artifact differs from the original flow and publication');
  }
  const at=resume?.preparedAt??now,requestKey=resume?.replacement.website.request.requestKey||randomUUID();
  const correction={originalRequestKey:selected.originalRequestKey,requestKey,oldEditionSha256:selected.oldEditionSha256,newEditionSha256:selected.newEditionSha256,reviewedAt:at,reason:input.reason};
  const nextState={...old.state,edition:structuredClone(input.newReviewedEdition),translation:{status:'ready',reviewed:true,reviewedSourceSha256:plan.sha256,reviewedEditionSha256:selected.newEditionSha256,qa,facts,correction},english:{status:'queued',requestKey},complete:false,status:'waiting',failures:0,retryAt:at,checkedAt:at};delete nextState.error;
  const replacement={website:{status:'unknown',request:{requestKey,data:newData,expectedVersion:selected.englishRevision,expectedPublishedVersion:selected.englishRevision},intendedAt:new Date(at).toISOString(),sends:0,lastSendAt:0},translationResult:{planId:plan.id,sourceSha256:plan.sha256,edition:structuredClone(input.newReviewedEdition),reviewed:true,qa,facts,correction},state:nextState};
  const intent={version:1,identity:selected,planSha256:hash(plan),preparedAt:at,original:old,replacement,proof:{originalEnglish:{articleId:oldResult.articleId,revision:oldResult.revision,url:oldResult.url,job:{id:oldResult.job.id,status:oldResult.job.status}},publicReadback,...(completed?{originalArtifact:structuredClone(input.originalArtifact)}:{})}};
  if(resume&&!isDeepStrictEqual(resume,intent))fail('the retained correction or verification evidence changed');
  for(const name of ['state','translationResult','website']){
   if(resume&&!isDeepStrictEqual(current[name],old[name])&&!isDeepStrictEqual(current[name],replacement[name]))fail('local files changed outside the pending correction');
   if(!isDeepStrictEqual(await optional(paths[name]),current[name]))fail('local files changed during read-only verification');
  }
  if(hash(await optional(paths.plan))!==hash(plan))fail('the source plan changed during verification');
  const archive=await optional(paths.archive);if(archive&&!isDeepStrictEqual(archive,intent))fail('the immutable old edition archive already differs');
  const nextPointer={version:1,phase:'prepared',intentSha256:hash(intent),intent};
  if(!resume)await writeJson(paths.pointer,nextPointer);
  if(!archive)await writeJson(paths.archive,intent);
  if(completed&&process.platform!=='win32'){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
  // The prepared pointer blocks todayTick until all three matching files are
  // durable. It also retains the full old/new snapshots if power is lost.
  for(const name of ['website','translationResult','state'])if(!isDeepStrictEqual(current[name],replacement[name]))await writeJson(paths[name],replacement[name]);
  await writeJson(paths.pointer,{...nextPointer,phase:'committed'});
  return {status:'prepared',planId:plan.id,requestKey,expectedVersion:selected.englishRevision,editionSha256:selected.newEditionSha256};
 },{timeout:100});
}

export async function prepareReviewedTranslationCorrectionFromFile(file,options){return prepareReviewedTranslationCorrection(JSON.parse(await readFile(file,'utf8')),options);}
