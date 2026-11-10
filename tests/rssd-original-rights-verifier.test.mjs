import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {createOriginalFirstProvider} from '../scripts/rssd-original-first-provider.mjs';
import {createAutomaticRightsVerifier,createBoundOriginalSearch,rightsDeclaration} from '../scripts/rssd-original-rights-verifier.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
const item={id:'one',url:'https://images.example/p.png',sourceUrl:'https://publisher.example/record/1'};
const scope={jobId:'job-1',blockId:'cover',imageSearchQuery:'research notebook'};
const license='https://creativecommons.org/licenses/by/4.0/';
function page(changes={}){
 const entry={'@context':'https://schema.org','@type':'ImageObject',contentUrl:item.url,creator:{'@type':'Person',name:'Alice'},copyrightHolder:{'@type':'Organization',name:'Example Publisher'},license,description:rightsDeclaration('Example Publisher','Alice',item.url,license),...changes};
 return Buffer.from(`<script type="application/ld+json">${JSON.stringify(entry)}</script>`);
}
const trustedSources=[{origin:'https://publisher.example',holders:['Example Publisher']}];
const fixed=()=>new Date('2026-11-03T00:00:00Z');
function params(candidates=[item]){return {scope,scopeHash:protocol.hash(scope),candidates,searchHash:protocol.hash(candidates)};}
function verifier(source=page(),extra={}){return createAutomaticRightsVerifier({trustedSources,now:fixed,read:async url=>url===item.sourceUrl?source:png,...extra});}

test('automatic verifier binds query, exact source and image bytes and explicit first-party rights',async()=>{
 const result=await verifier()(params());assert.equal(result.status,'approved');assert.equal(result.evidence.creator,'Alice');assert.equal(result.evidence.sourceSha256,sha(page()));assert.equal(result.evidence.imageSha256,sha(png));assert.equal(result.evidence.thirdPartyExcluded,true);
 const altered={...params(),scopeHash:protocol.hash({...scope,imageSearchQuery:'other'})};await assert.rejects(verifier()(altered),/binding/);
 await assert.rejects(verifier()({...params(),searchHash:protocol.hash([])}),/binding/);
});

test('a declared license, search metadata or incomplete third-party rights are not approval',async()=>{
 const versions=[page({description:'License CC BY 4.0'}),page({creator:undefined}),page({contentUrl:'https://images.example/other.png'}),page({license:'https://creativecommons.org/licenses/by-nc/4.0/'}),page({copyrightHolder:{'@type':'Organization',name:'Untrusted'}}),Buffer.from('CC BY 4.0 Alice')];
 for(const source of versions){const result=await verifier(source)(params());assert.equal(result.status,'none');assert.equal(result.outcomes[0].status,'unverified');}
 const outsider={...item,sourceUrl:'https://other.example/image'};const result=await verifier()(params([outsider]));assert.equal(result.status,'none');assert.equal(result.outcomes[0].reason,'source_not_configured_as_rights_holder');
});

test('source and image read failures leave checks pending, even with other unverified candidates',async()=>{
 for(const failed of [item.sourceUrl,item.url]){
  const review=verifier(page(),{read:async url=>{if(url===failed)throw Error('offline');return url===item.sourceUrl?page():png;}});
  const result=await review(params([item,{...item,id:'other',sourceUrl:'https://other.example/record'}]));assert.equal(result.status,'pending');assert.equal(result.outcomes[0].status,'pending');
 }
});

test('invalid image bytes remain an unverified candidate, never an approved original',async()=>{
 const review=verifier(page(),{read:async url=>url===item.sourceUrl?page():Buffer.from('not an image')});
 const result=await review(params());assert.equal(result.status,'none');assert.equal(result.outcomes[0].reason,'image_bytes_invalid');
});

test('bound search uses the frozen query, and rejects missing query',async()=>{
 let seen;const search=createBoundOriginalSearch(async input=>{seen=input.query;return {complete:true,candidates:[]};});
 assert.equal((await search({scope})).complete,true);assert.equal(seen,'research notebook');await assert.rejects(search({scope:{}}),/imageSearchQuery/);
});

test('integration: full unverified search triggers fallback once; partial or failed search remains pending',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-rights-auto-'));t.after(()=>rm(dir,{recursive:true,force:true}));let generated=0,registered=0;
 const fallback={async start(){generated++;return {status:'pending'};},async lookup(){return {status:'pending'};}};
 const registrar={async start({manifest}){registered++;return {status:'ready',assetId:'asset',taskId:'task',sha256:manifest.sha256};},async lookup(){throw Error('unexpected');}};
 function provider(name,complete,review){return createOriginalFirstProvider({directory:join(dir,name),search:createBoundOriginalSearch(async()=>({complete,candidates:[item]})),review,registrar,fallback,read:async url=>url===item.sourceUrl?page():png});}
 const request={requestId:'request-1',scope};const approved=provider('approved',true,verifier());assert.equal((await approved.start(request)).status,'ready');assert.equal(registered,1);assert.equal(generated,0);
 const rejected=provider('rejected',true,verifier(page({description:'rights unknown'})));assert.equal((await rejected.start(request)).status,'pending');assert.equal(generated,1);await rejected.lookup(request);assert.equal(generated,1);
 const partial=provider('partial',false,verifier());assert.equal((await partial.start(request)).reason,'source_search_unavailable');assert.equal(registered,1);assert.equal(generated,1);
 const unavailable=provider('unavailable',true,verifier(page(),{read:async()=>{throw Error('offline');}}));assert.equal((await unavailable.start(request)).status,'pending');assert.equal(generated,1);
});
