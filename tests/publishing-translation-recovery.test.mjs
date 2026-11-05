import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles} from '../scripts/site-config.mjs';
import {atomic,optional,flowDirectory,configureFlow,enqueuePublished,flowStatus,todayTick,validateTranslation} from '../scripts/publishing-flow.mjs';
import {protectTranslationUrls,translateEdition} from '../scripts/publishing-flow-language.mjs';
import {retryTranslation} from '../scripts/publishing-flow-recovery.mjs';

const site={...profiles.find(s=>s.id==='enter'),languages:['zh-CN','en']};
const source={id:'source-recovery-test',title:'Source recovery',summary:'A source and an image.',markdown:'# Source recovery\n\nAn unchanged article with a [reference](https://example.org/study) and useful discussion.\n\n![Figure](https://example.org/figure.png)',date:'2026-10-23',category:site.columns[0],author:site.author,assets:[]};
const english={title:'Recovered edition',summary:'An accurate translation.',markdown:source.markdown.replace('# Source recovery','# Recovered edition'),provenance:{agentId:'cursor',attemptId:'original'}};
const readSource=async()=>({version:1,publishedVersion:1,data:source});
const options=root=>({root,site,readSource,translate:async()=>english,publishEdition:async()=>({status:'verified'}),fetcher:async()=>Response.json({version:1,links:{['/news/'+source.id+'/']:'https://enterscholar.com/t/-/12345'}})});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'translation-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));await configureFlow(root,site,{version:1,siteId:site.id,origin:site.origin,enabled:true,authorization:'Authorized continuation recovery',articleIds:[source.id],targets:[]});const {id}=await enqueuePublished({root,site,data:source,receipt:{revision:1,url:'/news/'+source.id+'/',publicReadback:true,job:{status:'success'}}});return {root,id,dir:join(flowDirectory(root),'jobs',id)};}

test('URL placeholders restore exact images, reference definitions, bare URLs and prefix-overlapping destinations',()=>{
 const links=Array.from({length:15},(_,i)=>`[Reference ${i}](https://example.org/${i})`).join('\n');
 const input={title:'Source',summary:'See https://example.org/summary',markdown:`# Source\n\n${links}\n\n![Figure](https://example.org/figure.png?large=1&crop=0)\n\n[Named][ref]\n\n[ref]: https://example.org/reference\n\nhttps://example.org/1/longer`};
 const protectedUrls=protectTranslationUrls(input);
 assert(!protectedUrls.source.markdown.includes('https://example.org/'));
 const restored=protectedUrls.restore({...protectedUrls.source,provenance:{attemptId:'retained'}});
 assert.deepEqual(restored,{...input,provenance:{attemptId:'retained'}});
 assert.doesNotThrow(()=>validateTranslation(input,restored));
 assert.equal(input.markdown.includes('scholay-translation.invalid'),false);
});

test('a model cannot silently drop a protected image or publish an invented placeholder',()=>{
 const protectedUrls=protectTranslationUrls(source),image=protectedUrls.replacements.find(x=>x.url.endsWith('.png'));
 assert.throws(()=>protectedUrls.restore({...protectedUrls.source,markdown:protectedUrls.source.markdown.replace(image.placeholder,'https://wrong.example/image.png')}),{code:'FLOW_LANGUAGE_URLS'});
 assert.throws(()=>protectedUrls.restore({...protectedUrls.source,markdown:protectedUrls.source.markdown+'\nhttps://scholay-translation.invalid/unknown/'}),{code:'FLOW_LANGUAGE_URLS'});
});

