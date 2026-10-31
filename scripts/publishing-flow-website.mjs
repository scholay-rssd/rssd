import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic,optional,flowDirectory,hash} from './publishing-flow.mjs';
import {sourceContentSha256,editionArticleId,editionRoute} from '../contracts/language-editions.mjs';
import {validateNews} from '../admin/news.mjs';
import {articleBodyOnPage} from './website-article-readback.mjs';
import {isPrivateFile} from './private-file.mjs';
import {flowCredential} from './publishing-flow-credentials.mjs';

export function flowWebsite({root,site,tokenFile,fetcher=fetch,now=Date.now,requireBoundCredential=process.env.SCHOLAY_CLOUD_EXECUTOR==='1'}){
 let connected=false;
 async function api(path,body,plan){
  if(plan&&(plan.siteId!==site.id||plan.origin!==site.origin))throw Object.assign(Error('Continuation credential belongs to another site'),{statusCode:409});
  const boundToken=await flowCredential(root,plan,{required:requireBoundCredential});
  if(!connected){const r=await fetcher(site.origin+'/manage/api/site',{redirect:'error',signal:AbortSignal.timeout(15000)}),descriptor=await r.json();if(!r.ok||descriptor.protocol!=='scholay-content'||descriptor.version!==1||descriptor.siteId!==site.id||descriptor.origin!==site.origin||!descriptor.capabilities?.includes('language-editions-v1'))throw Error('Website language edition capability is not deployed');connected=true;}
  if(!boundToken&&!process.env.SCHOLAY_TODAY_TOKEN&&!await isPrivateFile(tokenFile))throw Error('Website token requires private file permissions');
  const token=boundToken||process.env.SCHOLAY_TODAY_TOKEN||(await readFile(tokenFile,'utf8')).trim();
  const r=await fetcher(site.origin+'/manage/api/news'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'X-Scholay-Site':site.id,'X-Scholay-Protocol':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Website HTTP '+r.status),{statusCode:r.status});return data;
 }
 async function readSource(id,{identityOnly=false,plan}={}){const bundle=await api('/flow-source/'+id+(identityOnly?'?identity=1':''),undefined,plan);if(!identityOnly&&(bundle.data?.id!==id||bundle.data.locale))throw Error('Expected a Chinese publication source');return bundle;}
 async function verify(data,revision,{plan}={}){
  const remote=await api('/flow-source/'+data.id+'?identity=1',undefined,plan),url=site.origin+(data.record?remote.url:editionRoute(data));
  if(remote.version!==revision||remote.publishedVersion!==revision||remote.sha256!==sourceContentSha256(data))throw Error('Published version differs from this operation');
  const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30000)}),html=await r.text();
  if(!r.ok||!html.includes('<link rel="canonical" href="'+url+'">')||!data.record&&!articleBodyOnPage(html,data.markdown,site)||data.locale==='en'&&!/<html[^>]*lang="en"/.test(html))throw Error('Public article body or canonical is not ready');
  return {status:'verified',url,revision,bodySha256:hash(data.markdown)};
 }
 async function publishEdition(plan,english){
  const dir=join(flowDirectory(root),'jobs',plan.id),file=join(dir,'website-en.json');let receipt=await optional(file);
  if(!receipt){
   const source=await readSource(plan.articleId,{plan});if(source.version!==plan.revision||source.publishedVersion!==plan.revision||sourceContentSha256(source.data)!==plan.sha256)throw Error('Source changed before English submission');
   const data=validateNews({...plan.source,...english,id:editionArticleId(plan.articleId,'en'),assets:[],locale:'en',translationOf:{articleId:plan.articleId,revision:plan.revision,sha256:plan.sha256}},null,site);
   let prior;try{prior=await api('/cloud/'+data.id,undefined,plan);}catch(e){if(e.statusCode!==404)throw e;}
   if(prior?.data?.translationOf?.articleId!==undefined&&prior.data.translationOf.articleId!==plan.articleId)throw Error('English record identity mismatch');
   const request={requestKey:randomUUID(),data,expectedVersion:prior?.version||0,expectedPublishedVersion:prior?.publishedVersion??null};
   receipt={status:'unknown',request,intendedAt:new Date(now()).toISOString(),sends:1,lastSendAt:now()};await atomic(file,receipt);
   try{receipt={...receipt,result:await api('/publish',request,plan),status:'submitted'};}catch(e){receipt.error=e.message;if(e.statusCode&&e.statusCode<500&&e.statusCode!==429)receipt.status='rejected';}await atomic(file,receipt);
  }
  if(receipt.status==='rejected')return {status:'rejected',error:receipt.error};
  // Always query the original key first. Only an authoritative 404 permits
  // replay of the identical idempotent request (including optimistic versions).
  let result;try{result=await api('/requests/'+receipt.request.requestKey,undefined,plan);}catch(e){
   receipt.error=e.message;
   if(e.statusCode===404&&(receipt.sends||0)<3&&now()-(receipt.lastSendAt||0)>=30000){
    receipt.sends=(receipt.sends||0)+1;receipt.lastSendAt=now();await atomic(file,receipt);
    try{result=await api('/publish',receipt.request,plan);}catch(sendError){receipt.error=sendError.message;if(sendError.statusCode&&sendError.statusCode<500&&sendError.statusCode!==429)receipt.status='rejected';}
   }
   await atomic(file,receipt);if(!result)return {status:receipt.status==='rejected'?'rejected':e.statusCode===404&&receipt.sends>=3?'needs_review':'unknown',error:receipt.error};
  }
  if(result.job.status==='failed'&&(receipt.buildRetries||0)<3&&now()-(receipt.lastRetryAt||0)>=60000){
   const source=await readSource(plan.articleId,{identityOnly:true,plan});if(source.version!==plan.revision||source.sha256!==plan.sha256)throw Error('Source changed before English build recovery');
   receipt.buildRetries=(receipt.buildRetries||0)+1;receipt.lastRetryAt=now();await atomic(file,receipt);
   result=await api('/requests/'+receipt.request.requestKey+'/retry',{jobId:result.job.id},plan);
  }
  receipt.result=result;receipt.status=result.job.status;await atomic(file,receipt);
  if(result.job.status!=='success')return {status:result.job.status==='failed'&&receipt.buildRetries>=3?'needs_review':result.job.status,requestKey:receipt.request.requestKey,error:result.job.error||undefined};
  const verified=await verify(receipt.request.data,result.revision,{plan});receipt.publicReadback=verified;await atomic(file,receipt);return {...verified,requestKey:receipt.request.requestKey};
 }
 return {readSource,publishEdition,verify};
}
