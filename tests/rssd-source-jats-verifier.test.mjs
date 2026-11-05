import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {createJatsSourceVerifier} from '../scripts/rssd-source-jats-verifier.mjs';
import {verifyTaskSourceCandidates,createStoredSelectionVerifier,createStoredSourceAdapters} from '../scripts/rssd-source-verification.mjs';
import {freezeSourceSelection,bindSourceSelectionToClaim} from '../scripts/rssd-source-selection.mjs';
import {captureTaskSourceSnapshot} from '../scripts/rssd-source-snapshot.mjs';

const url='https://original.example.org/articles/PMC123.xml',license='https://creativecommons.org/licenses/by/4.0/';
const rule={url,idType:'pmcid',articleId:'PMC123',licenseUrls:[license],requiredSections:['methods','results'],minSectionCharacters:100};
const clock=()=>new Date('2026-11-03T00:00:00Z'),connection={origin:'https://center.example.org',orgId:'org',workerId:'worker'};
const demand={id:'example-demand',workspaceId:'metho',sectionId:'methods',kind:'write',title:'Study methods',brief:'Concise selected topic.',requiredLocales:['zh-CN'],source:null,priority:0};
const claim={id:demand.id,workspaceId:'metho',sectionId:'methods',orgId:'org',workerId:'worker',claimToken:'secret-token',generation:1,state:'claimed',payload:demand};
const client={origin:connection.origin,identity:async()=>({protocolVersion:1,orgId:'org',workerId:'worker',workspaceIds:['metho']}),activeClaim:async()=>claim};
const p='Original public research content. '.repeat(6);
const document=(id='PMC123',lic=license,sections=['methods','results'])=>`<article xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta><article-id pub-id-type="pmcid">${id}</article-id><permissions><license xlink:href="${lic}"/></permissions></article-meta></front><body>${sections.map(x=>`<sec sec-type="${x}"><title>${x}</title><p>${p}</p></sec>`).join('')}</body></article>`;

test('fixed source structure and license survive HTTP, versioned rule receipt, claim and snapshot',async t=>{
 const home=await mkdtemp(join(tmpdir(),'rssd-jats-'));t.after(()=>rm(home,{recursive:true,force:true}));let hits=0;const server=createServer((_q,res)=>{hits++;res.writeHead(200,{'content-type':'application/xml'});res.end(document());});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const local=`http://127.0.0.1:${server.address().port}/`,fetchPage=async target=>{const r=await fetch(local);return {reachable:r.ok,originalUrl:target,finalUrl:target,contentType:'application/xml',text:await r.text()};};
 const verifier=await createJatsSourceVerifier({rules:[rule],clock}),pin={id:verifier.id,version:verifier.version,codeSha256:verifier.codeSha256};
 const result=await verifyTaskSourceCandidates({home,connection,demand,candidates:[{title:'Paper',url}],verifier,trustedVerifierPin:pin,fetchPage,clock});assert.equal(result.status,'verified');assert.equal(hits,1);
 const verifySelection=createStoredSelectionVerifier({home,connection,demandId:demand.id,trustedVerifierPin:pin,expectedReceiptHash:result.receiptHash});const frozen=await freezeSourceSelection({home,connection,demand,verifiedSources:result.verifiedSources,verifySelection,clock});const bound=await bindSourceSelectionToClaim({home,connection,claim,client,verifySelection,clock});
 const job=join(home,'job');await mkdir(job,{mode:0o700});const adapters=createStoredSourceAdapters({home,connection,demandId:demand.id,trustedVerifierPin:pin,expectedReceiptHash:frozen.selection.verification.evidenceHash});const snapshot=await captureTaskSourceSnapshot({jobDirectory:job,binding:bound.binding,verifiedSources:bound.verifiedSources,...adapters,clock});assert.equal(snapshot.records[0].text,document());assert.equal(hits,1);
 const receiptPath=join(home,'source-verifications',protocol.hash([connection.origin,connection.orgId,connection.workerId,demand.id]),'receipt.json');const saved=JSON.parse(await readFile(receiptPath,'utf8'));assert.equal(saved.version,1);assert.equal(saved.records[0].assessment.verifier.codeSha256,pin.codeSha256);assert.equal(saved.records[0].assessment.evidenceDetails.licenseUrl,license);assert.deepEqual(saved.records[0].assessment.evidenceDetails.requiredSections,['methods','results']);assert(!JSON.stringify(frozen).includes('secret-token'));
 const restarted=await createJatsSourceVerifier({rules:[rule],clock});assert.equal(restarted.codeSha256,pin.codeSha256);assert.deepEqual(await verifyTaskSourceCandidates({home,connection,demand,candidates:[{title:'Paper',url}],verifier:restarted,trustedVerifierPin:pin,fetchPage:()=>assert.fail(),clock}),result);
 const changed=await createJatsSourceVerifier({rules:[{...rule,minSectionCharacters:101}],clock});const changedPin={id:changed.id,version:changed.version,codeSha256:changed.codeSha256};await assert.rejects(verifyTaskSourceCandidates({home,connection,demand,candidates:[{title:'Paper',url}],verifier:changed,trustedVerifierPin:changedPin,fetchPage:()=>assert.fail(),clock}),/cannot be replaced/);
});