test('literal template braces and their Markdown encoding pass the same URL check without losing query parameters or fragments',()=>{
 const url='https://api.example.org/{entityType}/items?filter=a%2Fb&scope=x#section',input={title:'API source',summary:'Original reference.',markdown:`# API source\n\nThe API reference: [documentation](${url})\n\n![Example](https://example.org/{size}/image.png?scale=2#preview)`};
 const translated={...input,title:'API translation',summary:'An accurate translated summary.'};
 assert.doesNotThrow(()=>validateTranslation(input,translated));
 assert.doesNotThrow(()=>validateTranslation(input,{...translated,markdown:translated.markdown.replaceAll('{entityType}','%7BentityType%7D').replaceAll('{size}','%7Bsize%7D')}));
 for(const change of [s=>s.replace('filter=a%2Fb','filter=a/b'),s=>s.replace('&scope=x',''),s=>s.replace('#section','#other')])assert.throws(()=>validateTranslation(input,{...translated,markdown:change(translated.markdown)}),/lost a source or image URL/);
});

test('translation writes a restored checkpoint and retains the private placeholder map',async t=>{
 const f=await fixture(t),previous=process.env.SCHOLAY_PUBLISHING_LANGUAGE_LOCK;process.env.SCHOLAY_PUBLISHING_LANGUAGE_LOCK=join(f.root,'language.lock');
 t.after(()=>{if(previous===undefined)delete process.env.SCHOLAY_PUBLISHING_LANGUAGE_LOCK;else process.env.SCHOLAY_PUBLISHING_LANGUAGE_LOCK=previous;});
 const agent=`const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);let result={protocolVersion:1};if(r.method==='session/new')result={sessionId:'fixture',models:{currentModelId:'existing-model'}};if(r.method==='session/prompt'){const p=r.params.prompt[0].text;const article=JSON.parse(p.slice(p.indexOf('SOURCE DATA:\\n')+13));process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(article)}}}})+'\\n');}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`;
 const registry={launch:async()=>({command:process.execPath,args:['-e',agent],env:{}})},[{plan}]=await flowStatus(f.root);
 const edition=await translateEdition(source,{root:f.root,plan},{registry,timeoutMs:1000});
 assert.equal(edition.markdown,source.markdown);
 const checkpoint=await optional(join(f.dir,'translation-result.json'));assert.equal(checkpoint.sourceSha256,plan.sha256);assert.equal(checkpoint.edition.provenance.modelId,'existing-model');
 assert(!JSON.stringify(checkpoint).includes('scholay-translation.invalid'));
 const map=await optional(join(f.dir,'language-attempts',edition.provenance.attemptId,'url-protection.json'));assert.equal(map.replacements.length,2);
});

test('one substituted reference is repaired from the frozen source without another AI call or a new flow',async t=>{
 const f=await fixture(t);let calls=0,publications=0;
 await todayTick({...options(f.root),translate:async()=>{calls++;return {...english,markdown:english.markdown.replace('https://example.org/study','https://wrong.example/reference')};},publishEdition:async()=>assert.fail()});
 const prior=(await flowStatus(f.root))[0].state;assert.equal(prior.status,'needs_review');const candidateBefore=await readFile(prior.translation.candidatePath,'utf8');
 const result=await retryTranslation({...f,site,readSource});assert.equal(result.status,'recovered');assert.equal(result.repairedDestinations.length,1);
 await todayTick({...options(f.root),translate:async()=>assert.fail('Reuse repaired candidate'),publishEdition:async()=>{publications++;return {status:'verified'};}});
 const [{state}]=await flowStatus(f.root);assert.equal(state.complete,true);assert.equal(state.edition.provenance.attemptId,'original');assert.equal(calls,1);assert.equal(publications,1);
 assert.equal(await readFile(prior.translation.candidatePath,'utf8'),candidateBefore);
 assert.deepEqual(state.chinese,prior.chinese);assert.deepEqual(state.community,prior.community);
 assert.equal((await retryTranslation({...f,site,readSource})).requeued,false);assert.equal((await flowStatus(f.root)).length,1);
});

