// Draft-only social bridge for RSSD's receiver-backed articles. Importing this
// module never creates a Postiz post. Every send is driven by postizTick's
// private outbox/slot/receipt lock and is permanently fixed to DRAFT.
import {createPublicationReadbackAdapter} from './rssd-publication-readback.mjs';
import {fetchPublicText} from './rssd-topic-public.mjs';
import {verifyAutomatedReferences} from './rssd-reference-gate.mjs';
import {sourceHashV2,SOURCE_HASH_VERSION_V2} from '../web/engine/source-hash-v1.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import {hash} from './publishing-flow.mjs';
import protocol from '../contracts/rssd-v1.cjs';
import pub from '../contracts/rssd-publication.cjs';

const same=(a,b)=>protocol.canonical(a)===protocol.canonical(b);
const fail=message=>{throw Error(message);};
const targetKey=t=>[t.platform,t.locale,t.integrationId,t.channelId||'',t.format];
function validateTarget(t){
 if(!t||typeof t.integrationId!=='string'||!/^[a-zA-Z0-9_-]{3,128}$/.test(t.integrationId))fail('Invalid draft account');
 if(t.platform==='devto'&&t.locale==='en'&&t.format==='article'&&Object.keys(t).sort().join(',')==='format,integrationId,locale,platform')return;
 if(t.platform==='discord'&&t.locale==='zh-CN'&&t.format==='summary'&&/^\d{16,22}$/.test(t.channelId||'')&&Object.keys(t).sort().join(',')==='channelId,format,integrationId,locale,platform')return;
 fail('Unsupported draft target');
}
function assertDraftPacket(packet){
 validateTarget(packet?.target);const snapshot=packet.snapshot;
 if(!snapshot||packet.proofHash!==protocol.hash(snapshot)||packet.bodySha256!==hash(packet.body||'')||typeof packet.date!=='string'||!Number.isFinite(Date.parse(packet.date))||new Date(packet.date).toISOString()!==packet.date||typeof packet.authorization!=='string'||!packet.authorization.trim())fail('Draft packet identity invalid');
 const slotId=hash([snapshot.siteId,snapshot.workId,targetKey(packet.target)]).slice(0,40),id=hash([slotId,packet.proofHash,packet.bodySha256,protocol.hash(packet.settings),packet.date]).slice(0,40);
 const expectedUrl=packet.target.locale==='en'?snapshot.enUrl:snapshot.zhUrl,settings=packet.target.platform==='discord'?{__type:'discord',channel:packet.target.channelId}:{__type:'devto',title:packet.title,canonical:expectedUrl,tags:[]};
 if(packet.slot!==slotId||packet.id!==id||packet.ownUrl!==expectedUrl||packet.communityUrl!==snapshot.communityUrl||!packet.body.includes(packet.ownUrl)||!packet.body.includes(packet.communityUrl)||!same(packet.settings,settings))fail('Draft packet identity invalid');
}
function sourceView(packet,id,profile){
 if(packet.content?.metadata?.record)fail('Structured records require a separate verified identity bridge');
 const c=packet.content,section=sectionsForSite(profile).find(x=>x.id===packet.sectionId);if(!section)fail('Source section not in site profile');
 return {id,title:c.title,markdown:c.bodyMarkdown,summary:c.summary,locale:packet.locale,sectionId:packet.sectionId,category:c.metadata.category||section.name||profile.columns[1],author:c.metadata.author||profile.author,date:c.metadata.date||'1970-01-01',sources:c.sources.map(s=>({label:s.title||'Source',url:s.url})),assets:[]};
}
function oneByRoute(index,route,locale){
 const found=Object.entries(index.articles||{}).filter(([,v])=>v?.route===route&&v.locale===locale);if(found.length!==1)fail('Published renderer identity is absent or ambiguous');return {id:found[0][0],...found[0][1]};
}
async function collectPublications(client,workspaceId){
 const rows=[],seen=new Set();for(let offset=0;offset<=1000000;offset+=200){const page=await client.publications({workspaceId,limit:200,offset});if(!Array.isArray(page)||page.length>200)fail('Invalid Center publication inventory');for(const row of page){if(!row?.id||row.workspaceId!==workspaceId||seen.has(row.id))fail('Center publication inventory is inconsistent');seen.add(row.id);rows.push(row);}if(page.length<200)return rows;}fail('Center publication inventory exceeds bound');
}
export function createCenterSocialDraftProof({client,profiles,verifyQualityReview,fetchPage=fetchPublicText}){
 if(!client||typeof client.work!=='function'||typeof client.publications!=='function'||!Array.isArray(profiles)||typeof fetchPage!=='function'||typeof verifyQualityReview!=='function')fail('Explicit Center, quality review and public readback required');
 const readback=createPublicationReadbackAdapter({client,profiles,fetchPage});
 return async({slot,work,targets,authorization,plannedAt,signal})=>{
  if(typeof authorization!=='string'||!authorization.trim()||authorization.length>2000||!Array.isArray(targets)||!targets.length)fail('Explicit article and draft destinations required');targets.forEach(validateTarget);if(new Set(targets.map(t=>JSON.stringify(targetKey(t)))).size!==targets.length)fail('Duplicate target');
  if(typeof plannedAt!=='string'||!Number.isFinite(Date.parse(plannedAt))||new Date(plannedAt).toISOString()!==plannedAt)fail('An immutable draft calendar date is required');
  if(slot.requireFlow!==true||!same([...slot.requiredLocales].sort(),['en','zh-CN'])||work.publications?.length!==2)fail('Both languages and community flow are required');
  const profile=profiles.find(x=>x.id===slot.siteId);if(!profile||profile.spaceId!==slot.workspaceId)fail('Wrong site profile');
  const state=await readback({slot,work,signal});if(state.state!=='verified'||!state.communityUrl)fail('Public editions or discussion are not verified');
  const rows=await collectPublications(client,slot.workspaceId),current=await client.work(work.workId);if(current?.id!==work.workId||current.workspaceId!==slot.workspaceId||current.sectionId!==slot.sectionId||!Array.isArray(current.editions))fail('Current Center work identity changed');
  const byLocale={};
  const getJson=async path=>{const u=profile.origin+path,r=await fetchPage(u,{proxyMode:'configured-rss',configuredRssHost:new URL(profile.origin).hostname,timeoutMs:12000,maxBytes:8*1024*1024,maxRedirects:0});if(!r?.reachable||r.finalUrl!==u||typeof r.text!=='string')fail('Public evidence unavailable');return JSON.parse(r.text);};
  for(const identity of work.publications){
   const row=rows.find(x=>x.id===identity.id),edition=current.editions.find(x=>x.locale===identity.locale),matched=state.urls.find(x=>x.locale===identity.locale);
   if(!row||row.state!=='published'||row.workId!==work.workId||row.destinationId!==slot.destinationId||row.revision!==identity.revision||row.locale!==identity.locale||row.receipt?.state!=='success'||row.receipt.requestId!==identity.id||row.receipt.contentHash!==identity.contentHash||!matched||matched.publicationId!==identity.id||row.receipt.url!==matched.url||edition?.revision!==identity.revision||protocol.hash(edition.payload)!==identity.contentHash)fail('Center edition or publication changed');
   if(identity.locale==='en'&&(edition.payload.translationOf?.workId!==work.workId||edition.payload.translationOf?.locale!=='zh-CN'||edition.payload.translationOf?.revision!==work.publications.find(x=>x.locale==='zh-CN')?.revision))fail('Center English source revision changed');
   if(identity.locale==='zh-CN'&&edition.payload.translationOf)fail('Chinese source cannot be a translation');
   verifyAutomatedReferences(edition.payload);
   const packet=await getJson('/rssd-content/'+pub.contentKey({workId:work.workId,locale:identity.locale})+'.json');
   if(protocol.hash(packet)!==row.receipt.packetHash||packet.requestId!==identity.id||packet.workId!==work.workId||packet.locale!==identity.locale||packet.revision!==identity.revision||packet.contentHash!==identity.contentHash||packet.route!==new URL(matched.url).pathname||!same(packet.content,pub.publicContent(edition.payload)))fail('Public packet changed');
   byLocale[identity.locale]={packet,identity,url:matched.url};
  }
  const [index,language]=await Promise.all([getJson('/publishing-identities.json'),getJson('/language-editions.json')]);if(index.version!==1||index.siteId!==slot.siteId||language.version!==1||language.siteId!==slot.siteId||!Array.isArray(language.editions))fail('Publication indexes do not match site');
  const zh=byLocale['zh-CN'],en=byLocale.en,zhIndex=oneByRoute(index,zh.packet.route,'zh-CN'),enIndex=oneByRoute(index,en.packet.route,'en'),view=sourceView(zh.packet,zhIndex.id,profile);
  if(zhIndex.sha256!==sourceContentSha256(view))fail('Chinese renderer fingerprint does not match');
  const lang=language.editions.filter(e=>e.id===enIndex.id&&e.route===en.packet.route);if(lang.length!==1)fail('English binding is absent or ambiguous');const binding=lang[0],tr=binding.translationOf;
  if(binding.sourceVersionState!=='current'||binding.stale!==false||binding.sourceHashVersion!==SOURCE_HASH_VERSION_V2||binding.sourceArticleId!==zhIndex.id||binding.sourceUrl!==zh.url||tr?.articleId!==zhIndex.id||tr.revision!==zh.identity.revision||tr.sha256!==sourceHashV2(view)||!same(enIndex.translationOf,tr))fail('English edition is not bound to the current Chinese source');
  // Re-read the public and Center state after the index/binding reads to avoid
  // freezing a mixed revision; the adapter redoes this before any draft write.
  const review=await verifyQualityReview({slot,work,sourceEdition:current.editions.find(e=>e.locale==='zh-CN'),englishEdition:current.editions.find(e=>e.locale==='en'),signal});
  if(review?.state!=='accepted'||review.workId!==work.workId||review.sourceContentHash!==zh.identity.contentHash||review.englishContentHash!==en.identity.contentHash||typeof review.reviewId!=='string'||!review.reviewId.trim())fail('Article quality review is not accepted for these exact editions');
  const [checked,currentAgain]=await Promise.all([readback({slot,work,signal}),client.work(work.workId)]);if(!same(checked,state)||!same(current,currentAgain))fail('Publications changed during proof');
  const snapshot={siteId:slot.siteId,workspaceId:slot.workspaceId,sectionId:slot.sectionId,workId:work.workId,publications:work.publications,sourceRenderId:zhIndex.id,sourceRenderHash:tr.sha256,englishRenderId:enIndex.id,qualityReviewHash:protocol.hash(review),communityUrl:state.communityUrl,zhUrl:zh.url,enUrl:en.url};
  const proofHash=protocol.hash(snapshot),packets=[];
  for(const target of targets){const c=byLocale[target.locale].packet.content,ownUrl=byLocale[target.locale].url,footer=target.locale==='en'?`\n\n---\n\nOriginally published: [${c.title}](${ownUrl})\n\n[Discuss on EntScholar (Chinese)](${state.communityUrl})`:`\n\n全文：${ownUrl}\n恩特讨论：${state.communityUrl}`,body=target.format==='article'?c.bodyMarkdown+footer:c.title+'\n\n'+Array.from(c.summary).slice(0,600).join('')+footer;if(target.platform==='discord'&&body.length>1900)fail('Discord draft exceeds limit');
   const settings=target.platform==='discord'?{__type:'discord',channel:target.channelId}:{__type:'devto',title:c.title,canonical:ownUrl,tags:[]};const slotId=hash([slot.siteId,work.workId,targetKey(target)]).slice(0,40),id=hash([slotId,proofHash,hash(body),protocol.hash(settings),plannedAt]).slice(0,40);packets.push({version:1,id,slot:slotId,date:plannedAt,authorization:authorization.trim(),proofHash,snapshot,target:structuredClone(target),title:c.title,body,bodySha256:hash(body),ownUrl,communityUrl:state.communityUrl,settings});
  }
  return {proofHash,snapshot,packets};
 };
}

