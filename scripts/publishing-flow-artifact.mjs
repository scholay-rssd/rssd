// Read-only continuation evidence. Remote results live outside jobs/: importing
// evidence must never create a second translation or publication consumer.
import {createHash} from 'node:crypto';
import {readFile,open} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {withFileLock} from './editorial-lock.mjs';
import {durableWriteJson} from './durable-json.mjs';
import {sourceContentSha256,editionArticleId} from '../contracts/language-editions.mjs';

export const CLOUD_CONTINUATION_SITES=Object.freeze(['scholay-today','metho','enter','study','xsiching']);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const continuationArtifactSha256=value=>hash(canonical(value));
const failure=()=>Object.assign(Error('Cloud continuation evidence does not match its frozen publication'),{statusCode:409,code:'FLOW_ARTIFACT'});
const check=condition=>{if(!condition)throw failure();};
const hex=(value,length=64)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value);
const select=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const optional=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
// Only the explicit supersession transaction may move a retained artifact.
// Every ordinary reader (including authorization/cohort readers) fails closed
// while either side of its receipt/artifact pair is being replaced.
export async function assertCloudArtifactSupersessionSettled({root,jobId}){
 if(jobId===undefined)return;
 check(isAbsolute(root)&&hex(jobId));
 const pointer=await optional(join(root,'.local/publishing-flow/remote',jobId+'.supersession.json'));
 if(pointer)check(exact(pointer,['version','phase','intentSha256','intent'])&&pointer.version===1&&pointer.phase==='committed'&&pointer.intent?.identity?.jobId===jobId&&continuationArtifactSha256(pointer.intent)===pointer.intentSha256);
}
const sourceKeys=['id','title','summary','markdown','date','category','author','sectionId','assets','record'];
const recordKeys={year:['id','title','category','tags','start','end','recurrence','dateBasis','summary','body','bodyTruncated','sourceName','sourceUrl','provenance','reviewedAt','sectionId'],history:['id','title','dateKey','year','domain','eventType','importance','factSummary','historicalSignificance','sources','preciseToDay','sectionId'],openSource:['title','date','category','summary','value','url','relatedUrl','status','sectionId']};
function publicSource(value){
 const source=select(value,sourceKeys);source.assets=(value.assets||[]).map(asset=>({path:asset.path}));
 if(value.record){
  const record=value.record;check(recordKeys[record.kind]);const fields=select(record.fields,recordKeys[record.kind]);
  if(fields.sources)fields.sources=fields.sources.map(item=>select(item,['label','url']));
  if(fields.recurrence)fields.recurrence=select(fields.recurrence,['frequency','monthDay','leapDay']);
  source.record={documentId:record.documentId,kind:record.kind,fields};
 }
 return source;
}
function validateSource(source){
 check(exact(source,sourceKeys)&&isDeepStrictEqual(source,publicSource(source)));
 for(const [key,max] of [['id',100],['title',500],['summary',4000],['markdown',160000],['date',10],['category',80],['author',100]])check(typeof source[key]==='string'&&source[key].length>0&&source[key].length<=max);
 check(/^[a-z0-9][a-z0-9-]{2,99}$/.test(source.id)&&Array.isArray(source.assets)&&source.assets.length<=12&&source.assets.every(asset=>/^\/article-media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(asset.path)));
 if(source.record)check(source.id==='record-'+source.record.documentId&&/^[a-f0-9-]{36}$/.test(source.record.documentId));
}
function originOf(value){try{const url=new URL(value);check(url.origin===value&&url.protocol==='https:'&&!url.username&&!url.password);return url.origin;}catch{throw failure();}}
function communityUrl(value){try{const url=new URL(value);return url.origin==='https://enterscholar.com'&&!url.username&&!url.password&&/^\/t\/(?:[^/]+\/)?\d+\/?$/.test(url.pathname)&&!url.search&&!url.hash;}catch{return false;}}
const stageKeys=['status','url','revision'];
const artifactKeys=['version','jobId','siteId','origin','articleId','requestKey','continuationOwner','flowId','revision','sourceSha256','sourceUrl','brand','source','edition','chinese','english','community'];
export function validateCloudContinuationArtifact(response,expected={}){
 check(exact(response,['version','status','jobId','siteId','articleId','requestKey','continuationOwner','artifactSha256','artifact']));
 check(response.version===1&&response.status==='ready'&&response.continuationOwner==='cloud'&&hex(response.artifactSha256));
 const a=response.artifact;check(exact(a,artifactKeys)&&a.version===1&&a.continuationOwner==='cloud'&&CLOUD_CONTINUATION_SITES.includes(a.siteId));
 check(hex(a.jobId)&&hex(a.flowId,40)&&hex(a.sourceSha256)&&Number.isSafeInteger(a.revision)&&a.revision>0&&/^[a-zA-Z0-9_-]{12,128}$/.test(a.requestKey||''));
 for(const key of ['jobId','siteId','articleId','requestKey','continuationOwner'])check(response[key]===a[key]);
 for(const [key,value] of Object.entries(expected))if(value!==undefined)check(a[key]===value);
 check(a.jobId===hash([a.siteId,a.requestKey]));originOf(a.origin);validateSource(a.source);
 check(a.source.id===a.articleId&&sourceContentSha256(a.source)===a.sourceSha256);
 check(a.flowId===hash([a.siteId,a.articleId,a.revision,a.sourceSha256]).slice(0,40));
 let route;try{const url=new URL(a.sourceUrl);check(url.origin===a.origin&&!url.username&&!url.password&&!url.search&&!url.hash&&!/%(?:2f|5c)/i.test(url.pathname)&&a.sourceUrl===a.origin+url.pathname);route=url.pathname;}catch{throw failure();}
 if(a.source.record){const prefix={year:'/calendar/',history:'/history/',openSource:'/open-source/'}[a.source.record.kind];check(route.startsWith(prefix)&&route.endsWith('/'));}else check(route==='/news/'+a.articleId+'/');
 check(exact(a.brand,['name','slogan'])&&typeof a.brand.name==='string'&&a.brand.name.length>0&&a.brand.name.length<=500&&typeof a.brand.slogan==='string'&&a.brand.slogan.length<=500);
 check(exact(a.edition,['title','summary','markdown']));for(const [key,max] of [['title',500],['summary',4000],['markdown',160000]])check(typeof a.edition[key]==='string'&&a.edition[key].trim()&&a.edition[key].length<=max);
 for(const key of ['chinese','english','community'])check(exact(a[key],stageKeys)&&a[key].status==='verified');
 check(a.chinese.url===a.sourceUrl&&a.chinese.revision===a.revision&&a.english.url===a.origin+'/en/news/'+a.articleId+'/'&&Number.isSafeInteger(a.english.revision)&&a.english.revision>0&&communityUrl(a.community.url));
 check(continuationArtifactSha256(a)===response.artifactSha256);return a;
}

