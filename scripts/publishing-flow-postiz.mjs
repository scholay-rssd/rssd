import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {profiles} from './site-config.mjs';
import {hash,atomic,optional} from './publishing-flow.mjs';
import {editionArticleId} from '../contracts/language-editions.mjs';
const exec=promisify(execFile);
export function postizAdapter({handoffDirectory,command='/workspace/postiz-client/bin/postiz-safe',fetcher=fetch,allowedTargets,allowedSources,delivery='draft',publishAuthorization,now=Date.now,executor=exec}){
 if(!Array.isArray(allowedTargets)||!allowedTargets.length)throw Error('Postiz requires its own explicit target allowlist');
 if(!Array.isArray(allowedSources)||!allowedSources.length)throw Error('Postiz requires its own explicit article allowlist');
 if(!['draft','publish'].includes(delivery))throw Error('Postiz delivery must be draft or publish');
 if(delivery==='publish'&&(typeof publishAuthorization!=='string'||!publishAuthorization.trim()||publishAuthorization.length>4000))throw Error('Postiz publication requires a separate explicit publishAuthorization');
 const deliveryIntent=Object.freeze({mode:delivery,...(delivery==='publish'?{authorization:publishAuthorization}:{})});
 const run=async args=>{const {stdout}=await executor(command,args,{timeout:75000,maxBuffer:8*1024*1024});return JSON.parse(stdout);};
 let channelsPromise;const identityCache=new Map(),communityCache=new Map();
 const validateCloud=async packet=>(await import('./publishing-batch.mjs')).validateCloudPostizPacket({handoffDirectory,packet});
 const rateFile=packet=>join(handoffDirectory,'rate',hash([packet.target.platform,packet.target.integrationId])+'.json');
 function deliveryFor(packet){
  if(packet.cloudContinuation){if(packet.cloudContinuation.mode!=='draft')throw Error('Cloud continuation is authorized only for a Postiz draft');return {mode:'draft'};}
  return deliveryIntent;
 }
 function authorize(packet){
  if(!allowedSources.some(s=>s.siteId===packet.source.siteId&&(s.articleId==='*'||s.articleId===packet.source.articleId&&s.sha256===packet.source.sha256)))throw Error('Source article is outside the Postiz authorization');
  if(!allowedTargets.some(t=>t.integrationId===packet.target.integrationId&&t.platform===packet.target.platform&&t.locale===packet.target.locale&&(t.channelId||'')===(packet.target.channelId||'')))throw Error('External target is outside the Postiz authorization');
 }
 async function preflight(packet){
  authorize(packet);deliveryFor(packet);await validateCloud(packet);
  if(packet.target.platform==='devto'&&deliveryFor(packet).mode==='publish'){const last=await optional(rateFile(packet));if(last?.nextAt>now())throw Object.assign(Error('DEV.to account is cooling down before the next article'),{retryAt:last.nextAt});}
  const site=profiles.find(s=>s.id===packet.source.siteId);if(!site)throw Error('Unknown handoff site');
  const english=packet.target.locale==='en',structured=/^record-[a-f0-9-]{36}$/.test(packet.source.articleId);
  if(!packet.body.includes(packet.ownUrl)||!packet.body.includes(packet.communityUrl)||hash(packet.body)!==packet.bodySha256)throw Error('Handoff lost its verified links');
  const channels=await (channelsPromise||=run(['channels'])),accounts=channels.filter(c=>c.id===packet.target.integrationId),account=accounts[0];if(accounts.length!==1||account.disabled||account.provider!==packet.target.platform)throw Error('Postiz integration identity or availability changed');
  if(!identityCache.has(site.origin))identityCache.set(site.origin,fetcher(site.origin+'/publishing-identities.json',{redirect:'error',signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw Error('Publication identity unavailable');return r.json();}));
  const identities=await identityCache.get(site.origin);
  const sourceRoute=identities.articles?.[packet.source.articleId]?.route||(!structured?'/news/'+packet.source.articleId+'/':null);
  if(!sourceRoute||!sourceRoute.startsWith('/')||sourceRoute.startsWith('//'))throw Error('Public source permalink unavailable');
  const expected=site.origin+(english?'/en/news/'+packet.source.articleId+'/':sourceRoute);if(packet.ownUrl!==expected)throw Error('Handoff does not use the matching language permalink');
  const ownId=packet.target.locale==='en'?editionArticleId(packet.source.articleId,'en'):packet.source.articleId;
  if(identities.siteId!==site.id||identities.articles?.[packet.source.articleId]?.sha256!==packet.source.sha256||identities.articles?.[ownId]?.sha256!==packet.ownContentSha256||packet.target.locale==='en'&&identities.articles[ownId].translationOf?.sha256!==packet.source.sha256)throw Error('Public source/edition changed since handoff; review the current revision');
  const r=await fetcher(packet.ownUrl,{redirect:'error',signal:AbortSignal.timeout(20000)}),html=await r.text();if(!r.ok||!html.includes('<link rel="canonical" href="'+expected+'">'))throw Error('Own article is no longer publicly available');
  if(!communityCache.has(site.origin))communityCache.set(site.origin,fetcher(site.origin+'/community/links.json',{redirect:'error',signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw Error('Community map unavailable');return r.json();}));const links=await communityCache.get(site.origin);if(links.links?.[sourceRoute]!==packet.communityUrl)throw Error('Ente article mapping changed');
 }
 async function submit(packet,{preflighted=false,delivery:intent}={}){
  authorize(packet);const boundDelivery=deliveryFor(packet);intent??=boundDelivery;
  if(packet.cloudContinuation&&intent.mode!=='draft')throw Error('Cloud continuation cannot be promoted to publication by a global policy');
  if(!['draft','publish'].includes(intent?.mode)||intent.mode==='publish'&&(deliveryIntent.mode!=='publish'||intent.authorization!==deliveryIntent.authorization))throw Error('Postiz submission differs from its explicit delivery authorization');
  if(preflighted)await validateCloud(packet);else await preflight(packet);const file=join(handoffDirectory,'outbox',packet.id+'.md');await writeFile(file,packet.body,{mode:0o600});
  // The pilot received an explicit DEV.to 429 with a 300-second delay. Share
  // one six-minute account budget across sites, including network latency.
  if(packet.target.platform==='devto'&&intent.mode==='publish')await atomic(rateFile(packet),{id:packet.id,nextAt:now()+360000});
  // postiz-safe defaults to a draft. Only the independently authorized publish
  // intent may supply its two explicit publication switches.
  const result=await run(['create','--channel',packet.target.integrationId,'--content-file',file,'--title',packet.title,'--settings',JSON.stringify(packet.settings),...(intent.mode==='publish'?['--publish-now','--confirm-user-approved']:[])]);
  const ids=(Array.isArray(result.response)?result.response:[result.response]).map(x=>x?.postId||x?.id).filter(Boolean);if(ids.length!==1)throw Error('Postiz did not return one unambiguous post identity');
  return {postId:ids[0],marker:result.marker,submittedAt:new Date().toISOString()};
 }
 async function readback(packet,receipt){
  // Receipts predating delivery intent came from the old publish-only adapter.
  // Their original write can be observed, never changed or sent a second time.
  const mode=receipt.delivery?.mode||'publish';if(!['draft','publish'].includes(mode))throw Error('Unknown frozen Postiz delivery mode');
  if(receipt.bodySha256&&receipt.bodySha256!==packet.bodySha256)throw Error('Postiz receipt body differs from the frozen handoff');
  if(packet.cloudContinuation&&(packet.cloudContinuation.mode!=='draft'||mode!=='draft'))return {status:'needs_review',public:false,error:'Cloud continuation and its frozen Postiz draft intent differ'};
  const result=await run(receipt.postId?['get','--id',receipt.postId,'--date',receipt.intendedAt]:['posts','--date',receipt.intendedAt]);
  const posts=Array.isArray(result)?result:result.posts||[];
  const matches=posts.filter(p=>receipt.postId?p.id===receipt.postId:p.integration?.id===packet.target.integrationId&&hash(p.content||'')===packet.bodySha256);
  if(matches.length!==1)return {status:receipt.postId?'submitted':'unknown',readbackError:'No unique matching Postiz record; never resubmitted'};
  const post=matches[0];
  if(typeof post.id!=='string'||!post.id||post.integration?.id!==packet.target.integrationId||typeof post.content!=='string'||hash(post.content)!==packet.bodySha256)throw Error('Postiz record identity, account or complete body differs from the frozen handoff');
  if(post.state==='ERROR')return {status:'failed',postId:post.id,error:post.error||'Postiz reports ERROR; provider details are unavailable in this API'};
  if(mode==='draft'){
   if(post.state!=='DRAFT')return {status:'needs_review',postId:post.id,providerState:post.state,public:false,error:'Expected a saved Postiz draft; its provider state differs from the frozen draft intent'};
   let settings=post.settings;if(typeof settings==='string'){try{settings=JSON.parse(settings);}catch{throw Error('Postiz draft settings are unreadable');}}
   if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Postiz draft settings are unavailable for independent verification');
   for(const key of Object.keys(packet.settings||{}))if(!isDeepStrictEqual(settings[key],packet.settings[key]))throw Error('Postiz draft settings differ from the frozen handoff: '+key);
   const returnedTitle=post.title??settings.title;
   // Discord has no separate title field. Its summary title is the first
   // paragraph of the complete, hash-verified message, including on drafts.
   const bodyTitle=packet.target.platform==='discord'&&returnedTitle==null&&packet.target.format==='summary'&&post.content.startsWith(packet.title+'\n\n');
   if(!bodyTitle&&returnedTitle!==packet.title)throw Error('Postiz draft title differs from the frozen handoff');
   if(post.releaseURL||post.releaseId)return {status:'needs_review',postId:post.id,providerState:post.state,public:false,error:'Postiz draft unexpectedly has a publication receipt'};
   return {status:'draft_saved',postId:post.id,providerState:'DRAFT',verification:'postiz_draft_body',titleVerification:bodyTitle?'body_prefix':'provider_field',independentBodyReadback:true,public:false};
  }
  if(post.state!=='PUBLISHED'||!post.releaseURL||!post.releaseId)return {status:'submitted',postId:post.id,providerState:post.state};
  if(packet.target.platform==='discord'){
   const url=new URL(post.releaseURL);if(url.hostname!=='discord.com'||!url.pathname.includes('/'+packet.target.channelId+'/'))throw Error('Discord receipt channel differs');
   return {status:'verified',postId:post.id,url:post.releaseURL,releaseId:post.releaseId,verification:'provider_receipt',independentBodyReadback:false};
  }
  if(!/^\d+$/.test(String(post.releaseId)))throw Error('Invalid DEV.to article ID');
  const r=await fetcher('https://dev.to/api/articles/'+post.releaseId,{redirect:'error',headers:{'User-Agent':'Scholay-Publishing/1.0'},signal:AbortSignal.timeout(20000)}),article=await r.json();
  if(!r.ok||article.title!==packet.title||article.url!==post.releaseURL||article.canonical_url!==packet.ownUrl||String(article.body_markdown).replace(/\r\n/g,'\n').trim()!==packet.body.trim()||packet.target.username&&article.user?.username!==packet.target.username)throw Error('DEV.to public title/body/canonical/account does not match');
  const page=await fetcher(article.url,{redirect:'error',signal:AbortSignal.timeout(20000)}),html=await page.text();
  if(!page.ok||!html.includes(packet.ownUrl)||!html.includes(packet.communityUrl))throw Error('DEV.to public page is missing its article links');
  return {status:'verified',postId:post.id,url:article.url,releaseId:post.releaseId,verification:'public_body',independentBodyReadback:true};
 }
 return {delivery:deliveryIntent,deliveryFor,preflight,submit,readback};
}
