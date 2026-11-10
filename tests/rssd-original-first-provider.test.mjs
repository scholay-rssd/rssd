import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createOriginalFirstProvider} from '../scripts/rssd-original-first-provider.mjs';
import protocol from '../contracts/rssd-v1.cjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
const item={id:'one',url:'https://img.example/figure.png',sourceUrl:'https://source.example/article'};
const licenseUrl='https://creativecommons.org/licenses/by/4.0/';
const page=Buffer.from(`<figure><img src="${item.url}"><figcaption>Alice Example, CC BY 4.0 <a href="${licenseUrl}">License</a></figcaption></figure>`);
const scope={jobId:'job-1',blockId:'hero',requirement:'compare methods'};
const evidence={rightsVerified:true,thirdPartyExcluded:true,intendedUse:'commercial-web',sourceUrl:item.sourceUrl,imageUrl:item.url,evidenceUrl:item.sourceUrl,creator:'Alice Example',license:'CC BY 4.0',licenseUrl,quote:'Alice Example, CC BY 4.0',sourceSha256:sha(page),imageSha256:sha(png)};
async function fixture(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),'rssd-original-first-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls={registerStart:0,registerLookup:0,fallbackStart:0,fallbackLookup:0};
 const registrar={async start({manifest}){calls.registerStart++;return {status:'ready',assetId:'asset-1',taskId:'task-1',sha256:manifest.sha256};},async lookup(){calls.registerLookup++;return {status:'ready',assetId:'asset-1',taskId:'task-1',sha256:sha(png)};}};
 const fallback={async start(){calls.fallbackStart++;return {status:'pending'};},async lookup(){calls.fallbackLookup++;return {status:'ready',bytes:png,registration:{assetId:'generated-1',taskId:'task-2',sha256:sha(png)},provenance:{kind:'generated'}};}};
 const search=async()=>({complete:true,candidates:[item]});
 const approve=async({scopeHash,searchHash})=>({status:'approved',scopeHash,searchHash,reviewedBy:'verifier-v1',reviewedAt:'2026-11-02T00:00:00Z',candidateId:'one',evidence});
 const read=async url=>url===item.sourceUrl?page:url===item.url?png:assert.fail('unexpected URL');
 const args={directory:dir,search,review:approve,registrar,fallback,read,...options};
 return {dir,calls,registrar,fallback,provider:createOriginalFirstProvider(args),args};
}
const call={requestId:'image-123',scope};

test('search metadata is not license evidence and cannot trigger fallback or registration',async t=>{
 const x=await fixture(t,{review:async()=>({status:'approved'})});const result=await x.provider.start(call);
 assert.equal(result.status,'pending');assert.equal(x.calls.registerStart,0);assert.equal(x.calls.fallbackStart,0);
});

test('a verified original is rechecked against exact page and image bytes before registration',async t=>{
 const x=await fixture(t);const first=await x.provider.start(call);assert.equal(first.status,'ready');assert.deepEqual(first.bytes,png);assert.equal(first.provenance.kind,'licensed-source');assert.equal(first.provenance.licenseEvidence.sha256,sha(page));
 const second=await x.provider.lookup(call);assert.equal(second.status,'ready');assert.equal(x.calls.registerStart,1);assert.equal(x.calls.registerLookup,0);assert.equal(x.calls.fallbackStart,0);
 const state=JSON.parse(await readFile(join(x.dir,protocol.hash(call.requestId),'state.json'),'utf8'));assert.equal(state.phase,'ready');assert.equal(state.scopeHash,protocol.hash(scope));
});

test('changed source, unsupported license, or missing third-party rights stays pending',async t=>{
 for(const kind of ['changed','license','third-party']){
  const modify=e=>kind==='license'?{...e,licenseUrl:'https://creativecommons.org/licenses/by-nc/4.0/',license:'CC BY-NC 4.0'}:kind==='third-party'?{...e,thirdPartyExcluded:false}:e;
  const x=await fixture(t,{review:async({scopeHash,searchHash})=>({status:'approved',scopeHash,searchHash,reviewedBy:'verifier-v1',reviewedAt:'2026-11-02T00:00:00Z',candidateId:'one',evidence:modify(evidence)}),read:async url=>url===item.sourceUrl?(kind==='changed'?Buffer.from('changed'):page):png});
  assert.equal((await x.provider.start(call)).status,'pending');assert.equal(x.calls.registerStart,0);assert.equal(x.calls.fallbackStart,0);
 }
});

test('complete independent no-match review allows one generation then queries original identity',async t=>{
 const x=await fixture(t,{review:async({scopeHash,searchHash,candidates})=>({status:'none',scopeHash,searchHash,reviewedBy:'verifier-v1',reviewedAt:'2026-11-02T00:00:00Z',reason:'No candidate has verified reuse rights',reviewedCandidateIds:candidates.map(x=>x.id)})});
 assert.equal((await x.provider.start(call)).status,'pending');const recovered=await x.provider.lookup(call);assert.equal(recovered.status,'ready');assert.equal(recovered.provenance.kind,'generated');assert.equal(x.calls.fallbackStart,1);assert.equal(x.calls.fallbackLookup,1);
});

test('partial searches and incomplete review never trigger fallback',async t=>{
 const none=async({scopeHash,searchHash,candidates})=>({status:'none',scopeHash,searchHash,reviewedBy:'verifier-v1',reviewedAt:'2026-11-02T00:00:00Z',reason:'No match in available page',reviewedCandidateIds:candidates.map(x=>x.id)});
 const x=await fixture(t,{search:async()=>({complete:false,candidates:[item]}),review:none});assert.equal((await x.provider.start(call)).reason,'source_review_incomplete');assert.equal(x.calls.fallbackStart,0);
 const y=await fixture(t,{review:async({scopeHash,searchHash})=>({status:'none',scopeHash,searchHash,reviewedBy:'verifier-v1',reviewedAt:'2026-11-02T00:00:00Z',reason:'No match',reviewedCandidateIds:[]})});assert.equal((await y.provider.start(call)).reason,'source_review_incomplete');assert.equal(y.calls.fallbackStart,0);
 const z=await fixture(t,{search:async()=>({complete:false,candidates:[item]})});assert.equal((await z.provider.start(call)).status,'ready');assert.equal(z.calls.fallbackStart,0);
});

test('uncertain registration recovers by lookup and rejects reuse with changed slot',async t=>{
 let started=0,looked=0;const registrar={async start(){started++;throw Error('lost acknowledgement');},async lookup(){looked++;return {status:'ready',assetId:'asset-1',taskId:'task-1',sha256:sha(png)};}};
 const x=await fixture(t,{registrar});await assert.rejects(x.provider.start(call),/lost acknowledgement/);assert.equal((await x.provider.lookup(call)).status,'ready');assert.equal(started,1);assert.equal(looked,1);
 await assert.rejects(x.provider.lookup({...call,scope:{...scope,blockId:'other'}}),/scope differs/);
});

test('corrupted durable state stops recovery without generating or registering again',async t=>{
 const x=await fixture(t);assert.equal((await x.provider.start(call)).status,'ready');const file=join(x.dir,protocol.hash(call.requestId),'state.json'),state=JSON.parse(await readFile(file,'utf8'));state.evidence.license='tampered';await writeFile(file,JSON.stringify(state));
 await assert.rejects(x.provider.lookup(call),/integrity check failed/);assert.equal(x.calls.registerStart,1);assert.equal(x.calls.fallbackStart,0);
});
