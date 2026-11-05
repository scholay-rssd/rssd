import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import pub from '../contracts/rssd-publication.cjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {sourceHashV2,SOURCE_HASH_VERSION_V2} from '../web/engine/source-hash-v1.mjs';
import {renderArticle} from '../web/engine/article-math.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {atomic,postizTick} from '../scripts/publishing-flow.mjs';
import {createCenterSocialDraftProof,createCenterDraftOnlyAdapter,createPostizDraftTransport} from '../scripts/rssd-center-social-drafts.mjs';

const account=async target=>({integrationId:target.integrationId,provider:target.platform,disabled:false,inBetweenSteps:false,refreshNeeded:false,observedAt:new Date().toISOString()});
const duplicate=packet=>({complete:true,integrationId:packet.target.integrationId,siteId:packet.snapshot.siteId,workId:packet.snapshot.workId,zhUrl:packet.snapshot.zhUrl,enUrl:packet.snapshot.enUrl,observedAt:new Date().toISOString(),matches:[]});
function fixture(){
 const profile=profiles.find(x=>x.id==='metho'),slot={siteId:'metho',workspaceId:'metho',sectionId:'methods',destinationId:'site-metho',requireFlow:true,requiredLocales:['zh-CN','en']},workId='work-one',sourceUrl='https://source.example/article',locale=(lang)=>({locale:lang,title:lang==='en'?'English title':'中文标题',summary:'A complete summary',bodyMarkdown:'Content explaining the research.\n\n## References\n\n[Reference](https://source.example/article)',sources:[{title:'Reference',url:sourceUrl}],media:[],metadata:{author:'Author',date:'2026-11-02',category:'Methods',notebook:{sources:[{id:'source-one',url:sourceUrl}],blocks:[{sourceIds:['source-one']}]}},translationOf:lang==='en'?{workId,locale:'zh-CN',revision:1}:null});
 const editions=['zh-CN','en'].map(lang=>({locale:lang,revision:1,payload:locale(lang)}));const current={id:workId,workspaceId:'metho',sectionId:'methods',editions};
 const records=editions.map((e,n)=>{const contentHash=protocol.hash(e.payload),key=pub.contentKey({workId,locale:e.locale}),requestId='publication-'+n,route=n?'/en/news/article-one/':'/news/article-one/',packet={version:1,requestId,siteId:'metho',workspaceId:'metho',sectionId:'methods',workId,locale:e.locale,revision:1,contentHash,route,content:pub.publicContent(e.payload)};const url=profile.origin+route,publicUrl=profile.origin+'/rssd-content/'+key+'.json';return {packet,url,publicUrl,indexId:'rssd-'+key.slice(0,32),identity:{id:requestId,requestId:'submission-'+n,locale:e.locale,revision:1,contentHash},row:{id:requestId,workspaceId:'metho',workId,locale:e.locale,destinationId:'site-metho',revision:1,state:'published',receipt:{state:'success',requestId,siteId:'metho',workId,locale:e.locale,revision:1,contentHash,packetHash:protocol.hash(packet),url,publicUrl}}};});
 const [zh,en]=records,c=zh.packet.content,view={id:zh.indexId,title:c.title,markdown:c.bodyMarkdown,summary:c.summary,locale:'zh-CN',sectionId:'methods',category:c.metadata.category,author:c.metadata.author,date:c.metadata.date,sources:c.sources.map(s=>({label:s.title||'Source',url:s.url})),assets:[]},translationOf={articleId:zh.indexId,revision:1,sha256:sourceHashV2(view)};
 const index={version:1,siteId:'metho',articles:{[zh.indexId]:{sha256:sourceContentSha256(view),route:zh.packet.route,locale:'zh-CN'},[en.indexId]:{sha256:'a'.repeat(64),route:en.packet.route,locale:'en',translationOf}}},language={version:1,siteId:'metho',editions:[{id:en.indexId,route:en.packet.route,sourceArticleId:zh.indexId,sourceUrl:zh.url,sourceVersionState:'current',stale:false,sourceHashVersion:SOURCE_HASH_VERSION_V2,translationOf}]};
 const map={version:1,links:{[zh.packet.route]:'https://enterscholar.com/t/-/12345'}},client={publications:async()=>records.map(x=>x.row),work:async()=>structuredClone(current)},fetchPage=async url=>{let text;if(url===profile.origin+'/publishing-identities.json')text=JSON.stringify(index);else if(url===profile.origin+'/language-editions.json')text=JSON.stringify(language);else if(url===profile.origin+'/community/links.json')text=JSON.stringify(map);else {const item=records.find(x=>url===x.publicUrl||url===x.url);if(!item)throw Error('unexpected URL');text=url===item.publicUrl?JSON.stringify(item.packet):`<link rel="canonical" href="${item.url}"><div class="article-body">${renderArticle(item.packet.content.bodyMarkdown)}</div>`;}return {reachable:true,finalUrl:url,text};};
 const context={slot,work:{workId,publications:records.map(r=>r.identity)},targets:[{platform:'devto',locale:'en',integrationId:'devto-one',format:'article'},{platform:'discord',locale:'zh-CN',integrationId:'discord-one',channelId:'1562031229606301696',format:'summary'}],authorization:'Prepare draft only for these accounts',plannedAt:'2026-11-03T00:00:00.000Z'};
 const quality={state:'accepted',workId,reviewId:'review-one',sourceContentHash:zh.identity.contentHash,englishContentHash:en.identity.contentHash},verifyQualityReview=async()=>structuredClone(quality);
 return {profile,slot,current,records,index,language,map,client,fetchPage,context,quality,proof:createCenterSocialDraftProof({client,profiles:[profile],fetchPage,verifyQualityReview})};
}

