import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {PERSONA_SNAPSHOT_SCHEMA,VOICE_MODES,VOICE_BYLINES,CANDIDATE_LIMIT,personaSnapshot,writingPersonaSnapshot,personaEntry,voiceRange,decideVoice,settleVoice,lapseVoice} from '../contracts/persona-voice.mjs';
import {withEditionByline} from '../contracts/edition-byline.mjs';

// A snapshot shaped and hashed the way the persona library compiles one. Every value here is made up.
const sorted=v=>Array.isArray(v)?v.map(sorted):v===null||typeof v!=='object'?v:Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]));
const H=c=>c.repeat(64);
function snapshot(n,{revision=1,founder=1,core='Reads the fine print first.'}={}){
 const id='P'+String(n).padStart(4,'0');
 const payload={schemaVersion:PERSONA_SNAPSHOT_SCHEMA,kind:'preset-persona',fictional:true,
  preset:{id,revision:id.toLowerCase()+'.v'+revision,contentHash:H('a'),personalityHash:H('b'),founder:{id:'M'+String(founder).padStart(2,'0'),revision:'m.v1',personalityHash:H('c')}},
  publicProfile:{chineseScreenName:'示例'+n,englishScreenName:'Example '+n,abbreviation:'EX'+n},
  behavior:{tuningIntent:'More outward.',core,strengths:['Checks sources'],blindSpots:['Slow to object'],communicationStyle:'Plain and exact.',decisionStyle:'Weighs evidence.',collaborationStyle:'Asks for context.',underPressure:'Rechecks.'},
  developerInstructions:'Write through an explicitly fictional persona.'};
 return {...payload,snapshotHash:createHash('sha256').update(JSON.stringify(sorted(payload))).digest('hex')};
}
const entry=(n,options={})=>personaEntry(snapshot(n,options),{founderName:options.name||'Founder'+(options.founder||1),active:options.active});
const library=count=>Array.from({length:count},(_,i)=>entry(i+1,{founder:i%3+1}));

test('a snapshot is taken whole or not at all',()=>{
 const good=snapshot(1);
 assert.deepEqual(personaSnapshot(good),good);
 assert.deepEqual(personaSnapshot(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(good).reverse())))),good,'key order does not matter');
 assert.throws(()=>personaSnapshot({...good,behavior:{...good.behavior,core:'Edited after it was compiled.'}}),{code:'persona_hash_mismatch'});
 for(const bad of [null,{},{...good,demographics:{age:1}},{...good,schemaVersion:'other'},{...good,fictional:false},
  {...good,preset:{...good.preset,id:'M01'}},{...good,preset:{...good.preset,revision:'p0002.v1'}},{...good,snapshotHash:'x'},
  {...good,developerInstructions:''},{...good,behavior:{...good.behavior,strengths:[]}},{...good,developerInstructions:'x'.repeat(30000)}])
  assert.throws(()=>personaSnapshot(bad),{code:'invalid_persona'});
});

test('an entry keeps the reference, the founder who signs and a short summary, and nothing else',()=>{
 const e=entry(7,{founder:2,name:'Founder Two'});
 assert.deepEqual(Object.keys(e),['id','revision','snapshotHash','founder','active','summary']);
 assert.deepEqual([e.id,e.revision,e.founder,e.active],['P0007','p0007.v1',{id:'M02',name:'Founder Two'},true]);
 assert.deepEqual(Object.keys(e.summary),['core','communicationStyle','strengths']);
 assert.ok(!JSON.stringify(e).includes('Example 7'),'a preset\'s screen name is never carried as a byline');
 for(const name of [undefined,'',' Founder','x'.repeat(81),'a\nb'])assert.throws(()=>personaEntry(snapshot(1),{founderName:name}),{code:'invalid_persona'});
});

