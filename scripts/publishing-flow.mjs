// Durable, opt-in continuation of a verified Chinese publication. No timers,
// model calls or remote writes run in the original publication transaction.
import {readFile,writeFile,mkdir,rename,readdir,rm} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {markdownLinks,markdownImages} from './article-format.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {articleLocale,sourceContentSha256,editionArticleId,editionRoute} from '../contracts/language-editions.mjs';
import {withRecordSourceLinks} from './editorial-record.mjs';
import {freezeFlowCredential,flushCloudFlow} from './publishing-flow-credentials.mjs';

export const flowDirectory=root=>join(root,'.local/publishing-flow');
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const optional=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export async function atomic(file,value){await mkdir(join(file,'..'),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await rename(tmp,file);}finally{await rm(tmp,{force:true});}}
async function immutable(file,value){await mkdir(join(file,'..'),{recursive:true,mode:0o700});try{await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;if(hash(await optional(file))!==hash(value))throw Error('Immutable publishing package differs');}}
const idOK=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{3,128}$/.test(id);
export function validateFlowPolicy(policy,site){
 if(!policy||policy.version!==1||policy.siteId!==site.id||policy.origin!==site.origin||policy.enabled!==true||!policy.authorization?.trim())throw Error('Publishing flow requires a site-bound authorization');
 if(!Array.isArray(policy.articleIds)||!policy.articleIds.length||policy.articleIds.some(id=>id!=='*'&&!idOK(id)))throw Error('Bind the authorized source articles');
 if(policy.notBefore!==undefined&&!Number.isFinite(Date.parse(policy.notBefore))||policy.articleIds.includes('*')&&!Number.isFinite(Date.parse(policy.notBefore)))throw Error('A future-publication cutoff is required for site-wide continuation');
 if(!Array.isArray(policy.targets))throw Error('Declare external targets; an empty list runs only the owned sites and community');
 const keys=new Set();
 for(const target of policy.targets){
  if(!idOK(target.integrationId)||!['discord','devto'].includes(target.platform)||target.locale!==(target.platform==='discord'?'zh-CN':'en')||target.format!==(target.platform==='discord'?'summary':'article')||target.platform==='discord'&&!/^\d{16,22}$/.test(target.channelId||''))throw Error('Unsupported or incomplete publishing target');
  const key=JSON.stringify([target.platform,target.integrationId,target.channelId||'']);if(keys.has(key))throw Error('Duplicate target');keys.add(key);
 }
 if(policy.translate!==false&&!site.languages?.includes('en'))throw Error('Enable English editions on this site first');
 return policy;
}
const sourceOperation=({siteId,articleId,revision,sha256})=>hash([siteId,articleId,revision,sha256]).slice(0,40);
export async function configureFlow(root,site,policy){
 validateFlowPolicy(policy,site);
 // Index pre-existing pilot plans once when configuring. A policy change must
 // not translate or dispatch an already frozen source revision again.
 for(const {plan} of await flowStatus(root))await immutable(join(flowDirectory(root),'sources',sourceOperation(plan)+'.json'),{id:plan.id});
 await atomic(join(flowDirectory(root),'policy.json'),policy);return {enabled:true,siteId:site.id,targets:policy.targets.length};
}
function validStructuredRoute(data,path){
 const prefix={year:'/calendar/',history:'/history/',openSource:'/open-source/'}[data.record?.kind];
 if(!prefix||data.id!=='record-'+data.record.documentId||typeof path!=='string'||!path.startsWith(prefix)||!path.endsWith('/'))return false;
 try{const url=new URL(path,'https://publication.invalid');return url.origin==='https://publication.invalid'&&url.pathname===path&&!url.search&&!url.hash&&!/%(?:2f|5c)/i.test(path)&&!path.includes('\\');}catch{return false;}
}
const sourceSnapshot=data=>({...withRecordSourceLinks(data),assets:(data.assets||[]).map(({path})=>({path}))});
export async function enqueuePublished({root,site,data,receipt,policyFile=process.env.SCHOLAY_FLOW_POLICY_FILE,policy:boundPolicy,credential,flushCloud=flushCloudFlow}){
 if(articleLocale(data)!=='zh-CN')return {status:'disabled'};
 const source=sourceSnapshot(data),sha256=sourceContentSha256(source),key=sourceOperation({siteId:site.id,articleId:data.id,revision:receipt.revision,sha256}),pointer=join(flowDirectory(root),'sources',key+'.json'),prior=await optional(pointer),id=prior?.id||key;
 const verified=receipt.publicReadback&&receipt.job?.status==='success'&&Number.isSafeInteger(receipt.revision)&&(data.record?validStructuredRoute(data,receipt.url):receipt.url===editionRoute(data));
 const existing=await optional(join(flowDirectory(root),'jobs',id,'plan.json'));
 // A lost handoff ACK resumes the already authorized immutable plan, even if
 // the policy for future work has since been disabled, replaced or narrowed.
 if(existing){
  if(!verified)throw Error('A verified source publication is required');if(sourceOperation(existing)!==key)throw Error('Frozen source identity differs');if(existing.publicationCredential!==credential?.credentialId)throw Object.assign(Error('Frozen continuation credential differs'),{statusCode:409});
  // A crash can leave the plan written but its source pointer absent. Recreate
  // only that same pointer, then flush the whole cloud handoff before ACKing.
  if(credential){await immutable(pointer,{id});await flushCloud(root,id,key);}
  const state=await optional(join(flowDirectory(root),'jobs',id,'state.json'));return {status:state?.complete?'complete':'queued',id};
 }
 if(prior)throw Error('Frozen source plan is missing; retain its identity for review');
 const policy=boundPolicy||await optional(policyFile||join(flowDirectory(root),'policy.json'));
 if(!policy?.enabled)return {status:'disabled'};
 validateFlowPolicy(policy,site);
 if(!policy.articleIds.includes('*')&&!policy.articleIds.includes(data.id))return {status:'out_of_scope'};
 if(policy.notBefore&&!receipt.explicitContinuation&&(!receipt.submittedAt||Date.parse(receipt.submittedAt)<Date.parse(policy.notBefore)||!Number.isFinite(Date.parse(receipt.submittedAt))))return {status:'out_of_scope'};
 if(!verified)throw Error('A verified source publication is required');
 const plan={version:1,id,siteId:site.id,origin:site.origin,articleId:data.id,revision:receipt.revision,sha256,source,sourceUrl:site.origin+receipt.url,brand:{name:site.name,slogan:site.slogan||''},policy:structuredClone(policy),...(credential?{publicationCredential:credential.credentialId}:{})};
 if(credential)await freezeFlowCredential(root,id,credential);
 const dir=join(flowDirectory(root),'jobs',id);await immutable(join(dir,'plan.json'),plan);await immutable(pointer,{id});
 if(credential)await flushCloud(root,id,key);
 return {status:'queued',id};
}
export function markdownDestinations(markdown){
 return [...markdownImages(markdown).map(url=>({kind:'image',url})),...markdownLinks(markdown).map(url=>({kind:'link',url}))];
}
export function absoluteSource(source,origin){
 let markdown=source.markdown;
 for(const {url} of markdownDestinations(markdown)){if(url?.startsWith('/')&&!url.startsWith('//'))markdown=markdown.split(url).join(new URL(url,origin).href);}
 return {...source,markdown};
}
function protectedBlocks(markdown){return [...markdown.matchAll(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~|\$\$[\s\S]*?\$\$|(?<!\$)\$[^\n$]+\$(?!\$)/g)].map(m=>m[0]);}
function numbers(markdown){return (markdown.replace(/https?:\/\/\S+/g,'').replace(/^#{1,6} .*$/gm,'').replace(/^\s*\d+[.)]\s/gm,'').match(/\d+(?:[.,]\d+)*/g)||[]).sort();}
export function validateTranslation(source,english){
 for(const key of ['title','summary','markdown'])if(typeof english?.[key]!=='string'||!english[key].trim()||english[key].length>({title:500,summary:4000,markdown:160000}[key]))throw Error('Incomplete English edition: '+key);
 if(english.markdown.length<source.markdown.length*.35)throw Error('English edition appears truncated');
 // Markdown normalizes destinations (for example literal {entityType} becomes
 // %7BentityType%7D). Compare parsed URLs on both sides, never a parsed source
 // against raw English bytes; encoded reserved delimiters remain significant.
 const englishDestinations=markdownDestinations(english.markdown);
 for(const {url} of markdownDestinations(source.markdown))if(!englishDestinations.some(destination=>destination.url===url))throw Error('Translation lost a source or image URL: '+url);
 // AI translation is not a byte-for-byte copy. The owner explicitly chose
 // lightweight QA: formatting and number differences are quiet diagnostics,
 // while completeness and every source/image URL remain delivery gates.
 const warnings=[];
 if(protectedBlocks(source.markdown).some(block=>!english.markdown.includes(block)))warnings.push('Code or formula formatting differs');
 if(JSON.stringify(numbers(source.markdown))!==JSON.stringify(numbers(english.markdown)))warnings.push('Numeric or date formatting differs');
 if(englishDestinations.some(x=>x.url?.startsWith('/')))throw Error('English links must be absolute');
 return {status:'passed',checks:['complete','source-urls','images'],warnings,sha256:hash(english)};
}
const slotKey=(plan,target)=>hash([plan.siteId,plan.articleId,target.locale,target.platform,target.integrationId,target.channelId||'',target.format]).slice(0,40);
function forumUrl(value){try{const u=new URL(value);return u.origin==='https://enterscholar.com'&&/^\/t\/(?:[^/]+\/)?\d+\/?$/.test(u.pathname)&&!u.search&&!u.hash?u.href:null;}catch{return null;}}
async function communityMap(root,origin,fetcher,now){
 const file=join(flowDirectory(root),'community-cache.json'),old=await optional(file);
 if(old?.origin===origin&&now-old.checkedAt<300000)return old.links;
 const response=await fetcher(origin+'/community/links.json',{headers:old?.etag?{'If-None-Match':old.etag}:{},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(response.status===304&&old?.origin===origin){await atomic(file,{...old,checkedAt:now});return old.links;}
 if(!response.ok)throw Error('Community map unavailable: '+response.status);
 const text=await response.text();if(text.length>2*1024*1024)throw Error('Community map too large');const result=JSON.parse(text);if(result.version!==1||typeof result.links!=='object')throw Error('Invalid community map');
 await atomic(file,{origin,checkedAt:now,etag:response.headers.get('etag'),links:result.links});return result.links;
}
export function externalPackage(plan,target,edition,community){
 const ownUrl=target.locale==='en'?plan.origin+'/en/news/'+plan.articleId+'/':plan.sourceUrl;
 const content=target.locale==='en'?edition:plan.source;
 const brand=target.locale==='en'?{name:plan.policy.englishBrand?.name||plan.brand.name,slogan:plan.policy.englishBrand?.slogan||plan.brand.slogan}:plan.brand;
 const footer=target.locale==='en'?`\n\n---\n\nOriginally published: [${content.title}](${ownUrl})\n\n[Discuss on EntScholar (Chinese)](${community})\n\n${brand.name} — ${brand.slogan}\n`:`\n\n全文：${ownUrl}\n恩特讨论：${community}\n\n${brand.name}｜${brand.slogan}`;
 const body=target.format==='summary'?content.title+'\n\n'+Array.from(content.summary).slice(0,600).join('')+footer:content.markdown+footer;
 if(target.platform==='discord'&&body.length>1900)throw Error('Discord summary exceeds delivery limit');
 const slot=slotKey(plan,target),id=hash([slot,plan.id,hash(body)]).slice(0,40);
 const ownContentSha256=target.locale==='en'?sourceContentSha256({...plan.source,...edition,id:editionArticleId(plan.articleId,'en'),title:edition.title.trim(),summary:edition.summary.trim(),markdown:edition.markdown.trim(),record:undefined,assets:[]}):plan.sha256;
 return {version:1,id,slot,planId:plan.id,source:{siteId:plan.siteId,articleId:plan.articleId,revision:plan.revision,sha256:plan.sha256},authorization:plan.policy.authorization,target,ownUrl,ownContentSha256,communityUrl:community,title:content.title,body,bodySha256:hash(body),settings:target.platform==='discord'?{__type:'discord',channel:target.channelId}:{__type:'devto',title:content.title,canonical:ownUrl,tags:[]}};
}
export function validateFlowPlanIds(planIds){
 if(planIds===undefined)return undefined;
 const ids=Array.isArray(planIds)?[...planIds]:null;
 if(!ids||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{40}$/.test(id))||new Set(ids).size!==ids.length)throw Error('Publishing flow planIds must be an array of unique exact 40-character lowercase hex identities');
 return ids;
}
export function validateFlowReviewPlanIds(reviewBeforeEnglishPlanIds,planIds){
 if(reviewBeforeEnglishPlanIds===undefined)return undefined;
 const ids=validateFlowPlanIds(reviewBeforeEnglishPlanIds),scope=validateFlowPlanIds(planIds);
 if(!scope||ids.some(id=>!scope.includes(id)))throw Error('English review plan IDs must be a subset of explicit publishing flow planIds');
 return ids;
}
function assertReviewPlan(plan){
 if(!plan||!/^[a-f0-9]{64}$/.test(plan.publicationCredential||'')||!Array.isArray(plan.policy?.targets)||plan.policy.targets.length)throw Error('English review gate requires an original-credential cloud continuation with no external targets');
}
export async function flowStatus(root,{pendingOnly=false,limit=Infinity,now=Date.now(),planIds}={}){
 const ids=validateFlowPlanIds(planIds),selected=ids===undefined?null:new Set(ids);if(selected?.size===0)return [];
 const dir=join(flowDirectory(root),'jobs'),names=await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
 const states=[];for(const id of names.filter(x=>/^[a-f0-9]{40}$/.test(x)&&(!selected||selected.has(x))).sort()){
  const state=await optional(join(dir,id,'state.json'))||{};
  if(pendingOnly&&(state.complete||['stale','needs_review','translation_review'].includes(state.status)||state.retryAt>now||state.translation?.status==='failed'&&state.community?.status==='verified'))continue;
  states.push({id,state});
 }
 if(pendingOnly)states.sort((a,b)=>(a.state.checkedAt||0)-(b.state.checkedAt||0)||a.id.localeCompare(b.id));
 // A cloud handoff flushes its private credential before publishing the plan.
 // The supervisor may observe that directory while the handoff is in flight.
 const result=[];for(const {id,state} of states){if(result.length>=limit)break;const plan=await optional(join(dir,id,'plan.json'));if(plan)result.push({plan,state});}return result;
}
export async function todayTick({root,site,readSource,translate,publishEdition,fetcher=fetch,now=Date.now(),planIds,reviewBeforeEnglishPlanIds}){
 planIds=validateFlowPlanIds(planIds);const reviewIds=new Set(validateFlowReviewPlanIds(reviewBeforeEnglishPlanIds,planIds)||[]);if(planIds?.length===0)return {modelCalls:0,jobs:[]};
 return withFileLock(join(flowDirectory(root),'today.lock'),async()=>{
  // Validate the complete requested gate scope before processing any job,
  // including an already-held plan that is absent from the pending shortlist.
  for(const id of reviewIds)assertReviewPlan(await optional(join(flowDirectory(root),'jobs',id,'plan.json')));
  let modelCalls=0;const results=[];
  const jobs=await flowStatus(root,{pendingOnly:true,limit:3,now,planIds});
  // A source/community check is not a model opportunity. Within the existing
  // shortlist, rotate that one opportunity by its last actual start time.
  const modelAge=({state})=>Number.isFinite(state.translation?.startedAt)?state.translation.startedAt:0;
  const modelPlanId=jobs.filter(({plan,state})=>plan.policy.translate!==false&&!state.edition&&state.translation?.status!=='failed').sort((a,b)=>modelAge(a)-modelAge(b))[0]?.plan.id;
  for(const {plan,state} of jobs){
   if(plan.siteId!==site.id||plan.origin!==site.origin)throw Error('Flow workspace identity mismatch');
   if(reviewIds.has(plan.id)||state.translationReviewRequired)assertReviewPlan(plan);
   const file=join(flowDirectory(root),'jobs',plan.id,'state.json');
   const correction=await optional(join(flowDirectory(root),'jobs',plan.id,'translation-correction.json'));
   if(correction&&(correction.version!==1||correction.phase!=='committed'||!correction.intent||correction.intent.identity?.planId!==plan.id||correction.intent.planSha256!==hash(plan)||correction.intentSha256!==hash(correction.intent))){
    results.push({id:plan.id,status:'correction_pending',complete:false});continue;
   }
   if(state.complete||state.status==='stale')continue;
   // Once selected for review, removing a scheduling flag cannot silently
   // authorize this edition. Explicit acceptance binds the actual source/body.
   if(reviewIds.has(plan.id))state.translationReviewRequired=true;
   try{
    const live=await readSource(plan.articleId,{identityOnly:true,plan});
    if(live.version!==plan.revision||live.publishedVersion!==plan.revision||(live.sha256||sourceContentSha256(live.data))!==plan.sha256){state.status='stale';throw Error('Source changed; retain this version without dispatching');}
    state.chinese={status:'verified',url:plan.sourceUrl,revision:plan.revision};
    // Chinese handoff does not wait for the model, English publication or QA.
    let links;try{links=await communityMap(root,plan.origin,fetcher,now);state.community=forumUrl(links[new URL(plan.sourceUrl).pathname])?{status:'verified',url:links[new URL(plan.sourceUrl).pathname]}:{status:'waiting'};}catch(e){state.community={status:'waiting',error:e.message};}
    const handoff=plan.policy.handoffDirectory;if(plan.policy.targets.length&&(!handoff||!isAbsolute(handoff)))throw Error('An absolute shared handoff directory is required');
    state.dispatch||={};
    async function handoffReady(locale){
     for(const target of plan.policy.targets.filter(t=>t.locale===locale)){
      const slot=slotKey(plan,target);if(state.dispatch[slot]?.status==='ready')continue;
      if(state.community.status!=='verified'||locale==='en'&&state.english?.status!=='verified')continue;
      const packet=externalPackage(plan,target,state.edition,state.community.url),prior=await optional(join(handoff,'slots',slot+'.json'));
      if(prior&&prior.id!==packet.id){state.dispatch[slot]={status:'needs_decision',reason:'This article/account already has another delivery revision'};continue;}
      await immutable(join(handoff,'outbox',packet.id+'.json'),packet);state.dispatch[slot]={status:'ready',id:packet.id};
     }
    }
    await handoffReady('zh-CN');await atomic(file,state);
    // A completed provider response is persisted before the caller accepts it.
    // Recover that exact candidate after a process exit, without paying for AI again.
    const checkpoint=await optional(join(flowDirectory(root),'jobs',plan.id,'translation-result.json'));
    if(checkpoint&&(checkpoint.planId!==plan.id||checkpoint.sourceSha256!==plan.sha256))throw Error('Translation checkpoint source mismatch');
    if(!state.edition&&state.translation?.status!=='failed'&&(checkpoint||state.translation?.candidatePath)){
     const candidate=checkpoint?.edition||await optional(state.translation.candidatePath);
     if(candidate){try{const qa=validateTranslation(absoluteSource(plan.source,plan.origin),candidate);state.edition=candidate;state.translation={...state.translation,status:'ready',qa,recovered:true};}catch(e){state.translation={...state.translation,status:'failed',error:e.message};throw e;}}
    }
    if(state.translation?.status==='generating'&&!state.edition){
     state.translation={...state.translation,status:(state.translation.attempts||1)>=3?'failed':'retrying',error:'Language worker interrupted'};
    }
    if(plan.id===modelPlanId&&plan.policy.translate!==false&&!state.edition&&state.translation?.status!=='failed'&&modelCalls<1){
     const source=absoluteSource(plan.source,plan.origin);state.translation={...state.translation,status:'generating',startedAt:now,attempts:(state.translation?.attempts||0)+1};await atomic(file,state);modelCalls++;
     const edition=await translate(source,{plan,root});
     const candidatePath=join(root,'_ops/publishing/variants/en',plan.id,'website.candidate.'+randomUUID()+'.json');await immutable(candidatePath,edition);state.translation.candidatePath=candidatePath;await atomic(file,state);
     let qa;try{qa=validateTranslation(source,edition);}catch(e){state.translation.status='failed';throw e;}
     const path=join(root,'_ops/publishing/variants/en',plan.id,'website.en.json');await immutable(path,{...edition,source:{articleId:plan.articleId,revision:plan.revision,sha256:plan.sha256},qa});
     state.edition=edition;state.translation={...state.translation,status:'ready',qa,path};await atomic(file,state);
    }
    const approved=state.edition&&state.translation?.reviewed===true&&state.translation.reviewedSourceSha256===plan.sha256&&state.translation.reviewedEditionSha256===hash(state.edition);
    if(state.edition&&state.translationReviewRequired&&!approved){
     state.status='translation_review';state.complete=false;delete state.error;delete state.retryAt;state.failures=0;
    }else{
     if(state.edition&&state.english?.status!=='verified'){
      // Adapter persists its original request before sending and resumes by GET.
      state.english=await publishEdition(plan,state.edition);await atomic(file,state);
     }
     await handoffReady('en');state.status='waiting';
     state.complete=state.community.status==='verified'&&plan.policy.targets.every(t=>state.dispatch[slotKey(plan,t)]?.status==='ready')&&(plan.policy.translate===false||state.english?.status==='verified');delete state.error;delete state.retryAt;state.failures=0;
     if(['rejected','needs_review'].includes(state.english?.status))state.status='needs_review';
    }
   }catch(e){
    state.error=e.message;state.failures=(state.failures||0)+1;state.retryAt=now+Math.min(300000,30000*2**Math.min(state.failures-1,4));
    if(state.translation?.status==='generating'){
     const busy=e.code==='FLOW_LANGUAGE_BUSY',retry=retryableFlowError(e)&&state.translation.attempts<3;
     state.translation={...state.translation,status:busy?'queued':retry?'retrying':'failed',attempts:state.translation.attempts-(busy?1:0),error:e.message};
    }else if(state.status!=='stale'&&(!retryableFlowError(e)||state.failures>=8))state.status='needs_review';
   }
   state.checkedAt=now;await atomic(file,state);results.push({id:plan.id,status:state.status,translation:state.translation?.status,english:state.english?.status,community:state.community?.status,complete:state.complete,error:state.error});
  }
  return {modelCalls,jobs:results};
 },{timeout:100});
}
export function retryableFlowError(error){return error.code==='FLOW_LANGUAGE_URLS'||[408,425,429].includes(error.statusCode)||error.statusCode>=500||/timeout|timed out|disconnected|network|fetch failed|provider unavailable|temporar|ECONN|ETIMED|EPIPE|ENOTFOUND|EAI_AGAIN/i.test(error.message||'');}
export async function postizTick({handoffDirectory,adapter,packetIds}){
 if(packetIds!==undefined&&(!Array.isArray(packetIds)||packetIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{40}$/.test(id))||new Set(packetIds).size!==packetIds.length))throw Error('Postiz packetIds must be unique exact packet identities');
 const selected=packetIds===undefined?null:new Set(packetIds);
 return withFileLock(join(handoffDirectory,'postiz.lock'),async()=>{
  const names=await readdir(join(handoffDirectory,'outbox')).catch(e=>{if(e.code==='ENOENT')return [];throw e;}),results=[];
  for(const name of names.filter(x=>/^[a-f0-9]{40}\.json$/.test(x)&&(!selected||selected.has(x.slice(0,-5)))).sort()){
   const packet=await optional(join(handoffDirectory,'outbox',name));if(packet.id+'.json'!==name||hash(packet.body)!==packet.bodySha256||!packet.authorization)throw Error('Invalid handoff package');
   const file=join(handoffDirectory,'receipts',name),slot=join(handoffDirectory,'slots',packet.slot+'.json');let receipt=await optional(file);
   if(receipt&&(receipt.id!==packet.id||receipt.bodySha256&&receipt.bodySha256!==packet.bodySha256)){results.push({id:packet.id,status:'needs_decision',error:'Postiz receipt identity or body differs from its frozen handoff'});continue;}
   if(['verified','draft_saved'].includes(receipt?.status)){results.push(receipt);continue;}
   const prior=await optional(slot);if(prior&&prior.id!==packet.id){results.push({id:packet.id,status:'needs_decision'});continue;}
   if(!receipt){
    // Read-only availability checks can be retried. They must not create an
    // uncertain write intent before a provider submission has been attempted.
    let delivery;
    try{
     delivery=structuredClone(adapter.deliveryFor?.(packet)||adapter.delivery||{mode:'draft'});
     if(!['draft','publish'].includes(delivery.mode)||delivery.mode==='publish'&&(typeof delivery.authorization!=='string'||!delivery.authorization.trim()))throw Error('Postiz delivery requires a valid mode and separate publication authorization');
     await adapter.preflight?.(packet);
    }catch(e){results.push({id:packet.id,status:'deferred',error:e.message,...(e.retryAt?{retryAt:e.retryAt}:{})});continue;}
    // Reserve the identity before the only external write. A crash or timeout
    // leaves an unknown receipt; subsequent ticks only query the same intent.
    await immutable(slot,{id:packet.id,slot:packet.slot});receipt={id:packet.id,status:'unknown',bodySha256:packet.bodySha256,delivery,intendedAt:new Date().toISOString()};await atomic(file,receipt);
    try{receipt={...receipt,...await adapter.submit(packet,{preflighted:!!adapter.preflight,delivery}),status:'submitted'};}catch(e){receipt.error=e.message;}
    await atomic(file,receipt);
   }
   if(['unknown','submitted'].includes(receipt.status)){
    if(!receipt.delivery){receipt.delivery={mode:'publish',legacy:true};await atomic(file,receipt);}
    try{receipt={...receipt,...await adapter.readback(packet,receipt)};if(['verified','draft_saved'].includes(receipt.status)){delete receipt.error;delete receipt.readbackError;}await atomic(file,receipt);}catch(e){receipt.readbackError=e.message;await atomic(file,receipt);}
   }
   results.push(receipt);
  }
  return results;
 },{timeout:100});
}
