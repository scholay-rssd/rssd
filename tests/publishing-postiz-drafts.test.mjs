import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {profiles} from '../scripts/site-config.mjs';
import {atomic,optional,hash,externalPackage,postizTick} from '../scripts/publishing-flow.mjs';
import {postizAdapter} from '../scripts/publishing-flow-postiz.mjs';
import {watchPostiz} from '../scripts/publishing-flow-watch.mjs';
import {editionArticleId} from '../contracts/language-editions.mjs';

const site=profiles.find(value=>value.id==='metho');
const target={platform:'discord',locale:'zh-CN',integrationId:'approved-account',channelId:'1562031229606301696',format:'summary'};
async function fixture(t,destination=target){
 const directory=await mkdtemp(join(tmpdir(),'postiz-drafts-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const source={id:'postiz-draft-source',title:'Source title',summary:'Complete source summary.',markdown:'# Source title\n\nComplete source content.'};
 const plan={id:'e'.repeat(40),siteId:site.id,articleId:source.id,revision:1,sha256:hash(source),source,origin:site.origin,sourceUrl:site.origin+'/news/'+source.id+'/',brand:{name:'Metho',slogan:'Source-bound outreach.'},policy:{authorization:'Only this article and target are authorized for handoff'}};
 const edition={title:'English source title',summary:'Complete English summary.',markdown:'# English source title\n\nComplete English content.'};
 const packet=externalPackage(plan,destination,edition,'https://enterscholar.com/t/-/123456');
 await atomic(join(directory,'outbox',packet.id+'.json'),packet);
 const receiptFile=join(directory,'receipts',packet.id+'.json'),calls=[],state={records:[],creates:0,reads:0};
 const post=(changes={})=>({id:'post-1',state:'DRAFT',integration:{id:destination.integrationId},content:packet.body,settings:{...packet.settings,title:packet.title},...changes});
 const fetcher=async url=>{
  if(url===site.origin+'/publishing-identities.json')return Response.json({siteId:site.id,articles:{[source.id]:{sha256:plan.sha256},...(destination.locale==='en'?{[editionArticleId(source.id,'en')]:{sha256:packet.ownContentSha256,translationOf:{sha256:plan.sha256}}}:{})}});
  if(url===site.origin+'/community/links.json')return Response.json({links:{['/news/'+source.id+'/']:packet.communityUrl}});
  if(url===packet.ownUrl)return new Response('<link rel="canonical" href="'+packet.ownUrl+'">');
  assert.fail('Unexpected network request: '+url);
 };
 const executor=async(command,args)=>{
  calls.push(args);
  if(args[0]==='channels')return {stdout:JSON.stringify([{id:destination.integrationId,provider:destination.platform,disabled:false}])};
  if(args[0]==='create'){
   state.creates++;const receipt=await optional(receiptFile);assert(receipt?.delivery,'delivery must be durable before external write');
   assert.equal(await readFile(args[args.indexOf('--content-file')+1],'utf8'),packet.body);
   state.onCreate?.(receipt,args);
   if(state.createError)throw Error(state.createError);
   return {stdout:JSON.stringify({response:{postId:'post-1'}})};
  }
  if(['get','posts'].includes(args[0])){state.reads++;return {stdout:JSON.stringify(state.records)};}
  assert.fail('Unexpected transport command: '+args[0]);
 };
 const options={handoffDirectory:directory,allowedTargets:[destination],allowedSources:[{siteId:site.id,articleId:source.id,sha256:plan.sha256}],fetcher,executor};
 const tick=overrides=>postizTick({handoffDirectory:directory,adapter:postizAdapter({...options,...overrides})});
 return {directory,packet,receiptFile,post,calls,state,options,tick};
}

test('new delivery defaults to a verified local draft and never sets publication switches',async t=>{
 const f=await fixture(t);f.state.records=[f.post()];
 f.state.onCreate=(receipt,args)=>{assert.deepEqual(receipt.delivery,{mode:'draft'});assert(!args.includes('--publish-now'));assert(!args.includes('--confirm-user-approved'));};
 const [saved]=await f.tick();assert.equal(saved.status,'draft_saved');assert.equal(saved.public,false);assert.equal(saved.url,undefined);assert.equal(saved.providerState,'DRAFT');
 assert.deepEqual(saved.delivery,{mode:'draft'});assert.equal(saved.verification,'postiz_draft_body');
 await f.tick({delivery:'publish',publishAuthorization:'Independent explicit permission to publish new deliveries'});
 assert.equal(f.state.creates,1);assert.equal(f.state.reads,1,'a saved draft is terminal and is never promoted by a policy change');
});

test('publication requires independent authorization and freezes it before the write',async t=>{
 const f=await fixture(t);
 for(const options of [{delivery:'publish'},{delivery:'publish',publishAuthorization:''},{delivery:'scheduled'}])assert.throws(()=>postizAdapter({...f.options,...options}),/publishAuthorization|delivery/);
 assert.equal(f.calls.length,0);
 const authorization='Owner explicitly approved publishing this separately allowlisted article and account';
 f.state.records=[f.post({state:'PUBLISHED',releaseId:'123456789',releaseURL:'https://discord.com/channels/guild/'+target.channelId+'/123456789'})];
 f.state.onCreate=(receipt,args)=>{assert.deepEqual(receipt.delivery,{mode:'publish',authorization});assert(args.includes('--publish-now'));assert(args.includes('--confirm-user-approved'));};
 const [published]=await f.tick({delivery:'publish',publishAuthorization:authorization});assert.equal(published.status,'verified');assert(published.url.includes(target.channelId));
 await f.tick();assert.equal(f.state.creates,1);
});

test('Discord drafts verify their title in the full message when the provider has no title field',async t=>{
 const f=await fixture(t);f.state.records=[f.post({title:null,settings:JSON.stringify(f.packet.settings)})];
 const [saved]=await f.tick();assert.equal(saved.status,'draft_saved');assert.equal(saved.titleVerification,'body_prefix');assert.equal(saved.independentBodyReadback,true);assert.equal(saved.public,false);
 assert.equal(f.state.creates,1);await f.tick();assert.equal(f.state.creates,1);
 const adapter=postizAdapter(f.options),receipt={postId:'post-1',intendedAt:'2026-10-25T00:00:00Z',delivery:{mode:'draft'}};
 f.state.records=[f.post({title:'Wrong separate title',settings:JSON.stringify(f.packet.settings)})];await assert.rejects(adapter.readback(f.packet,receipt),/title/);
 f.state.records=[f.post({title:null,settings:JSON.stringify(f.packet.settings),content:f.packet.body.replace(f.packet.title,'Different title')})];await assert.rejects(adapter.readback(f.packet,receipt),/body/);
 const dev=await fixture(t,{platform:'devto',locale:'en',integrationId:'approved-devto-account',format:'article'});dev.state.records=[dev.post({title:null,settings:JSON.stringify({...dev.packet.settings,title:undefined})})];
 await assert.rejects(postizAdapter(dev.options).readback(dev.packet,receipt),/settings|title/);
});

test('unknown draft outcome survives mode changes and resolves by readback without resubmitting',async t=>{
 const f=await fixture(t);f.state.createError='Timeout after the draft write';
 const [unknown]=await f.tick();assert.equal(unknown.status,'unknown');assert.deepEqual(unknown.delivery,{mode:'draft'});assert.equal(f.state.creates,1);
 f.state.records=[f.post()];delete f.state.createError;
 const [saved]=await f.tick({delivery:'publish',publishAuthorization:'Authorize only future submissions for publication'});
 assert.equal(saved.status,'draft_saved');assert.equal(saved.error,undefined);assert.equal(saved.readbackError,undefined);assert.equal(f.state.creates,1);assert.equal(f.state.reads,2);assert.deepEqual(saved.delivery,{mode:'draft'});
 assert.equal(f.calls.at(-1)[0],'posts');
});

test('unknown publish intent is read in its original mode after policy changes to draft',async t=>{
 const f=await fixture(t);f.state.createError='Timeout after publish send';
 await f.tick({delivery:'publish',publishAuthorization:'Explicit publish permission'});
 f.state.records=[f.post({state:'PUBLISHED',releaseId:'123',releaseURL:'https://discord.com/channels/guild/'+target.channelId+'/123'})];
 const [published]=await f.tick();assert.equal(published.status,'verified');assert.equal(published.delivery.mode,'publish');assert.equal(f.state.creates,1);
});

test('legacy submitted and unknown receipts are never resubmitted under the new draft default',async t=>{
 const f=await fixture(t);
 for(const status of ['submitted','unknown']){
  await atomic(f.receiptFile,{id:f.packet.id,status,bodySha256:f.packet.bodySha256,intendedAt:'2026-10-20T00:00:00Z',...(status==='submitted'?{postId:'post-1'}:{})});
  const [pending]=await f.tick();assert.equal(pending.status,status);assert.deepEqual(pending.delivery,{mode:'publish',legacy:true});
 }
 assert.equal(f.state.creates,0);assert.equal(f.state.reads,2);
});

test('a draft with the wrong account, incomplete body, title, settings or publication evidence is not accepted',async t=>{
 const f=await fixture(t),adapter=postizAdapter(f.options),receipt={postId:'post-1',intendedAt:'2026-10-23T00:00:00Z',delivery:{mode:'draft'}};
 for(const changed of [
  {integration:{id:'unapproved-account'}},
  {content:f.packet.body.slice(0,-5)},
  {title:'Wrong title'},
  {settings:{...f.packet.settings,title:f.packet.title,channel:'another-channel'}},
  {settings:undefined},
 ]){f.state.records=[f.post(changed)];await assert.rejects(adapter.readback(f.packet,receipt),/account|body|title|settings/);}
 f.state.records=[f.post({releaseId:'unexpected-release'})];assert.equal((await adapter.readback(f.packet,receipt)).status,'needs_review');
 f.state.records=[f.post({state:'PUBLISHED'})];assert.equal((await adapter.readback(f.packet,receipt)).status,'needs_review');
 await assert.rejects(adapter.readback(f.packet,{...receipt,bodySha256:'different-frozen-body'}),/receipt body/);
 f.state.records=[f.post({id:undefined})];await assert.rejects(adapter.readback(f.packet,{...receipt,postId:undefined}),/identity/);
 f.state.records=[f.post(),f.post({id:'post-2'})];assert.equal((await adapter.readback(f.packet,{...receipt,postId:undefined})).status,'unknown');
 assert.equal(f.state.creates,0);
});

test('scope restrictions still apply to direct draft submits even if callers mark preflight complete',async t=>{
 const f=await fixture(t),adapter=postizAdapter(f.options);
 await assert.rejects(adapter.submit({...f.packet,source:{...f.packet.source,articleId:'outside-scope'}},{preflighted:true}),/outside/);
 await assert.rejects(adapter.submit({...f.packet,target:{...f.packet.target,integrationId:'outside-scope'}},{preflighted:true}),/outside/);
 await assert.rejects(adapter.submit(f.packet,{preflighted:true,delivery:{mode:'publish',authorization:'Untrusted call-site text'}}),/authorization/);
 assert.equal(f.calls.length,0);
});

test('cloud continuation is draft-bound and a fabricated marker cannot bypass its required local batch grant',async t=>{
 const f=await fixture(t);f.packet.cloudContinuation={version:1,jobId:'cloud-job',mode:'draft'};await atomic(join(f.directory,'outbox',f.packet.id+'.json'),f.packet);
 const options={delivery:'publish',publishAuthorization:'Separate authorization for ordinary packets only'};
 const [blocked]=await f.tick(options);assert.equal(blocked.status,'deferred');assert.equal(f.state.creates,0);assert.equal(f.calls.length,0);assert.equal(await optional(f.receiptFile),null);
 const adapter=postizAdapter({...f.options,...options});
 assert.deepEqual(adapter.deliveryFor(f.packet),{mode:'draft'});
 await assert.rejects(adapter.submit(f.packet,{preflighted:true}),/batch|gate|grant/i);
 await assert.rejects(adapter.submit(f.packet,{preflighted:true,delivery:adapter.delivery}),/cannot be promoted/);
 assert.throws(()=>adapter.deliveryFor({...f.packet,cloudContinuation:{mode:'publish'}}),/only.*draft/);
 assert.equal((await adapter.readback(f.packet,{postId:'post-1',delivery:{mode:'publish'}})).status,'needs_review');
});

test('a changed outbox body cannot reinterpret an existing receipt or cause another write',async t=>{
 const f=await fixture(t);f.state.createError='Timeout after send';await f.tick();const original=await readFile(f.receiptFile,'utf8');
 const changed={...f.packet,body:f.packet.body+'\nChanged content'};changed.bodySha256=hash(changed.body);await atomic(join(f.directory,'outbox',changed.id+'.json'),changed);
 const [blocked]=await f.tick();assert.equal(blocked.status,'needs_decision');assert.equal(f.state.creates,1);assert.equal(f.state.reads,1);assert.equal(await readFile(f.receiptFile,'utf8'),original);
});

test('watcher reports draft_saved as complete and not public, then stays idle',async t=>{
 const f=await fixture(t),controller=new AbortController(),outputs=[];let ticks=0,first,second;
 const firstTick=new Promise(resolve=>first=resolve),secondTick=new Promise(resolve=>second=resolve);
 t.mock.timers.enable({apis:['setTimeout']});
 const watching=watchPostiz({directory:f.directory,signal:controller.signal,emit:value=>{outputs.push(JSON.parse(value));first();},tick:async()=>{ticks++;if(ticks===2)second();return [{id:f.packet.id,status:'draft_saved',delivery:{mode:'draft'},url:'https://must-not-be-shown.example'}];}});
 try{
  await firstTick;await immediate();t.mock.timers.tick(1000);await secondTick;await immediate();t.mock.timers.tick(600000);await immediate();
  assert.equal(ticks,2,'only initial scan and startup catch-up are allowed');assert.equal(outputs.length,1);assert.deepEqual(outputs[0],[{id:f.packet.id,status:'draft_saved',delivery:'draft',complete:true,public:false}]);
 }finally{controller.abort();await watching;t.mock.timers.reset();}
});

const devtoTarget={platform:'devto',locale:'en',integrationId:'approved-devto-account',format:'article'};
const devtoRateFile=f=>join(f.directory,'rate',hash(['devto',devtoTarget.integrationId])+'.json');

test('DEV.to drafts ignore an existing publication cooldown and never extend it',async t=>{
 const f=await fixture(t,devtoTarget),rateFile=devtoRateFile(f),previous={id:'prior-publication',nextAt:460000};
 await atomic(rateFile,previous);const before=await readFile(rateFile,'utf8');f.state.records=[f.post()];
 const [saved]=await f.tick({now:()=>100000});assert.equal(saved.status,'draft_saved');assert.equal(f.state.creates,1);
 assert.equal(await readFile(rateFile,'utf8'),before,'a draft cannot change the public publication budget');
 assert(!f.calls.find(args=>args[0]==='create').includes('--publish-now'));
});

test('a DEV.to draft 429 or uncertain write keeps its original receipt without another create or a publication cooldown',async t=>{
 const f=await fixture(t,devtoTarget);f.state.createError='HTTP 429 after submission; preserve the original uncertain write';
 const [first]=await f.tick({now:()=>100000});assert.equal(first.status,'unknown');assert.match(first.error,/429/);assert.deepEqual(first.delivery,{mode:'draft'});
 await f.tick({now:()=>100001});assert.equal(f.state.creates,1);assert.equal(f.state.reads,2);assert.equal(await optional(devtoRateFile(f)),null);
 f.state.records=[f.post()];const [saved]=await f.tick({now:()=>100002});assert.equal(saved.status,'draft_saved');assert.equal(f.state.creates,1);assert.equal(await optional(devtoRateFile(f)),null);
});

test('an actual DEV.to publish intent reserves the shared cooldown even when its acknowledgement is lost',async t=>{
 const f=await fixture(t,devtoTarget),authorization='Owner explicitly approved this DEV.to publication';f.state.createError='Network timeout after publication send';
 await f.tick({delivery:'publish',publishAuthorization:authorization,now:()=>100000});
 assert.deepEqual(await optional(devtoRateFile(f)),{id:f.packet.id,nextAt:460000});
 const create=f.calls.find(args=>args[0]==='create');assert(create.includes('--publish-now'));assert(create.includes('--confirm-user-approved'));
 const adapter=postizAdapter({...f.options,delivery:'publish',publishAuthorization:authorization,now:()=>100001});
 await assert.rejects(adapter.preflight(f.packet),error=>error.retryAt===460000);
 await f.tick({delivery:'publish',publishAuthorization:authorization,now:()=>100001});assert.equal(f.state.creates,1);assert.equal(f.state.reads,2);
});
