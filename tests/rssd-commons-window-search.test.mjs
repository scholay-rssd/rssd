import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommonsWindowSearch,createCommonsFallbackSearch} from '../scripts/rssd-commons-window-search.mjs';
const scope={jobId:'job',blockId:'hero',imageSearchQuery:'research notebook',commonsSearchWindow:{provider:'wikimedia-commons',maxPages:2,pageSize:5}};
const row=(n,mime='image/png')=>({pageid:n,ns:6,imageinfo:[{url:`https://upload.wikimedia.org/wikipedia/commons/${n}.png`,descriptionurl:`https://commons.wikimedia.org/wiki/File:${n}.png`,mime}]});
const json=x=>Buffer.from(JSON.stringify(x));

test('two-page window carries exact query, page bounds and continuation; no rights data is trusted',async()=>{
 const calls=[];const search=createCommonsWindowSearch({retries:0,read:async href=>{const u=new URL(href);calls.push(u);return calls.length===1?json({continue:{continue:'gsroffset||',gsroffset:5},query:{pages:[{...row(1),license:'invented'},row(2,'video/webm'),row(3,'image/svg+xml')]}}):json({continue:{continue:'gsroffset||',gsroffset:10},query:{pages:[row(4)]}});}});
 const result=await search({scope});assert.equal(result.complete,true);assert.deepEqual(result.candidates.map(x=>x.id),['commons:1','commons:4']);assert.deepEqual(Object.keys(result.candidates[0]).sort(),['id','sourceUrl','url']);
 assert.equal(calls[0].searchParams.get('gsrsearch'),scope.imageSearchQuery);assert.equal(calls[0].searchParams.get('gsrlimit'),'5');assert.equal(calls[1].searchParams.get('gsroffset'),'5');
 assert.equal(result.coverage.stop,'window_limit');assert.equal(result.coverage.exhausted,false);assert.deepEqual(result.coverage.continuation,{gsroffset:10,continue:'gsroffset||'});assert.equal(result.coverage.excludedNonImage,2);assert.equal(result.coverage.meaning,'configured_window_only');
});

test('explicit API exhaustion, duplicate and malformed candidate counts are retained',async()=>{
 const search=createCommonsWindowSearch({read:async()=>json({batchcomplete:true,query:{pages:[row(1),row(1),{...row(3),ns:0}]}})});
 const result=await search({scope});assert.equal(result.coverage.stop,'api_exhausted');assert.equal(result.coverage.continuation,null);assert.equal(result.coverage.duplicates,1);assert.equal(result.coverage.excludedInvalid,1);assert.equal(result.candidates.length,1);
 const noResults=createCommonsWindowSearch({read:async()=>json({batchcomplete:true})});assert.deepEqual((await noResults({scope})).candidates,[]);
});

test('failed or malformed API response stays failed; retries are bounded',async()=>{
 let attempts=0;const search=createCommonsWindowSearch({retries:1,timeoutMs:100,read:async()=>{attempts++;throw Error('offline');}});
 await assert.rejects(search({scope}),/unavailable/);assert.equal(attempts,2);
 for(const body of [{error:{code:'rate-limited'}},{query:{}},{query:{pages:[]},continue:{other:'unsupported'}},{not:'api'}]){
  await assert.rejects(createCommonsWindowSearch({read:async()=>json(body)})({scope}));
 }
 await assert.rejects(search({scope:{...scope,commonsSearchWindow:{...scope.commonsSearchWindow,maxPages:50}}}),/bounded/);
});

test('stalled read has bounded retries and partial search never succeeds',async()=>{
 let attempts=0;const search=createCommonsWindowSearch({timeoutMs:100,retries:1,read:async()=>{attempts++;return await new Promise(()=>{});}});
 await assert.rejects(search({scope}),/unavailable/);assert.equal(attempts,2);
});

test('fallback after unavailable primary preserves window metadata; incomplete stays pending',async()=>{
 const commons=createCommonsWindowSearch({read:async()=>json({batchcomplete:true,query:{pages:[row(1)]}})});
 for(const primary of [async()=>{throw Error('timeout');}]){
  const search=createCommonsFallbackSearch({primary,commons});const result=await search({scope});assert.equal(result.coverage.selected,'commons');assert.ok(['incomplete','unavailable'].includes(result.coverage.primary.status));assert.equal(result.coverage.commons.meaning,'configured_window_only');
 }
 const incomplete=await createCommonsFallbackSearch({primary:async()=>({complete:false,candidates:[]}),commons:async()=>assert.fail('incomplete primary cannot fall back')})({scope});assert.equal(incomplete.complete,false);
 const primaryResult={complete:true,candidates:[],coverage:{provider:'primary',pages:1}};
 const result=await createCommonsFallbackSearch({primary:async()=>primaryResult,commons:async()=>assert.fail('should not fall back')})({scope});assert.equal(result.coverage.selected,'primary');
});