export function createCloudContinuationArtifact({queueState,packet,plan,state,publication,site}){
 check(queueState.continuationOwner==='cloud'&&queueState.credentialId&&plan.publicationCredential===queueState.credentialId);
 check(plan.version===1&&queueState.siteId===site.id&&queueState.status==='complete'&&queueState.receipt?.requestKey===queueState.requestKey&&queueState.receipt.publicReadback===true&&queueState.receipt.job?.status==='success'&&state.complete===true&&!['stale','needs_review'].includes(state.status));
 check(plan.id===queueState.continuation?.id&&plan.siteId===site.id&&plan.origin===site.origin&&plan.articleId===queueState.articleId&&packet.requestKey===queueState.requestKey&&packet.data.id===plan.articleId&&sourceContentSha256(packet.data)===plan.sha256&&queueState.receipt.revision===plan.revision&&plan.sourceUrl===site.origin+queueState.receipt.url);
 const source=publicSource(plan.source),edition=select(state.edition,['title','summary','markdown']);
 check(sourceContentSha256(source)===plan.sha256);
 const published=publication?.request?.data,expected={...source,...edition,id:editionArticleId(plan.articleId,'en'),title:edition.title?.trim(),summary:edition.summary?.trim(),markdown:edition.markdown?.trim(),record:undefined,assets:[]};
 check(publication?.status==='success'&&publication.publicReadback?.status==='verified'&&published?.locale==='en'&&published.id===expected.id&&published.translationOf?.articleId===plan.articleId&&published.translationOf?.revision===plan.revision&&published.translationOf?.sha256===plan.sha256&&sourceContentSha256(published)===sourceContentSha256(expected));
 check(publication.request.requestKey===state.english?.requestKey&&publication.publicReadback.url===state.english.url&&publication.publicReadback.revision===state.english.revision&&publication.publicReadback.bodySha256===hash(published.markdown));
 const artifact={version:1,jobId:queueState.jobId,siteId:site.id,origin:site.origin,articleId:plan.articleId,requestKey:queueState.requestKey,continuationOwner:'cloud',flowId:plan.id,revision:plan.revision,sourceSha256:plan.sha256,sourceUrl:plan.sourceUrl,brand:select(plan.brand,['name','slogan']),source,edition,chinese:select(state.chinese,stageKeys),english:select(state.english,stageKeys),community:select(state.community,stageKeys)};
 const response={version:1,status:'ready',...select(artifact,['jobId','siteId','articleId','requestKey','continuationOwner']),artifactSha256:continuationArtifactSha256(artifact),artifact};
 validateCloudContinuationArtifact(response);return response;
}