// This adapter can only emit draft requests. The existing postizTick reserves a
// durable original intent before submit; uncertain writes are query-only.
export function createCenterDraftOnlyAdapter({proof,context,transport,allowedTargets,checkDuplicate,verifyAccount,clock=Date.now}){
 if(typeof proof!=='function'||!context||!transport||!['channels','posts','createDraft'].every(k=>typeof transport[k]==='function')||!Array.isArray(allowedTargets)||typeof checkDuplicate!=='function'||typeof verifyAccount!=='function'||typeof clock!=='function')fail('Explicit draft proof, account status, complete duplicate check, transport and account allowlist required');
 const delivery=Object.freeze({mode:'draft'});let proofPackets;
 const fresh=value=>{const observed=Date.parse(value||''),now=Number(clock());return Number.isFinite(observed)&&Number.isFinite(now)&&observed<=now+1000&&now-observed<=60000;};
 async function preflight(packet){
  assertDraftPacket(packet);if(!allowedTargets.some(t=>same(t,packet.target)))fail('Draft account not allowed');const result=await proof(context);const bound=result.packets.find(p=>p.id===packet.id);if(!bound||!same(bound,packet))fail('Draft no longer matches current proof');
  const channels=await transport.channels(),matches=channels.filter(c=>c.id===packet.target.integrationId&&c.identifier===packet.target.platform&&!c.disabled);if(matches.length!==1)fail('Draft account unavailable');
  const account=await verifyAccount(packet.target);if(account?.integrationId!==packet.target.integrationId||account.provider!==packet.target.platform||account.disabled!==false||account.inBetweenSteps!==false||account.refreshNeeded!==false||!fresh(account.observedAt))fail('Draft account status is not verified');
  // A date-limited calendar read cannot prove there is no earlier draft.
  // The caller must provide a complete account/source inventory and refuse
  // ambiguity; do not infer completeness from an empty Postiz calendar week.
  const duplicate=await checkDuplicate(packet);if(duplicate?.complete!==true||duplicate.integrationId!==packet.target.integrationId||duplicate.siteId!==packet.snapshot.siteId||duplicate.workId!==packet.snapshot.workId||duplicate.zhUrl!==packet.snapshot.zhUrl||duplicate.enUrl!==packet.snapshot.enUrl||!fresh(duplicate.observedAt)||!Array.isArray(duplicate.matches)||duplicate.matches.length)fail('Existing account post requires reconciliation or complete scan');
  proofPackets=protocol.hash(packet);
 }
 async function submit(packet,{delivery:intent}={}){
  if(intent?.mode!=='draft'||proofPackets!==protocol.hash(packet))fail('Draft preflight required');assertDraftPacket(packet);proofPackets=undefined;
  const payload={type:'draft',date:packet.date,shortLink:false,tags:[],posts:[{integration:{id:packet.target.integrationId},value:[{content:packet.body,image:[]}],settings:packet.settings}]};
  const result=await transport.createDraft(payload);if(!Array.isArray(result)||result.length!==1||typeof result[0]?.postId!=='string'||result[0].integration!==packet.target.integrationId)fail('Postiz draft identity ambiguous');return {postId:result[0].postId,submittedAt:new Date().toISOString()};
 }
 async function readback(packet,receipt){
  if(receipt.delivery?.mode!=='draft')fail('Non-draft intent rejected');assertDraftPacket(packet);const posts=await transport.posts(packet.date),matches=posts.filter(p=>receipt.postId?p.id===receipt.postId:p.integration?.id===packet.target.integrationId&&hash(p.content||'')===packet.bodySha256);
  if(matches.length!==1)return {status:'unknown',public:false,readbackError:'Original draft identity remains uncertain'};const post=matches[0];let settings=post.settings;if(typeof settings==='string')try{settings=JSON.parse(settings);}catch{fail('Draft settings unreadable');}
  if(post.integration?.id!==packet.target.integrationId||post.state!=='DRAFT'||post.releaseId||post.releaseURL||hash(post.content||'')!==packet.bodySha256||!settings||Object.entries(packet.settings).some(([k,v])=>!same(settings[k],v)))fail('Draft state or body differs');
  return {status:'draft_saved',postId:post.id,providerState:'DRAFT',public:false,verification:'postiz_draft_body'};
 }
 return {delivery,deliveryFor:()=>delivery,preflight,submit,readback};
}