test('RSSD verifies the source before producing an ID-only, independently verifiable writing copy',()=>{
 const {snapshotHash,...source}=snapshot(1);
 source.publicProfile={chineseScreenName:'笔名甲',englishScreenName:'Alias (A)',abbreviation:'AL'};
 source.behavior.core='按笔名甲的方式解释。';
 source.behavior.strengths=['AL explains CALM and Alias (A) checks evidence.'];
 source.developerInstructions='Public name: 笔名甲 / Alias (A).\nWrite as 笔名甲. Keep citations.';
 const original={...source,snapshotHash:createHash('sha256').update(JSON.stringify(sorted(source))).digest('hex')};
 const copy=writingPersonaSnapshot(Object.freeze(original));
 assert.equal(copy.developerInstructions,'Write as P0001. Keep citations.');
 assert.deepEqual(copy.behavior.strengths,['P0001 explains CALM and P0001 checks evidence.']);
 assert.equal(copy.behavior.core,'按P0001的方式解释。');
 assert.deepEqual(Object.values(copy.publicProfile),Array(3).fill('P0001'));
 assert.deepEqual(copy.preset,original.preset);
 assert.notEqual(copy.snapshotHash,original.snapshotHash);
 assert.deepEqual(personaSnapshot(copy),copy);
 assert.deepEqual(writingPersonaSnapshot(copy),copy);
 assert.throws(()=>writingPersonaSnapshot({...original,developerInstructions:'Edited.'}),{code:'persona_hash_mismatch'});
});

test('the protocol accepts a section voice and an order voice, and keeps the two lists equal',()=>{
 assert.deepEqual(protocol.VOICE_MODES,VOICE_MODES);assert.deepEqual(protocol.VOICE_BYLINES,VOICE_BYLINES);
 const policy=voice=>protocol.policy({targets:[],voice}).voice;
 assert.deepEqual(policy({mode:'fixed',persona:'P0001'}),{mode:'fixed',persona:'P0001',byline:'persona'});
 assert.deepEqual(policy({mode:'choose'}),{mode:'choose',range:'all',byline:'persona'});
 assert.deepEqual(policy({mode:'random',range:['P0001','P0002'],fallback:'P0003',byline:'site'}),{mode:'random',range:['P0001','P0002'],fallback:'P0003',byline:'site'});
 for(const bad of [{},{mode:'best'},{mode:'fixed'},{mode:'fixed',persona:'P0001',range:'all'},{mode:'choose',persona:'P0001'},
  {mode:'choose',range:[]},{mode:'choose',range:['P0001','P0001']},{mode:'choose',byline:'founder'},{mode:'balanced',range:'some'}])
  assert.throws(()=>policy(bad),protocol.ProtocolError);
 assert.throws(()=>protocol.policy({targets:[],persona:{id:'M01',name:'A'},voice:{mode:'choose'}}),/not both/);
 assert.equal('voice' in protocol.policy({targets:[]}),false,'a policy that states no voice keeps its identity');
 const demand={workspaceId:'w',sectionId:'s',title:'T'};
 assert.equal(protocol.demand({...demand,voice:'none'}).voice,'none');
 assert.deepEqual(protocol.demand({...demand,voice:{persona:'P0002',extra:1}}).voice,{persona:'P0002'});
 assert.equal('voice' in protocol.demand(demand),false);
 assert.throws(()=>protocol.demand({...demand,voice:{}}),/voice.persona/);
 assert.throws(()=>protocol.demand({...demand,kind:'translate',source:{workId:'x',locale:'zh-CN',revision:1},voice:'none'}),/Only a write demand/);
 assert.throws(()=>protocol.demand({...demand,workType:'note',adaptedFrom:{workId:'x',revision:1},voice:{persona:'P0002'}}),/keeps the persona/);
 for(const invalid of ['Author','M01','P01','p0001','笔名']){
  for(const setting of [{mode:'fixed',persona:invalid},{mode:'choose',range:[invalid]},{mode:'balanced',fallback:invalid}])
   assert.throws(()=>policy(setting),protocol.ProtocolError);
  assert.throws(()=>protocol.demand({...demand,voice:{persona:invalid}}),protocol.ProtocolError);
 }
 assert.equal(policy({mode:'fixed',persona:'P10000'}).persona,'P10000');
});

test('a work with a source keeps the source\'s voice, even one that is retired or outside the range',()=>{
 const lib=[entry(1),entry(1,{revision:2}),entry(2,{active:false})];
 const voice={mode:'fixed',persona:'P0001',byline:'persona'};
 const kept=decideVoice({voice,library:lib,source:{id:'P0002',revision:'p0002.v1',signed:true},order:'none'});
 assert.deepEqual([kept.state,kept.method,kept.persona.id,kept.byline],['chosen','kept','P0002','persona']);
 assert.equal(decideVoice({voice,library:lib,source:{id:'P0001',revision:'p0001.v1',signed:false}}).byline,'site');
 assert.equal(decideVoice({voice,library:lib,source:{id:'P0001',revision:'p0001.v1'}}).persona.revision,'p0001.v1','the revision that wrote, not the newest');
 assert.deepEqual(decideVoice({voice,library:lib,source:null}),{state:'none'},'a source without a voice stays without one');
 assert.deepEqual(decideVoice({voice,library:lib,source:{id:'P0009',revision:'p0009.v1'}}),{state:'none'});
});

