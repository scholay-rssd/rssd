import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {PERSONA_SNAPSHOT_SCHEMA,personaEntry,writingPersonaSnapshot,decideVoice,settleVoice,lapseVoice} from '../contracts/persona-voice.mjs';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import {CenterError} from '../scripts/rssd-center-client.mjs';
import {poolDemand} from '../scripts/rssd-topic-pool.mjs';
import {centerWritingPrompt,personaVoiceInstructions,voiceChoicePrompt,parseVoiceChoice} from '../desktop/scripts/agent/center-producer.mjs';

// Snapshots shaped and hashed the way the persona library compiles them. Every value here is made up.
const sorted=v=>Array.isArray(v)?v.map(sorted):v===null||typeof v!=='object'?v:Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]));
const H=c=>c.repeat(64);
function snapshot(n){
 const id='P'+String(n).padStart(4,'0');
 const payload={schemaVersion:PERSONA_SNAPSHOT_SCHEMA,kind:'preset-persona',fictional:true,
  preset:{id,revision:id.toLowerCase()+'.v1',contentHash:H('a'),personalityHash:H('b'),founder:{id:'M'+String(n).padStart(2,'0'),revision:'m.v1',personalityHash:H('c')}},
  publicProfile:{chineseScreenName:'示例'+n,englishScreenName:'Example '+n,abbreviation:'EX'+n},
  behavior:{tuningIntent:'More outward.',core:'Core of '+id,strengths:['Checks sources'],blindSpots:['Slow to object'],communicationStyle:'Plain and exact.',decisionStyle:'Weighs evidence.',collaborationStyle:'Asks for context.',underPressure:'Rechecks.'},
  developerInstructions:'Public name: 示例'+n+' / Example '+n+'.\nWrite as '+id+': plain, exact, conditions stated.'};
 return {...payload,snapshotHash:createHash('sha256').update(JSON.stringify(sorted(payload))).digest('hex')};
}
const snapshots=Object.fromEntries([1,2,3].map(n=>['P000'+n,snapshot(n)]));
const library=Object.values(snapshots).map((s,i)=>personaEntry(s,{founderName:'Founder'+(i+1)}));

