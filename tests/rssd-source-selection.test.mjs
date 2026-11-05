import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {freezeSourceSelection,bindSourceSelectionToClaim} from '../scripts/rssd-source-selection.mjs';

const connection={origin:'https://center.example.org',orgId:'org',workerId:'worker'};
const demand={id:'demand-one',workspaceId:'metho',sectionId:'methods',kind:'write',title:'Research method',brief:'PRIVATE_BRIEF_MARKER: short research question',requiredLocales:['zh-CN'],source:null,priority:0};
const verifiedSources=[{title:'Paper',url:'https://example.org/paper',verified:true,verifiedTextSha256:'a'.repeat(64)}];
const token='claim-token-private',claim={id:demand.id,workspaceId:demand.workspaceId,sectionId:demand.sectionId,orgId:connection.orgId,workerId:connection.workerId,claimToken:token,generation:4,state:'claimed',payload:{...demand,policy:{targets:[]}}};
const clock=()=>new Date('2026-11-02T12:00:00Z');
const client=()=>({origin:connection.origin,identity:async()=>({protocolVersion:1,orgId:'org',workerId:'worker',workspaceIds:['metho']}),activeClaim:async()=>structuredClone(claim)});
async function fixture(fn){const home=await mkdtemp(join(tmpdir(),'rssd-source-selection-'));try{return await fn(home);}finally{await rm(home,{recursive:true,force:true});}}
const verifySelection=async({demandHash,sourceSetHash})=>({valid:true,demandHash,sourceSetHash,evidenceHash:'c'.repeat(64),method:'fixture-verifier',verifiedAt:'2026-11-02T12:00:00Z'});
const freeze=home=>({home,connection,demand,verifiedSources,verifySelection,clock});
const bind=(home,c=client())=>({home,connection,claim,client:c,verifySelection,clock});

test('source identities freeze before POST, then bind to exact authenticated claim without persisting prose or token',()=>fixture(async home=>{
 const selection=await freezeSourceSelection(freeze(home));assert.equal(selection.binding,null);
 const path=join(home,'source-selections',protocol.hash(demand.id)+'.json'),before=await readFile(path,'utf8');assert.doesNotMatch(before,/PRIVATE_BRIEF_MARKER|claim-token-private/);
 const result=await bindSourceSelectionToClaim(bind(home));assert.deepEqual(result.binding,{claimId:demand.id,generation:4,workspaceId:'metho',sectionId:'methods',demandHash:protocol.hash(protocol.demand(demand))});assert.deepEqual(result.verifiedSources,verifiedSources);
 const after=await readFile(path,'utf8');assert.doesNotMatch(after,/PRIVATE_BRIEF_MARKER|claim-token-private/);assert.deepEqual(await bindSourceSelectionToClaim(bind(home)),result);
 assert.deepEqual(await freezeSourceSelection(freeze(home)),JSON.parse(after));
}));

test('different selection, demand or claim generation cannot replace original identity',()=>fixture(async home=>{
 await freezeSourceSelection(freeze(home));await assert.rejects(freezeSourceSelection({...freeze(home),verifiedSources:[{...verifiedSources[0],verifiedTextSha256:'b'.repeat(64)}]}));
 await assert.rejects(freezeSourceSelection({...freeze(home),demand:{...demand,title:'Changed'}}));
 await bindSourceSelectionToClaim(bind(home));const newer={...claim,generation:5},remote=client();remote.activeClaim=async()=>structuredClone(newer);
 await assert.rejects(bindSourceSelectionToClaim({...bind(home,remote),claim:newer}),/another claim generation/);
}));

test('revoked, wrong-scope, changed-payload and missing original claims never bind',()=>fixture(async home=>{
 await freezeSourceSelection(freeze(home));
 for(const mutate of [
  c=>{c.identity=async()=>({protocolVersion:1,orgId:'other',workerId:'worker',workspaceIds:['metho']});},
  c=>{c.identity=async()=>({protocolVersion:1,orgId:'org',workerId:'worker',workspaceIds:['other']});},
  c=>{c.activeClaim=async()=>null;},
  c=>{c.activeClaim=async()=>({...claim,claimToken:'other-token'});},
  c=>{c.activeClaim=async()=>({...claim,payload:{...claim.payload,brief:'changed'}});},
  c=>{c.activeClaim=async()=>({...claim,state:'completed'});},
 ]){const c=client();mutate(c);await assert.rejects(bindSourceSelectionToClaim(bind(home,c)));}
 await assert.rejects(bindSourceSelectionToClaim({...bind(home),verifySelection:undefined}));
 await assert.rejects(bindSourceSelectionToClaim({...bind(home),verifySelection:async()=>{throw Error('missing receipt');}}),/receipt is unavailable/);
 const stored=JSON.parse(await readFile(join(home,'source-selections',protocol.hash(demand.id)+'.json'),'utf8'));assert.equal(stored.binding,null);
}));

test('tampered selection, excessive brief and unverified source fail closed',()=>fixture(async home=>{
 await assert.rejects(freezeSourceSelection({...freeze(home),demand:{...demand,brief:'x'.repeat(4001)}}));
 await assert.rejects(freezeSourceSelection({...freeze(home),verifiedSources:[{...verifiedSources[0],verified:false}]}));
 await assert.rejects(freezeSourceSelection({...freeze(home),verifySelection:undefined}));
 await assert.rejects(freezeSourceSelection({...freeze(home),verifySelection:async()=>({valid:true})}));
 await freezeSourceSelection(freeze(home));const file=join(home,'source-selections',protocol.hash(demand.id)+'.json'),record=JSON.parse(await readFile(file,'utf8'));record.selection.verifiedSources[0].url='https://unknown.example/paper';await writeFile(file,JSON.stringify(record),{mode:0o600});
 await assert.rejects(bindSourceSelectionToClaim(bind(home)),/integrity/);
}));
