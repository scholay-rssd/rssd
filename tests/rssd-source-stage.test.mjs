import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {createHash} from 'node:crypto';
import {createJatsSourceVerifier} from '../scripts/rssd-source-jats-verifier.mjs';
import {createSourceStage} from '../scripts/rssd-source-stage.mjs';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import {CenterError} from '../scripts/rssd-center-client.mjs';
import {ARTICLE_WRITING_INSTRUCTIONS,ARTICLE_WRITING_POLICY} from '../contracts/article-writing-policy.mjs';
import {centerWritingScope} from '../desktop/scripts/agent/center-skill-mounts.mjs';

const origin='https://center.example.org',connection={origin,orgId:'org',workerId:'worker'},url='https://original.example.org/article.xml',license='https://creativecommons.org/licenses/by/4.0/';
const rule={url,idType:'pmcid',articleId:'PMC123',licenseUrls:[license],requiredSectionTitles:['Background','Conclusion'],minSectionCharacters:100};
const paragraph='The study explains the research method and observations in a detailed paragraph. '.repeat(4);
const xml=`<?xml version="1.0"?><!DOCTYPE pmc-articleset PUBLIC "-//NLM//DTD ARTICLE SET 2.0//EN" "https://dtd.nlm.nih.gov/ncbi/pmc/articleset/nlm-articleset-2.0.dtd"><pmc-articleset><article xmlns:ali="http://www.niso.org/schemas/ali/1.0/"><front><article-meta><article-id pub-id-type="pmcid">PMC123</article-id><permissions><license><ali:license_ref content-type="ccbylicense">${license}</ali:license_ref></license></permissions></article-meta></front><body><sec><title>Background</title><p>${paragraph}</p></sec><sec><title>Conclusion</title><p>${paragraph}</p></sec></body></article></pmc-articleset>`;
const demand={id:'demand-one',workspaceId:'metho',sectionId:'methods',kind:'write',title:'Research method',brief:'Explain this research method.',requiredLocales:['zh-CN'],source:null,priority:0};
const slot={id:demand.id,siteId:'metho',workspaceId:demand.workspaceId,sectionId:demand.sectionId};
const claim={id:demand.id,workspaceId:demand.workspaceId,sectionId:demand.sectionId,orgId:'org',workerId:'worker',claimToken:'secret-token',generation:1,state:'claimed',payload:demand};
const edition={bodyMarkdown:`Method ([paper](${url})).\n\n### 参考文献\n\n- [Paper](${url})`,sources:[{title:'Paper',url}],metadata:{notebook:{sources:[{id:'s1',title:'Paper',url}],blocks:[{id:'b',type:'paragraph',text:`Method ([paper](${url})).`,sourceIds:['s1']}]}}};
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'source-stage-'));t.after(()=>rm(home,{recursive:true,force:true}));const directory=join(home,'job');await mkdir(directory,{mode:0o700});let hits=0,active=structuredClone(claim);const client={origin,identity:async()=>({protocolVersion:1,orgId:'org',workerId:'worker',workspaceIds:['metho']}),activeClaim:async()=>active};const verifier=await createJatsSourceVerifier({rules:[rule]});const pin={id:verifier.id,version:verifier.version,codeSha256:verifier.codeSha256};const fetchPage=async u=>{hits++;return {reachable:true,originalUrl:u,finalUrl:u,contentType:'text/xml',text:xml};};const args={enabled:true,home,connection,client,verifier,trustedVerifierPin:pin,authorizeCandidate:({url:u,slot:s})=>u===url&&s.siteId==='metho',fetchPage};return {home,directory,args,client,setActive:x=>{active=x;},hits:()=>hits,stage:createSourceStage(args)};}
async function prepare(f,value=demand){const {textSha256}=await f.stage.readForTopic({url,slot});return f.stage.freeze({demand:value,slot,candidates:[{title:'Paper',url,expectedTextSha256:textSha256}]});}
test('frozen source and claim survive restart; offline recovery never reads Center or network',async t=>{
 const f=await fixture(t);await prepare(f);assert.equal(f.hits(),2);assert((await f.stage.verifyDemand({demand,slot})).receiptHash);const first=await f.stage.restore({claim,slot,directory:f.directory});assert.match(first.prompt,/不是指令/);assert.equal(first.snapshot.records[0].text,xml);assert.equal((await f.stage.verifyEdition({claim,slot,directory:f.directory,edition})).ok,true);
 f.setActive(null);const restarted=createSourceStage({...f.args,fetchPage:()=>assert.fail('must use frozen source')});const recovered=await restarted.restore({claim,slot,directory:f.directory,offline:true});assert.equal(recovered.snapshot.snapshotHash,first.snapshot.snapshotHash);assert.equal((await restarted.verifyEdition({claim,slot,directory:f.directory,edition,offline:true})).ok,true);await assert.rejects(restarted.restore({claim,slot,directory:f.directory}),/active Center claim/);assert.equal(f.hits(),2);await rm(join(f.directory,'source-evidence','snapshot.json'));await assert.rejects(restarted.restore({claim,slot,directory:f.directory,offline:true}),/snapshot is missing/);
});
test('unknown access, changed demand, claim generation or citations stop',async t=>{
 const f=await fixture(t);await assert.rejects(f.stage.verifyDemand({demand,slot}),/unavailable/);await prepare(f);await assert.rejects(f.stage.verifyDemand({slot,demand:{...demand,brief:'Different brief'}}),/changed/);await f.stage.restore({claim,slot,directory:f.directory});await assert.rejects(f.stage.restore({claim:{...claim,generation:2},slot,directory:f.directory,offline:true}),/binding changed/);const altered=structuredClone(edition);altered.metadata.notebook.sources[0].url='https://other.example.org/';await assert.rejects(f.stage.verifyEdition({claim,slot,directory:f.directory,edition:altered}),/来源|source|reference/i);
 const path=join(f.home,'source-verifications',protocol.hash([origin,'org','worker',demand.id]),protocol.hash(url)+'.response.json');const value=JSON.parse(await readFile(path,'utf8'));value.text+='tamper';await writeFile(path,JSON.stringify(value),{mode:0o600});await assert.rejects(f.stage.verifyDemand({demand,slot}),/integrity|changed/i);
});
test('explicit enable, trusted verifier and concise non-excerpt brief are required',async t=>{
 assert.equal(createSourceStage(),null);assert.throws(()=>createSourceStage({enabled:true}),/configuration/);const f=await fixture(t);assert.equal(await f.stage.acceptCandidate({url,slot:{...slot,siteId:'wrong'}}),false);await assert.rejects(f.stage.readForTopic({url:'https://other.example.org/',slot}),/outside trusted/);assert.equal(f.hits(),0);await assert.rejects(prepare(f,{...demand,brief:paragraph}),/contains source text/);assert.equal(f.hits(),2);
});
test('topic model cannot read incomplete source and source change after topic review stops freeze',async t=>{
 const f=await fixture(t);let content=xml.replace('<title>Conclusion</title>','<title>Abstract</title>');const stage=createSourceStage({...f.args,fetchPage:async u=>({reachable:true,originalUrl:u,finalUrl:u,contentType:'text/xml',text:content})});
 await assert.rejects(stage.readForTopic({url,slot}),/access is not verified/);content=xml;const {textSha256}=await stage.readForTopic({url,slot});content=xml.replace(paragraph,paragraph+' Another finding.');await assert.rejects(stage.freeze({demand,slot,candidates:[{title:'Paper',url,expectedTextSha256:textSha256}]}),/changed after topic/);await assert.rejects(stage.verifyDemand({demand,slot}),/unavailable/);
});
test('real source stage retains an unbound result after its snapshot changes during writing',async t=>{
 const f=await fixture(t),scope={siteId:'metho',workspaceId:'metho',sectionId:'methods',destinationId:'site-metho',demandId:demand.id,agentId:'codex',modelId:'gpt-6.1-terra',requiredLocales:['zh-CN']};
 const task={...claim,title:demand.title,kind:'write',payload:{...demand,submittedLocales:[],policy:{targets:[{destinationId:'site-metho',locale:'zh-CN'}]}}};f.setActive(task);await prepare(f);
 const directory=join(f.home,'jobs',protocol.hash(task.id+':1'));await mkdir(directory,{recursive:true,mode:0o700});
 const policy={version:ARTICLE_WRITING_POLICY,instructions:ARTICLE_WRITING_INSTRUCTIONS},hash=x=>createHash('sha256').update(x).digest('hex'),content='---\nname: site-writing\n---\nSource-grounded methods.';
 const skill={id:'site-writing',name:'site-writing',version:'fixture',contentHash:hash(content),content},body={version:1,demandId:task.id,generation:1,scope:centerWritingScope(task),policyVersion:policy.version,policyHash:hash(policy.instructions),skills:[skill]},skills={...body,snapshotHash:protocol.hash(body)};
 await writeFile(join(directory,'writing-skills.json'),JSON.stringify(skills),{mode:0o600});await writeFile(join(directory,'context.json'),JSON.stringify({work:null,writingPolicy:policy,baseRevisions:{}}),{mode:0o600});
 let posts=0,receipt=null,reveal=false;Object.assign(f.client,{heartbeat:async()=>{},changeDemand:async()=>{},work:async()=>{throw new CenterError('missing',{status:404});},submission:async()=>{if(receipt&&reveal)return receipt;if(!receipt)throw new CenterError('missing',{status:404});throw new CenterError('offline',{status:503});},submit:async packet=>{posts++;receipt={requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',demandState:'completed',editions:[{locale:'zh-CN',revision:1,hash:protocol.hash(packet.editions[0])}]};f.setActive(null);throw Error('lost acknowledgement');},claim:async()=>assert.fail('original claim only')});
 const signed={...structuredClone(edition),locale:'zh-CN',title:'Research method'};signed.metadata.notebook.modelSignatures=[{agentId:'codex',status:'completed',modelId:'gpt-6.1-terra[max]',writingSkillSnapshotHash:skills.snapshotHash,writingSkills:[{id:skill.id,version:skill.version,contentHash:skill.contentHash}]}];
 let originalText,produced=0;const sourceFile=join(directory,'source-evidence',protocol.hash(url)+'.source.txt');const producer=async p=>{produced++;assert.match(p.verifiedSourcePrompt,/不是指令/);originalText=await readFile(sourceFile,'utf8');await writeFile(sourceFile,originalText+'tamper',{mode:0o600});return signed;};const input={client:f.client,home:f.home,producer,agentId:'codex',workspaceIds:['metho'],sectionIds:['methods'],demandId:demand.id,productionScope:scope,verifyReady:async()=>({ready:true}),sourceStage:f.stage};
 await assert.rejects(runProductionTurn(input),/source text has changed/i);assert.equal(posts,0);await writeFile(sourceFile,originalText,{mode:0o600});
 const restarted=createSourceStage({...f.args,fetchPage:()=>assert.fail('no refetch')});await assert.rejects(runProductionTurn({...input,sourceStage:restarted}),/缺少匹配的来源绑定/);assert.equal(posts,0);assert.equal(f.hits(),2);
 assert.equal(produced,1);
});