// A Center that froze `decision` on the claim, as RssdMounts does: the snapshot rides on the claim only once
// the decision is chosen, and `chooseVoice` settles a pending one.
async function fixture(t,decision,{locales=['zh-CN']}={}){
 const home=await mkdtemp(join(tmpdir(),'rssd-voice-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const attach=d=>d?.state==='chosen'?{mounts:{voice:snapshots[d.persona.id]}}:{};
 const task={id:'demand-voice',generation:1,workspaceId:'research',sectionId:'methods',state:'claimed',title:'置信区间怎么读',kind:'write',claimToken:'claim-voice',
  payload:{brief:'## 读者问题\n怎么读置信区间。',requiredLocales:locales,submittedLocales:[],policy:{version:1,targets:[]},...(decision?{voiceDecision:decision,personaRecordVersion:2}:{})},...attach(decision)};
 const packets=[],choices=[];
 const client={origin:'https://center.example',activeClaim:async()=>null,claim:async()=>structuredClone(task),
  work:async()=>{throw new CenterError('Not found',{status:404});},heartbeat:async()=>{},changeDemand:async()=>{},
  submission:async()=>{throw new CenterError('Not found',{status:404});},
  chooseVoice:async body=>{
   choices.push(body);assert.equal(body.demandId,task.id);assert.equal(body.claimToken,task.claimToken);
   const current=task.payload.voiceDecision;
   if(current.state==='pending')task.payload.voiceDecision=body.personaId?settleVoice(current,body.personaId,body.reason):lapseVoice(current);
   return {demandId:task.id,voiceDecision:task.payload.voiceDecision,...attach(task.payload.voiceDecision)};
  },
  submit:async packet=>{packets.push(packet);task.payload.submittedLocales.push(...packet.editions.map(e=>e.locale));
   return {status:'accepted',requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,publicationIds:[],demandState:locales.every(l=>task.payload.submittedLocales.includes(l))?'completed':'claimed',editions:packet.editions.map(e=>({locale:e.locale,revision:1,hash:protocol.hash(e)}))};}};
 const run=producer=>runProductionTurn({client,home,agentId:'example',workspaceIds:['research'],producer});
 return {home,task,client,packets,choices,run};
}

test('the persona comes after the rules and before the order, and a prompt without one is unchanged',()=>{
 const claim={workspaceId:'none',sectionId:'methods',title:'置信区间怎么读',payload:{brief:'本单的具体要求',policy:{instructions:'栏目规则文字',brand:{name:'Brand'}}}};
 const base={claim,locale:'zh-CN',writingPolicy:{version:'p1',instructions:'写作协议文字'},writingSkills:{skills:[{id:'s',version:'1',contentHash:H('d'),content:'技能文字'}],snapshotHash:H('e')}};
 const plain=centerWritingPrompt(base),voiced=centerWritingPrompt({...base,persona:snapshots.P0002});
 assert.equal(plain.includes('写作人格'),false);
 const part=personaVoiceInstructions(snapshots.P0002);
 assert.equal(voiced,plain.replace('选题：置信区间怎么读',part+'\n\n选题：置信区间怎么读'),'only the persona part is added');
 assert.ok(part.includes('Write as P0002'));assert.ok(/只影响怎么表达/.test(part));
 assert.doesNotMatch(voiced,/示例2|Example 2|Public name:/);
 const at=text=>voiced.indexOf(text);
 assert.ok(at('写作协议文字')<at('栏目规则文字')&&at('栏目规则文字')<at('品牌要求')&&at('品牌要求')<at('写作人格')&&at('写作人格')<at('本单的具体要求'));
});

test('the choosing turn shows summaries only, and an unusable answer declines',()=>{
 const pending=decideVoice({voice:{mode:'choose',range:'all',byline:'persona'},library,demandId:'d1'});
 const claim={title:'置信区间怎么读',payload:{brief:'怎么读'}},ask=voiceChoicePrompt({claim,candidates:pending.candidates});
 for(const c of pending.candidates){assert.ok(ask.includes('"'+c.id+'"'));assert.ok(ask.includes(c.summary.core));}
 assert.doesNotMatch(ask,/Founder|Example|示例/);
 assert.equal(ask.includes('Write as'),false,'no persona content before one is chosen');
 const id=pending.candidates[0].id;
 assert.deepEqual(parseVoiceChoice('{"personaId":"'+id+'","reason":" 讲条件\\n讲得清楚 "}',pending.candidates),{personaId:id,reason:'讲条件 讲得清楚'});
 assert.deepEqual(parseVoiceChoice('好的。\n```json\n{"personaId":"'+id+'","reason":"合适"}\n```',pending.candidates),{personaId:id,reason:'合适'});
 for(const bad of ['','没有 JSON','{"personaId":null}','{"personaId":"P9999","reason":"x"}','{"personaId":"'+id+'"}','{"personaId":"'+id+'","reason":"  "}','{broken'])assert.deepEqual(parseVoiceChoice(bad,pending.candidates),{});
});

test('a pool topic may name its persona or ask for none',()=>{
 const scope={workspaceId:'research',sectionId:'methods'},topic=voice=>({title:'置信区间：怎么读',brief:'简介',voice});
 assert.deepEqual(poolDemand(topic({persona:'P0002'}),scope).voice,{persona:'P0002'});
 assert.equal(poolDemand(topic('none'),scope).voice,'none');
 assert.equal('voice' in poolDemand({title:'置信区间：怎么读',brief:'简介'},scope),false);
 assert.throws(()=>poolDemand(topic({}),scope),/voice.persona/);
});

test('a persona frozen with the claim is handed to the producer, signs the work and is recorded privately',async t=>{
 const decision=decideVoice({voice:{mode:'fixed',persona:'P0002',byline:'persona'},library}),f=await fixture(t,decision,{locales:['zh-CN','en']});
 const seen=[];
 const result=await f.run(async({voice,locale})=>{const state=await voice.current();seen.push([locale,state.decision.method,state.snapshot.preset.id]);return {title:locale,bodyMarkdown:'正文 '+locale,metadata:{author:'Agent',voice:{id:'P9999'}}};});
 assert.equal(result.state,'accepted');assert.deepEqual(seen,[['zh-CN','fixed','P0002'],['en','fixed','P0002']]);assert.equal(f.choices.length,0);
 for(const packet of f.packets)assert.deepEqual([packet.editions[0].metadata.author,packet.editions[0].metadata.persona,packet.editions[0].metadata.voice],
  ['Founder2',{id:'P0002'},{id:'P0002',revision:'p0002.v1',snapshotHash:snapshots.P0002.snapshotHash}]);
 // Signing with the site keeps the private record and drops the founder.
 const site=await fixture(t,{...decision,byline:'site'});await site.run(async()=>({title:'t',bodyMarkdown:'正文',metadata:{author:'Agent'}}));
 const metadata=site.packets[0].editions[0].metadata;assert.equal('persona' in metadata,false);assert.equal(metadata.voice.id,'P0002');assert.notEqual(metadata.author,'Founder2');
});

test('where the writer chooses, the answer is settled at the Center and saved before the work is written',async t=>{
 const pending=decideVoice({voice:{mode:'choose',range:'all',fallback:'P0003',byline:'persona'},library,demandId:'demand-voice'}),f=await fixture(t,pending),pick=pending.candidates[1].id;
 const result=await f.run(async({voice,directory})=>{
  const before=await voice.current();assert.equal(before.decision.state,'pending');assert.equal(before.snapshot,null);
  const settled=await voice.choose({personaId:pick,reason:'讲条件讲得清楚'});
  assert.equal(settled.snapshot.preset.id,pick);
  const saved=JSON.parse(await readFile(join(directory,'claim.json'),'utf8'));
  assert.equal(saved.payload.voiceDecision.method,'chosen');assert.equal(saved.mounts.voice.preset.id,pick);
  assert.doesNotMatch(JSON.stringify(saved),/示例|Example|Public name:/);
  assert.doesNotMatch(await readFile(join(f.home,'active-claim.json'),'utf8'),/示例|Example|Public name:/);
  assert.deepEqual(await voice.current(),settled,'a later locale reads the settled persona without asking again');
  return {title:'t',bodyMarkdown:'正文'};
 });
 assert.equal(result.state,'accepted');assert.deepEqual(f.choices,[{demandId:'demand-voice',claimToken:'claim-voice',personaId:pick,reason:'讲条件讲得清楚'}]);
 assert.equal(f.packets[0].editions[0].metadata.voice.id,pick);
 // Declining takes the fallback; with no fallback there is no persona and the site signs.
 const declined=await fixture(t,pending);
 await declined.run(async({voice})=>{const state=await voice.choose();assert.deepEqual([state.decision.method,state.snapshot.preset.id],['fallback','P0003']);return {title:'t',bodyMarkdown:'正文'};});
 assert.deepEqual(declined.choices,[{demandId:'demand-voice',claimToken:'claim-voice'}]);assert.equal(declined.packets[0].editions[0].metadata.voice.id,'P0003');
 const bare=await fixture(t,{...pending,fallback:null});
 await bare.run(async({voice})=>{assert.equal(await voice.choose({}),null);return {title:'t',bodyMarkdown:'正文',metadata:{author:'Agent'}}});
 assert.equal('voice' in bare.packets[0].editions[0].metadata,false);assert.equal('persona' in bare.packets[0].editions[0].metadata,false);
});

test('a legacy claim resumes offline from its verified ID-only writing copy and retains its receipt identity',async t=>{
 const decision=decideVoice({voice:{mode:'fixed',persona:'P0001'},library}),f=await fixture(t,decision);
 delete f.task.payload.personaRecordVersion;
 await assert.rejects(f.run(async({voice})=>{
  const {snapshot}=await voice.current();
  assert.equal(snapshot.publicProfile.chineseScreenName,'P0001');
  throw Error('Interrupted before drafting');
 }),/Interrupted before drafting/);
 const cache=JSON.parse(await readFile(join(f.home,'active-claim.json'),'utf8'));
 assert.doesNotMatch(JSON.stringify(cache),/示例|Example|Public name:/);
 assert.equal(cache.writingSnapshotHash,writingPersonaSnapshot(snapshots.P0001).snapshotHash);
 f.client.activeClaim=async()=>{throw new CenterError('Unavailable',{status:503});};
 const result=await f.run(async({claim,voice})=>{
  assert.equal((await voice.current()).snapshot.snapshotHash,cache.writingSnapshotHash);
  assert.equal(claim.payload.voiceDecision.persona.snapshotHash,decision.persona.snapshotHash);
  return {title:'A resumed work',bodyMarkdown:'Body.'};
 });
 assert.equal(result.state,'accepted');
 const metadata=f.packets[0].editions[0].metadata;
 assert.deepEqual([metadata.author,metadata.persona.id,metadata.voice.id,metadata.voice.snapshotHash],['Founder1','M01','P0001',decision.persona.snapshotHash]);
});

test('a work is not submitted while its persona is undecided, nor with a snapshot that is not the frozen one',async t=>{
 const pending=decideVoice({voice:{mode:'choose',range:'all',byline:'persona'},library,demandId:'demand-voice'}),f=await fixture(t,pending);
 await assert.rejects(f.run(async()=>({title:'t',bodyMarkdown:'正文'})),{code:'voice_pending'});
 assert.equal(f.packets.length,0);
 const decision=decideVoice({voice:{mode:'fixed',persona:'P0002',byline:'persona'},library}),g=await fixture(t,decision);
 g.task.mounts={voice:snapshots.P0001};
 await assert.rejects(g.run(async({voice})=>{await voice.current();return {title:'t',bodyMarkdown:'正文'};}),/人格快照/);
 assert.equal(g.packets.length,0);
});

test('a claim that says nothing about voices reaches the producer and the packet as before',async t=>{
 const f=await fixture(t,null);
 await f.run(async input=>{assert.equal('voice' in input,false);return {title:'t',bodyMarkdown:'正文',metadata:{author:'Agent'}};});
 const metadata=f.packets[0].editions[0].metadata;assert.equal('voice' in metadata,false);assert.equal('persona' in metadata,false);
});

test('the upload file is compiled by the library\'s own code, from ready presets and their founders only',async t=>{
 const {mkdir,writeFile}=await import('node:fs/promises'),{personaUpload,PERSONA_UPLOAD_SCHEMA}=await import('../scripts/rssd-persona-library.mjs');
 const root=await mkdtemp(join(tmpdir(),'rssd-library-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const put=async(path,value)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),typeof value==='string'?value:JSON.stringify(value));};
 // A stand-in compiler with the library's hashing: it returns the snapshot stored in the profile, frozen.
 await put('src/content/persona-compiler.mjs','export function compilePersonaSnapshot(preset){return Object.freeze(structuredClone(preset.compiled));}\n');
 const profile=(n,status='ready',founder=n)=>({id:'P000'+n,status,derivedFrom:{id:'M0'+founder},demographics:{age:30},compiled:snapshot(n)});
 await put('data/presets/registry.json',{members:[{id:'P0001',path:'P0001/profile.json'},{id:'P0002',path:'P0002/profile.json'},{id:'P0003',path:'P0003/profile.json'}]});
 await put('data/presets/P0001/profile.json',profile(1));await put('data/presets/P0002/profile.json',profile(2,'retired'));await put('data/presets/P0003/profile.json',profile(3));
 for(const n of [1,2,3])await put('data/monkeys/M0'+n+'.json',{id:'M0'+n,name:'Founder'+n,founder:true,fictional:true,personality:{scores:{openness:1}}});
 const upload=await personaUpload(root);
 assert.equal(upload.schemaVersion,PERSONA_UPLOAD_SCHEMA);
 assert.deepEqual(upload.personas,[{snapshot:writingPersonaSnapshot(snapshot(1)),founderName:'Founder1'},{snapshot:writingPersonaSnapshot(snapshot(3)),founderName:'Founder3'}]);
 assert.doesNotMatch(JSON.stringify(upload),/示例|Example|Public name:/);
 assert.equal(JSON.stringify(upload).includes('demographics'),false);
 // A founder that is not one, a registry that points outside the library, and a snapshot that fails its hash stop the export.
 await put('data/monkeys/M03.json',{id:'M03',name:'Someone',founder:false,fictional:true});
 await assert.rejects(personaUpload(root),/not a fictional founder/);
 await put('data/monkeys/M03.json',{id:'M03',name:'Founder3',founder:true,fictional:true});
 await put('data/presets/registry.json',{members:[{id:'P0001',path:'../../outside.json'}]});
 await assert.rejects(personaUpload(root),/outside itself/);
 await put('data/presets/registry.json',{members:[{id:'P0001',path:'P0001/profile.json'}]});
 await put('data/presets/P0001/profile.json',{...profile(1),compiled:{...snapshot(1),developerInstructions:'Edited.'}});
 await assert.rejects(personaUpload(root),{code:'persona_hash_mismatch'});
});