test('successful HTTP and partial, mismatched or unlicensed source stay pending',async()=>{
 const verifier=await createJatsSourceVerifier({rules:[rule],clock});const assess=async(text,candidate=url)=>verifier.assess({candidate:{url:candidate},text,textSha256:'a'.repeat(64),contentType:'application/xml'});
 for(const value of [document('wrong'),document('PMC123','https://example.org/unknown'),document('PMC123',license,['methods']),'<article><abstract>'+p+'</abstract></article>','<!DOCTYPE article [<!ENTITY ext SYSTEM "file:///etc/passwd">]>'+document()])assert.equal((await assess(value)).coverage,'unknown');
 assert.equal((await assess(document(),'https://original.example.org/articles/other.xml')).coverage,'unknown');assert.equal((await assess(document())).coverage,'full_text');
 const altered=await createJatsSourceVerifier({rules:[{...rule,articleId:'PMC124'}],clock});assert.notEqual(altered.codeSha256,verifier.codeSha256);
});

test('NCBI article-set accepts only the exact inert DTD and explicit matching license reference',async()=>{
 const typed={...rule,requiredSectionTitles:['Introduction','Conclusion']};delete typed.requiredSections;const verifier=await createJatsSourceVerifier({rules:[typed],clock});
 const body=`<article xmlns:ali="http://www.niso.org/schemas/ali/1.0/"><front><article-meta><article-id pub-id-type="pmcid">PMC123</article-id><permissions><license><ali:license_ref content-type="ccbylicense">${license}</ali:license_ref></license></permissions></article-meta></front><body>${typed.requiredSectionTitles.map(x=>`<sec><title>${x}</title><p>${p}</p></sec>`).join('')}</body></article>`;
 const dtd='<!DOCTYPE pmc-articleset PUBLIC "-//NLM//DTD ARTICLE SET 2.0//EN" "https://dtd.nlm.nih.gov/ncbi/pmc/articleset/nlm-articleset-2.0.dtd">';const xml=`<?xml version="1.0"  ?>${dtd}<pmc-articleset>${body}</pmc-articleset>`;
 const assess=async text=>verifier.assess({candidate:{url},text,textSha256:'a'.repeat(64),contentType:'text/xml'});assert.equal((await assess(xml)).coverage,'full_text');
 for(const bad of [xml.replace(dtd,dtd.replace('https://dtd.nlm.nih.gov','https://attacker.example')),xml.replace(dtd,dtd.slice(0,-1)+' [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'),xml.replace(dtd,'<!DOCTYPE pmc-articleset [<!ENTITY x "expanded">]>'),xml.replace('</pmc-articleset>',body+'</pmc-articleset>'),xml.replace(license,'https://example.org/unknown'),xml.replace('<title>Conclusion</title>','<title>Abstract</title>'),xml.replace('<body>', '<body><?evil x?>')])assert.equal((await assess(bad)).coverage,'unknown');
});
