import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {verifyTaskSourceCandidates,createStoredSelectionVerifier,createStoredSourceAdapters} from '../scripts/rssd-source-verification.mjs';
import {freezeSourceSelection,bindSourceSelectionToClaim} from '../scripts/rssd-source-selection.mjs';
import {captureTaskSourceSnapshot,verifyEditionSourceSnapshot} from '../scripts/rssd-source-snapshot.mjs';

const connection={origin:'https://center.example.org',orgId:'org',workerId:'worker'};
const demand={id:'demand-one',workspaceId:'metho',sectionId:'methods',kind:'write',title:'Research method',brief:'PRIVATE_BRIEF_MARKER',requiredLocales:['zh-CN'],source:null,priority:0};
const url='https://source.example.org/full',candidates=[{title:'Original paper',url}],token='private-claim-token';
const quote='The original methods and findings are visible in this document.';
const text='<html><article><p>'+quote+'</p><p>'+('Methods and data. '.repeat(30))+'</p></article></html>';
const pin={id:'fixture-verifier',version:'1',codeSha256:'a'.repeat(64)},clock=()=>new Date('2026-11-02T12:00:00Z');
const verifier={...pin,assess:async({candidate,textSha256})=>({sourceUrl:candidate.url,observedTextSha256:textSha256,verifier:pin,coverage:'full_text',access:'public',readable:true,primarySource:true,reason:'Original complete article body was examined.',evidenceQuote:quote,assessedAt:clock().toISOString()})};
const claim={id:demand.id,workspaceId:demand.workspaceId,sectionId:demand.sectionId,orgId:'org',workerId:'worker',claimToken:token,generation:4,state:'claimed',payload:{...demand,policy:{targets:[]}}};
const client={origin:connection.origin,identity:async()=>({protocolVersion:1,orgId:'org',workerId:'worker',workspaceIds:['metho']}),activeClaim:async()=>structuredClone(claim)};
async function fixture(fn){const home=await mkdtemp(join(tmpdir(),'rssd-source-proof-'));let hits=0;const server=createServer((_req,res)=>{hits++;res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(text);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const local='http://127.0.0.1:'+server.address().port+'/paper';const fetchPage=async target=>{const res=await fetch(local);return {reachable:res.ok,originalUrl:target,finalUrl:target,contentType:'text/html',text:await res.text()};};try{return await fn({home,fetchPage,hits:()=>hits});}finally{await new Promise(resolve=>server.close(resolve));await rm(home,{recursive:true,force:true});}}
const args=(home,fetchPage)=>({home,connection,demand,candidates,verifier,trustedVerifierPin:pin,fetchPage,clock});

test('real synthetic HTTP response, independent verifier, claim binding and source output survive restart without exposing text or token',()=>fixture(async({home,fetchPage,hits})=>{
 const first=await verifyTaskSourceCandidates(args(home,fetchPage));assert.equal(first.status,'verified');assert.equal(hits(),1);assert.doesNotMatch(JSON.stringify(first),/PRIVATE_BRIEF_MARKER|private-claim-token|Actual complete methods/);
 const verifySelection=createStoredSelectionVerifier({home,connection,demandId:demand.id,trustedVerifierPin:pin,expectedReceiptHash:first.receiptHash});
 const selection=await freezeSourceSelection({home,connection,demand,verifiedSources:first.verifiedSources,verifySelection,clock});
 const binding=await bindSourceSelectionToClaim({home,connection,claim,client,verifySelection,clock});
 const selectionText=await readFile(join(home,'source-selections',protocol.hash(demand.id)+'.json'),'utf8');assert.doesNotMatch(selectionText,/PRIVATE_BRIEF_MARKER|private-claim-token|Actual complete methods/);
 const job=join(home,'job');await (await import('node:fs/promises')).mkdir(job,{mode:0o700});const adapters=createStoredSourceAdapters({home,connection,demandId:demand.id,trustedVerifierPin:pin,expectedReceiptHash:selection.selection.verification.evidenceHash});
 const snapshot=await captureTaskSourceSnapshot({jobDirectory:job,binding:binding.binding,verifiedSources:binding.verifiedSources,...adapters,clock});assert.equal(snapshot.records[0].text,text);
 const edition={bodyMarkdown:`Finding ([paper](${url})).\n\n### 参考文献\n\n- [Paper](${url})`,sources:[{title:'Paper',url}],metadata:{notebook:{sources:[{id:'s1',title:'Paper',url}],blocks:[{id:'b',type:'paragraph',text:`Finding ([paper](${url})).`,sourceIds:['s1']}]}}};assert.equal(verifyEditionSourceSnapshot({edition,snapshot}).ok,true);
 const again=await verifyTaskSourceCandidates({...args(home,async()=>{throw Error('no fetch after restart');}),verifier:{...pin,assess:async()=>{throw Error('no reassessment');}}});assert.deepEqual(again,first);assert.equal(hits(),1);
 assert.deepEqual(await bindSourceSelectionToClaim({home,connection,claim,client,verifySelection,clock}),binding);
}));

test('HTTP 200 or model-supplied hash alone cannot establish complete source access',()=>fixture(async({home,fetchPage})=>{
 const abstractVerifier={...pin,assess:async({candidate,textSha256})=>({sourceUrl:candidate.url,observedTextSha256:textSha256,verifier:pin,coverage:'abstract_only',access:'public',readable:true,primarySource:true,reason:'Only abstract is available.',evidenceQuote:quote,assessedAt:clock().toISOString()})};
 const partial=await verifyTaskSourceCandidates({...args(home,fetchPage),verifier:abstractVerifier});assert.equal(partial.status,'pending');assert.deepEqual(partial.verifiedSources,[]);assert.equal(partial.coverage[0].coverage,'abstract_only');
 const verifySelection=createStoredSelectionVerifier({home,connection,demandId:demand.id,trustedVerifierPin:pin,expectedReceiptHash:partial.receiptHash});await assert.rejects(verifySelection({demandId:demand.id,workspaceId:'metho',sectionId:'methods',demandHash:protocol.hash(protocol.demand(demand)),sourceSetHash:'a'.repeat(64),verifiedSources:[]}));
}));

test('forged verifier hash, unsupported evidence or mismatched configured verifier never creates a complete receipt',()=>fixture(async({home,fetchPage})=>{
 await assert.rejects(verifyTaskSourceCandidates({...args(home,fetchPage),trustedVerifierPin:{...pin,codeSha256:'b'.repeat(64)}}),/identity differs/);
 const forged={...pin,assess:async({candidate})=>({sourceUrl:candidate.url,observedTextSha256:'b'.repeat(64),verifier:pin,coverage:'full_text',access:'public',readable:true,primarySource:true,reason:'unsupported',evidenceQuote:quote,assessedAt:clock().toISOString()})};
 await assert.rejects(verifyTaskSourceCandidates({...args(home,fetchPage),verifier:forged}),/bound access evidence/);
 const badQuote={...pin,assess:async({candidate,textSha256})=>({sourceUrl:candidate.url,observedTextSha256:textSha256,verifier:pin,coverage:'full_text',access:'public',readable:true,primarySource:true,reason:'unsupported',evidenceQuote:'This sentence does not appear in the original page.',assessedAt:clock().toISOString()})};
 await assert.rejects(verifyTaskSourceCandidates({...args(home,fetchPage),verifier:badQuote}),/quote is not present/);
}));

test('tampered response or missing receipt stops original selection and recovery',()=>fixture(async({home,fetchPage})=>{
 const result=await verifyTaskSourceCandidates(args(home,fetchPage)),verifySelection=createStoredSelectionVerifier({home,connection,demandId:demand.id,trustedVerifierPin:pin,expectedReceiptHash:result.receiptHash});
 await freezeSourceSelection({home,connection,demand,verifiedSources:result.verifiedSources,verifySelection,clock});
 const dir=join(home,'source-verifications',protocol.hash([connection.origin,connection.orgId,connection.workerId,demand.id])),file=join(dir,protocol.hash(url)+'.response.json');const response=JSON.parse(await readFile(file,'utf8'));response.text+='tampered';const {recordHash,...body}=response;response.recordHash=protocol.hash(body);await writeFile(file,JSON.stringify(response),{mode:0o600});
 await assert.rejects(bindSourceSelectionToClaim({home,connection,claim,client,verifySelection,clock}),/receipt is unavailable/);
 await assert.rejects(verifyTaskSourceCandidates(args(home,fetchPage)),/changed/);
 await rm(join(dir,'receipt.json'));await assert.rejects(verifySelection({demandId:demand.id,workspaceId:'metho',sectionId:'methods',demandHash:protocol.hash(protocol.demand(demand)),sourceSetHash:result.sourceSetHash,verifiedSources:result.verifiedSources}),/receipt is missing/);
}));