test('the order comes before the section; a section without a voice has none',()=>{
 const lib=library(4),voice={mode:'fixed',persona:'P0001',byline:'site'};
 assert.deepEqual(decideVoice({voice,library:lib,order:'none'}),{state:'none'});
 const named=decideVoice({voice,library:lib,order:{persona:'P0003'}});
 assert.deepEqual([named.method,named.persona.id,named.byline],['named','P0003','site']);
 assert.equal(decideVoice({library:lib,order:{persona:'P0003'}}).byline,'persona','an order may name a persona where the section sets none');
 assert.deepEqual(decideVoice({library:lib}),{state:'none'});
 const fixed=decideVoice({voice,library:lib});
 assert.deepEqual([fixed.method,fixed.persona],['fixed',{id:'P0001',revision:'p0001.v1',snapshotHash:lib[0].snapshotHash,founder:{id:'M01',name:'Founder1'}}]);
});

test('random and balanced draws are fixed per demand and stay inside the active range',()=>{
 const lib=[...library(8),entry(9,{active:false})],voice={mode:'random',range:['P0002','P0004','P0006','P0009'],byline:'persona'};
 assert.deepEqual(voiceRange(voice,lib).map(e=>e.id),['P0002','P0004','P0006']);
 const picks=new Set();
 for(let i=0;i<60;i++){
  const a=decideVoice({voice,library:lib,demandId:'demand-'+i}),b=decideVoice({voice,library:[...lib].reverse(),demandId:'demand-'+i});
  assert.deepEqual(a,b,'the same demand decides the same whatever order the library is listed in');
  assert.equal(a.method,'random');picks.add(a.persona.id);
 }
 assert.deepEqual([...picks].sort(),['P0002','P0004','P0006']);
 const balanced={...voice,mode:'balanced'};
 for(let i=0;i<20;i++)assert.equal(decideVoice({voice:balanced,library:lib,demandId:'d'+i,usage:{P0002:3,P0004:1,P0006:2,P0009:0}}).persona.id,'P0004');
 const tie=new Set();for(let i=0;i<40;i++)tie.add(decideVoice({voice:balanced,library:lib,demandId:'d'+i,usage:{P0002:1}}).persona.id);
 assert.deepEqual([...tie].sort(),['P0004','P0006'],'the least used ones share the work');
 assert.equal(decideVoice({voice:{mode:'random',range:['P0002'],byline:'persona'},library:lib}).method,'only');
});

test('choosing: at most five candidates, fixed per demand; the writer settles one with a reason',()=>{
 const lib=library(12),voice={mode:'choose',range:'all',fallback:'P0012',byline:'site'};
 const pending=decideVoice({voice,library:lib,demandId:'demand-1'});
 assert.equal(pending.state,'pending');assert.equal(pending.candidates.length,CANDIDATE_LIMIT);
 assert.deepEqual(decideVoice({voice,library:lib,demandId:'demand-1'}),pending);
 assert.notDeepEqual(decideVoice({voice,library:lib,demandId:'demand-2'}).candidates.map(c=>c.id),pending.candidates.map(c=>c.id));
 assert.deepEqual(Object.keys(pending.candidates[0]),['id','revision','snapshotHash','founder','summary']);
 assert.equal(pending.fallback.id,'P0012');
 assert.equal(decideVoice({voice:{mode:'choose',range:['P0001','P0002','P0003'],byline:'persona'},library:lib}).candidates.length,3);
 const pick=pending.candidates[2].id,settled=settleVoice(pending,pick,'  Explains\nconditions  carefully. ');
 assert.deepEqual([settled.state,settled.method,settled.persona.id,settled.byline,settled.reason],['chosen','chosen',pick,'site','Explains conditions carefully.']);
 assert.equal('summary' in settled.persona,false);
 const outside=lib.find(e=>!pending.candidates.some(c=>c.id===e.id)).id;
 assert.throws(()=>settleVoice(pending,outside,'x'),{code:'voice_not_offered'});
 assert.throws(()=>settleVoice(pending,pick,' '),{code:'voice_reason_required'});
 assert.throws(()=>settleVoice(settled,pick,'again'),{code:'voice_not_pending'});
 assert.deepEqual([lapseVoice(pending).method,lapseVoice(pending).persona.id],['fallback','P0012']);
 assert.deepEqual(lapseVoice({...pending,fallback:null}),{state:'none'});
 assert.equal(lapseVoice(settled),settled);
});

