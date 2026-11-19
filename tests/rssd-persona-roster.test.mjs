import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from '../contracts/rssd-v1.cjs';
import publication from '../contracts/rssd-publication.cjs';
import {personaRoster,checkPersonaBindings} from '../scripts/rssd-persona-roster.mjs';

// Synthetic pack in the shape the persona project exports; the names are fixtures.
const monkey=(id,name,extra={})=>({id,name,revision:id.toLowerCase()+'.v1',generation:0,founder:true,parentIds:[],fictional:true,identity:null,direction:null,personality:{framework:'Big Five',scores:{openness:50}},...extra});
const pack={schemaVersion:'12monkey.pack.v1',project:'12monkey',monkeys:[monkey('M01','Alpha'),monkey('M02','Beta'),monkey('X01','Derived',{founder:false}),monkey('M03','Real',{fictional:false})]};

test('the roster keeps a persona\'s ID and name, and nothing else',()=>{
 assert.deepEqual(personaRoster(pack),[{id:'M01',name:'Alpha'},{id:'M02',name:'Beta'}]);
 assert.throws(()=>personaRoster({...pack,schemaVersion:'other'}),/Not a persona pack/);
 assert.throws(()=>personaRoster({...pack,monkeys:[monkey('X01','Derived',{founder:false})]}),/lists no persona/);
 assert.throws(()=>personaRoster({...pack,monkeys:[monkey('M01','Alpha'),monkey('M02','alpha')]}),/repeats/);
 assert.throws(()=>personaRoster({...pack,monkeys:[monkey('M01',' Alpha')]}),/persona.name/);
});
test('section bindings are checked against the roster',()=>{
 const section=(id,persona)=>({id,name:id,policy:{version:1,targets:[],...(persona?{persona}:{})}});
 const registry={workspaces:[{id:'pets',sections:[section('daily-cat',{id:'M01',name:'Alpha'}),section('daily-dog',{id:'M02',name:'Betty'}),section('news')]},{id:'metho',sections:[section('methods',{id:'M09',name:'Iota'})]}]};
 assert.deepEqual(checkPersonaBindings(registry,personaRoster(pack)),[
  {workspaceId:'pets',sectionId:'daily-cat',persona:{id:'M01',name:'Alpha'},state:'ok'},
  {workspaceId:'pets',sectionId:'daily-dog',persona:{id:'M02',name:'Betty'},state:'name_mismatch',rosterName:'Beta'},
  {workspaceId:'metho',sectionId:'methods',persona:{id:'M09',name:'Iota'},state:'unknown_id'}]);
 assert.deepEqual(checkPersonaBindings({workspaces:[]},personaRoster(pack)),[]);
});
test('a section policy keeps only a persona\'s ID and name, and stays as it was without one',()=>{
 assert.deepEqual(Object.keys(protocol.policy({targets:[]})),['version','instructions','brand','targets']);
 assert.deepEqual(protocol.policy({targets:[],persona:{id:'M01',name:'Alpha',age:29,personality:{}}}).persona,{id:'M01',name:'Alpha'});
 const workspace=protocol.workspace({id:'pets',name:'Pets',sections:[{id:'daily-cat',name:'每日一猫',policy:{targets:[],persona:{id:'M01',name:'Alpha'}}}]});
 assert.deepEqual(workspace.sections[0].policy.persona,{id:'M01',name:'Alpha'});
 for(const bad of [{id:'M01'},{name:'Alpha'},{id:'M 01',name:'Alpha'},{id:'M01',name:'Al\npha'},{id:'M01',name:'x'.repeat(81)},'M01'])assert.throws(()=>protocol.policy({targets:[],persona:bad}));
});
test('a site packet carries the byline and never the persona behind it',()=>{
 const content=publication.publicContent({locale:'zh-CN',title:'缅因猫',bodyMarkdown:'正文。',metadata:{author:'Alpha',category:'每日一猫',persona:{id:'M01'},notebook:{modelSignatures:[]}}});
 assert.equal(content.metadata.author,'Alpha');assert.equal('persona' in content.metadata,false);assert.equal(JSON.stringify(content).includes('M01'),false);
});