test('only a fully verified current bilingual binding produces exact source-bound draft packets',async()=>{
 const f=fixture(),result=await f.proof(f.context);assert.equal(result.packets.length,2);assert.equal(result.snapshot.sourceRenderId,f.records[0].indexId);assert.equal(result.snapshot.enUrl,f.records[1].url);assert(result.packets[0].body.includes(f.records[1].url));assert(result.packets[1].body.includes(f.records[0].url));assert.equal(result.packets[0].settings.canonical,f.records[1].url);
});

test('missing, stale or forged binding and source references never create a draft',async()=>{
 for(const mutate of [f=>{f.language.editions[0].sourceVersionState='unknown';},f=>{f.language.editions[0].translationOf.sha256='b'.repeat(64);},f=>{f.language.editions[0].sourceHashVersion='old';},f=>{f.index.articles[f.records[0].indexId].sha256='b'.repeat(64);},f=>{f.current.editions[1].payload.translationOf.revision=2;},f=>{f.map.links={};},f=>{f.records[1].row.state='queued';},f=>{f.quality.state='needs_review';},f=>{f.quality.sourceContentHash='b'.repeat(64);}]){const f=fixture();mutate(f);await assert.rejects(f.proof(f.context));}
});

test('draft-only adapter persists one original intent and reconciles a lost response without resending',async t=>{
 const f=fixture(),directory=await mkdtemp(join(tmpdir(),'rssd-social-draft-'));t.after(()=>rm(directory,{recursive:true,force:true}));const proofResult=await f.proof(f.context),packet=proofResult.packets[0];await atomic(join(directory,'outbox',packet.id+'.json'),packet);
 let writes=0,records=[];const transport={channels:async()=>[{id:'devto-one',identifier:'devto',disabled:false}],posts:async()=>records,createDraft:async payload=>{writes++;assert.equal(payload.type,'draft');assert.equal(payload.shortLink,false);records=[{id:'saved-one',integration:{id:'devto-one'},state:'DRAFT',content:packet.body,settings:packet.settings}];throw Error('lost response');}};
 const adapter=createCenterDraftOnlyAdapter({proof:f.proof,context:f.context,transport,allowedTargets:[f.context.targets[0]],verifyAccount:account,checkDuplicate:async packet=>duplicate(packet)});const first=await postizTick({handoffDirectory:directory,adapter});assert.equal(first[0].status,'draft_saved');assert.equal(first[0].public,false);assert.equal(writes,1);await postizTick({handoffDirectory:directory,adapter});assert.equal(writes,1);
 await assert.rejects(adapter.submit(packet,{delivery:{mode:'publish'}}),/preflight/);
});

test('partial or conflicting duplicate inventory and mutated packets never reach Postiz',async t=>{
 const f=fixture(),directory=await mkdtemp(join(tmpdir(),'rssd-social-check-'));t.after(()=>rm(directory,{recursive:true,force:true}));const packet=(await f.proof(f.context)).packets[0];await atomic(join(directory,'outbox',packet.id+'.json'),packet);let writes=0;
 const transport={channels:async()=>[{id:'devto-one',identifier:'devto',disabled:false}],posts:async()=>[],createDraft:async()=>{writes++;return [];}};
 const verifyAccount=account;
 for(const result of [{complete:false,matches:[]},{complete:true,matches:[{id:'existing'}]}]){const adapter=createCenterDraftOnlyAdapter({proof:f.proof,context:f.context,transport,allowedTargets:[packet.target],verifyAccount,checkDuplicate:async p=>({...duplicate(p),...result})});assert.equal((await postizTick({handoffDirectory:directory,adapter}))[0].status,'deferred');}
 const unsafe=createCenterDraftOnlyAdapter({proof:f.proof,context:f.context,transport,allowedTargets:[packet.target],verifyAccount:async target=>({...await account(target),refreshNeeded:true}),checkDuplicate:async p=>duplicate(p)});assert.equal((await postizTick({handoffDirectory:directory,adapter:unsafe}))[0].status,'deferred');
 const safe=createCenterDraftOnlyAdapter({proof:f.proof,context:f.context,transport,allowedTargets:[packet.target],verifyAccount,checkDuplicate:async p=>duplicate(p)});await safe.preflight(packet);await assert.rejects(safe.submit({...packet,body:'mutated'},{delivery:{mode:'draft'}}),/preflight/);assert.equal(writes,0);
});

test('HTTP transport exposes only fixed draft create and dated read endpoints',async()=>{
 let calls=[];const fetcher=async(url,opt)=>{calls.push({url,opt});return {ok:true,json:async()=>url.endsWith('/integrations')?[]:url.includes('?')?{posts:[]}:[{postId:'draft',integration:'devto-one'}]};};const t=createPostizDraftTransport({apiBase:'https://post.example/api',token:'private-key',fetcher});
 await t.channels();await t.posts('2026-11-03T00:00:00.000Z');await assert.rejects(t.createDraft({type:'now'}),/draft/);await t.createDraft({type:'draft',shortLink:false,posts:[{value:[{content:'x',image:[]}]}]});
 assert.equal(calls.length,3);assert.equal(JSON.parse(calls[2].opt.body).type,'draft');assert.equal(calls[2].opt.redirect,'error');assert(!calls.some(x=>x.url.includes('private-key')));
});