test('nothing usable in the range falls back, and without a fallback there is no persona',()=>{
 const lib=[entry(1,{active:false}),entry(2)];
 assert.deepEqual(decideVoice({voice:{mode:'fixed',persona:'P0001',byline:'persona'},library:lib}),{state:'none'});
 assert.deepEqual(decideVoice({voice:{mode:'random',range:['P0001'],byline:'persona'},library:lib}),{state:'none'});
 const back=decideVoice({voice:{mode:'choose',range:['P0001'],fallback:'P0002',byline:'persona'},library:lib});
 assert.deepEqual([back.method,back.persona.id],['fallback','P0002']);
 assert.equal(decideVoice({voice:{mode:'random',range:['P0001'],fallback:'P0001',byline:'persona'},library:lib}).state,'none','a retired fallback is no fallback');
 assert.equal(decideVoice({voice:{mode:'random',range:'all',fallback:'P0002',byline:'persona'},library:lib,order:{persona:'P0001'}}).method,'fallback','an order that names a retired persona');
});

test('the byline: the founder signs, or the site does; the preset that wrote stays private',()=>{
 const site={author:'研究方法',category:'统计之美'},lib=library(3);
 const edition={title:'T',metadata:{author:'Agent',voice:{id:'P9999',revision:'forged',snapshotHash:'x'},persona:{id:'M99'},notebook:{version:2}}};
 const signed=decideVoice({voice:{mode:'fixed',persona:'P0002',byline:'persona'},library:lib});
 const a=withEditionByline(edition,{site,voice:signed}).metadata;
 assert.deepEqual(a,{author:'Founder2',category:'统计之美',persona:{id:'M02'},voice:{id:'P0002',revision:'p0002.v1',snapshotHash:lib[1].snapshotHash},notebook:{version:2}});
 const current=withEditionByline(edition,{site,voice:signed,presetRecord:true}).metadata;
 assert.deepEqual(current,{...a,persona:{id:'P0002'}});
 const inherited=withEditionByline(edition,{site,voice:{...signed,method:'kept'},presetRecord:true,source:{payload:{metadata:{...a,voice:{...a.voice,snapshotHash:H('f')}}}}}).metadata;
 assert.deepEqual(inherited,current);
 const unsigned=withEditionByline(edition,{site,voice:{...signed,byline:'site'}}).metadata;
 assert.deepEqual([unsigned.author,'persona' in unsigned,unsigned.voice.id],['研究方法',false,'P0002']);
 // A voice decision replaces a persona byline even when it chose nobody.
 const none=withEditionByline(edition,{site,persona:{id:'M01',name:'Old'},voice:{state:'none'}}).metadata;
 assert.deepEqual([none.author,'persona' in none,'voice' in none],['研究方法',false,false]);
 // Without a voice decision the earlier persona byline works as before, and the agent's own claim is dropped.
 const legacy=withEditionByline(edition,{site,persona:{id:'M01',name:'Old'}}).metadata;
 assert.deepEqual([legacy.author,legacy.persona,'voice' in legacy],['Old',{id:'M01'},false]);
 // The second language of a work follows its first edition, whatever this claim decided.
 const second=withEditionByline(edition,{site,voice:decideVoice({voice:{mode:'fixed',persona:'P0003',byline:'site'},library:lib}),source:{payload:{metadata:a}}}).metadata;
 assert.deepEqual([second.author,second.persona,second.voice.id],['Founder2',{id:'M02'},'P0002']);
 const plain=withEditionByline(edition,{site,voice:signed,source:{payload:{metadata:{author:'研究方法'}}}}).metadata;
 assert.deepEqual([plain.author,'persona' in plain,'voice' in plain],['研究方法',false,false]);
 // A pending decision signs nothing yet.
 const pending=withEditionByline(edition,{site,voice:{state:'pending',candidates:[],byline:'persona',fallback:null}}).metadata;
 assert.deepEqual([pending.author,'voice' in pending],['研究方法',false]);
});