// The official Postiz public API key is provided privately by the caller and
// stays in a closure/header. This transport exposes no publish/schedule route.
export function createPostizDraftTransport({apiBase,token,fetcher=fetch}){
 let base;try{base=new URL(apiBase);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname.replace(/\/$/,'')!=='/api')throw Error();}catch{fail('Explicit HTTPS Postiz API base required');}
 if(typeof token!=='string'||!token.trim()||typeof fetcher!=='function')fail('Postiz credential is unavailable');
 const endpoint=base.origin+'/api/public/v1';
 async function request(path,{payload}={}){
  const r=await fetcher(endpoint+path,{method:payload?'POST':'GET',headers:{Authorization:token,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Object.assign(Error('Postiz draft API request failed'),{status:r.status});return r.json();
 }
 return {
  async channels(){const rows=await request('/integrations');if(!Array.isArray(rows))fail('Invalid Postiz channel response');return rows;},
  async posts(date){const t=Date.parse(date);if(!Number.isFinite(t))fail('Invalid draft observation date');const query=new URLSearchParams({startDate:new Date(t-86400000).toISOString(),endDate:new Date(t+86400000).toISOString()}),result=await request('/posts?'+query);if(!Array.isArray(result?.posts))fail('Invalid Postiz posts response');return result.posts;},
  async createDraft(payload){if(payload?.type!=='draft'||payload.shortLink!==false||!Array.isArray(payload.posts)||payload.posts.length!==1||payload.posts[0]?.value?.length!==1||payload.posts[0].value[0]?.id||payload.republish!==undefined)fail('Only a new draft request is permitted');return request('/posts',{payload});},
 };
}