function receiptIdentity({siteId,articleId,receipt}){
 const q=receipt?.asyncQueue,binding=q?.binding;check(CLOUD_CONTINUATION_SITES.includes(siteId)&&q?.continuationOwner==='cloud'&&q.owner==='cloud'&&binding?.version===1&&binding.siteId===siteId&&binding.articleId===articleId&&binding.requestKey===receipt.requestKey&&binding.packetSha256===q.packetSha256&&binding.sourceSha256===receipt.sourceSha256&&hex(binding.packetSha256)&&hex(binding.sourceSha256));
 check(q.jobId===hash([siteId,receipt.requestKey])&&receipt.publicReadback===true&&receipt.job?.status==='success'&&Number.isSafeInteger(receipt.revision));
 const flowId=q.continuation?.id||receipt.publishingFlow?.id;check(hex(flowId,40)&&typeof receipt.url==='string'&&receipt.url.startsWith('/')&&!receipt.url.startsWith('//'));originOf(binding.origin);
 return {jobId:q.jobId,siteId,origin:binding.origin,articleId,requestKey:receipt.requestKey,revision:receipt.revision,flowId,sourceUrl:binding.origin+receipt.url};
}
export async function saveCloudContinuationArtifact({root,siteId,articleId,receipt,response}){
 check(isAbsolute(root));const expected=receiptIdentity({siteId,articleId,receipt}),a=validateCloudContinuationArtifact(response,expected),key=a.jobId+'.json',directory=join(root,'.local/publishing-flow/remote'),file=join(directory,key);
 const retained=receipt.asyncQueue.continuation?.artifact;if(retained)check(exact(retained,['version','jobId','id','sha256','key'])&&retained.version===1&&retained.jobId===a.jobId&&retained.id===a.flowId&&retained.sha256===response.artifactSha256&&retained.key===key);
 await withFileLock(file+'.lock',async()=>{
  await assertCloudArtifactSupersessionSettled({root,jobId:a.jobId});
  const prior=await optional(file);if(prior){validateCloudContinuationArtifact(prior,expected);check(prior.artifactSha256===response.artifactSha256);}else await durableWriteJson(file,response);
  // Directory creation must survive before the receipt can settle its index.
  if(process.platform!=='win32')for(const path of [directory,join(root,'.local/publishing-flow'),join(root,'.local'),root]){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
 });
 return {version:1,jobId:a.jobId,id:a.flowId,sha256:response.artifactSha256,key};
}
export async function readCloudContinuationEvidence({root,siteId,articleId,receipt}){
 if(receipt?.asyncQueue?.continuationOwner!=='cloud')return null;
 await assertCloudArtifactSupersessionSettled({root,jobId:receipt.asyncQueue.jobId});
 const ref=receipt.asyncQueue.continuation?.artifact;if(!ref)return null;check(isAbsolute(root));
 const expected=receiptIdentity({siteId,articleId,receipt});check(exact(ref,['version','jobId','id','sha256','key'])&&ref.version===1&&ref.jobId===expected.jobId&&ref.id===expected.flowId&&hex(ref.sha256)&&ref.key===expected.jobId+'.json');
 const response=await optional(join(root,'.local/publishing-flow/remote',ref.key));check(response);const a=validateCloudContinuationArtifact(response,expected);check(a.flowId===ref.id&&response.artifactSha256===ref.sha256);
 return {plan:{version:1,id:a.flowId,siteId:a.siteId,origin:a.origin,articleId:a.articleId,revision:a.revision,sha256:a.sourceSha256,sourceUrl:a.sourceUrl,brand:a.brand,source:a.source},state:{status:'complete',complete:true,chinese:a.chinese,english:a.english,community:a.community,edition:a.edition},artifactSha256:response.artifactSha256,jobId:a.jobId};
}