test('an omitted image is retained for review and retried once from source instead of consuming the rejected checkpoint',async t=>{
 const f=await fixture(t),[{plan}]=await flowStatus(f.root),bad={...english,markdown:english.markdown.replace(/!\[Figure\]\([^\n]+\)/,'')};
 await atomic(join(f.dir,'translation-result.json'),{planId:plan.id,sourceSha256:plan.sha256,edition:bad});
 await atomic(join(f.dir,'state.json'),{status:'needs_review',error:'Translation lost a source or image URL',translation:{status:'failed',attempts:1}});
 const result=await retryTranslation({...f,site,readSource});assert.equal(result.status,'queued');assert.equal(result.modelCalls,0);assert.equal(await optional(join(f.dir,'translation-result.json')),null);
 const archived=await readdir(join(f.dir,'translation-rejected'));assert.equal(archived.length,1);assert.deepEqual((await optional(join(f.dir,'translation-rejected',archived[0]))).edition,bad);
 let calls=0;await todayTick({...options(f.root),translate:async()=>{calls++;return english;}});await todayTick({...options(f.root),translate:async()=>assert.fail()});
 assert.equal(calls,1);assert.equal((await flowStatus(f.root))[0].state.complete,true);
});

test('reviewed candidate clears needs_review and resumes without resubmitting an existing English intent',async t=>{
 const f=await fixture(t);await atomic(join(f.dir,'state.json'),{status:'needs_review',retryAt:Date.now()+999999,error:'Previous QA failed',translation:{status:'failed'}});
 await retryTranslation({...f,site,readSource,edition:english});const state=(await flowStatus(f.root))[0].state;assert.equal(state.status,'waiting');assert.equal(state.translation.reviewed,true);assert.equal(state.error,undefined);
 await atomic(join(f.dir,'website-en.json'),{status:'unknown',request:{requestKey:'original-english-request'}});
 await assert.rejects(retryTranslation({...f,site,readSource,edition:{...english,title:'Changed edition'}}),/durable request/);
 const receipt=await optional(join(f.dir,'website-en.json'));assert.equal(receipt.request.requestKey,'original-english-request');
});

test('a retained provider response with literal template URL braces recovers without a second AI call',async t=>{
 const f=await fixture(t),[{plan}]=await flowStatus(f.root),url='https://api.example.org/{entityType}/items?filter=a%2Fb&scope=x#section';
 const original={...source,markdown:source.markdown.replace('https://example.org/study',url)},candidate={...english,markdown:english.markdown.replace('https://example.org/study',url)};
 const {sourceContentSha256}=await import('../contracts/language-editions.mjs');const updated={...plan,source:original,sha256:sourceContentSha256(original)};
 await atomic(join(f.dir,'plan.json'),updated);await atomic(join(f.dir,'translation-result.json'),{planId:plan.id,sourceSha256:updated.sha256,edition:candidate});
 await atomic(join(f.dir,'state.json'),{status:'needs_review',translation:{status:'failed',attempts:1,error:'Translation lost a source or image URL'},error:'Translation lost a source or image URL'});
 const read=async()=>({version:1,publishedVersion:1,data:original});
 const result=await retryTranslation({...f,site,readSource:read});assert.equal(result.status,'recovered');assert.equal(result.modelCalls,0);assert.deepEqual(result.repairedDestinations,[]);
 await todayTick({...options(f.root),readSource:read,translate:async()=>assert.fail('The original translation is valid')});
 const [{state}]=await flowStatus(f.root);assert.equal(state.complete,true);assert.equal(state.edition.markdown,candidate.markdown);assert.equal(state.translation.error,undefined);
});

test('translation recovery refuses a changed Chinese revision and leaves all state untouched',async t=>{
 const f=await fixture(t);await atomic(join(f.dir,'state.json'),{status:'needs_review',translation:{status:'failed'},dispatch:{existing:{status:'ready'}}});const before=await readFile(join(f.dir,'state.json'),'utf8');
 await assert.rejects(retryTranslation({...f,site,readSource:async()=>({version:2,publishedVersion:2,data:source})}),/Source changed/);
 assert.equal(await readFile(join(f.dir,'state.json'),'utf8'),before);
});
