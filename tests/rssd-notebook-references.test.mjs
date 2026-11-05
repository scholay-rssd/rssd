import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookEdition} from '../desktop/scripts/agent/center-notebook.mjs';
import {notebookMarkdown} from '../desktop/scripts/agent/notebook.mjs';
import {verifyAutomatedReferences} from '../scripts/rssd-reference-gate.mjs';
import protocol from '../contracts/rssd-v1.cjs';

const notebook=()=>({version:2,kind:'article',title:'Research methods',skills:[],fields:{},groups:[],blocks:[
 {id:'intro',type:'paragraph',state:'ready',text:'An observation ([study](https://example.org/a?utm_source=chat&version=2)).',sourceIds:['one','two']},
 {id:'next',type:'paragraph',state:'ready',text:'Another source: [paper](https://example.org/b?fbclid=123).',sourceIds:['two']},
],sources:[{id:'one',title:'First study',url:'https://example.org/a?utm_source=chat&version=2',summary:'',acquiredVia:'web',reviewed:false},{id:'two',title:'Second study',url:'https://example.org/b?fbclid=123',summary:'',acquiredVia:'web',reviewed:false}],blockNotes:{intro:{notes:{verification:'Private note with https://example.org/?utm_source=private'}}},internalNotes:{verification:'Private verification remains unchanged'}});

test('inline links remain cited in the bibliography and trackers are removed without altering private notes',()=>{
 const input=notebook(),before=structuredClone(input),edition=notebookEdition({notebook:input,summary:'Summary'},{locale:'en',sectionId:'methods'}),n=edition.metadata.notebook;
 assert.deepEqual(input,before);assert.deepEqual(n.blockNotes,before.blockNotes);assert.deepEqual(n.internalNotes,before.internalNotes);
 assert.equal(edition.metadata.notebookBodyHash,protocol.hash(edition.bodyMarkdown));assert.deepEqual(verifyAutomatedReferences(edition),{ok:true,sourceCount:2});
 assert.match(edition.bodyMarkdown,/https:\/\/example\.org\/a\?version=2/);assert.doesNotMatch(edition.bodyMarkdown,/utm_source|fbclid/);
 const references=edition.bodyMarkdown.split('### References')[1];assert.ok(references);assert.match(references,/First study/);assert.match(references,/Second study/);
});

test('a source already in an authored reference section is not duplicated',()=>{
 const n=notebook();n.blocks.push({id:'refs',type:'markdown',state:'ready',text:'### References\n\n1. [First study](https://example.org/a?version=2)',sourceIds:[]});
 const result=notebookMarkdown(n,{site:null,locale:'en'}),references=result.split('### References')[1];
 assert.equal((references.match(/\[First study\]/g)||[]).length,1);assert.equal((references.match(/\[Second study\]/g)||[]).length,1);
});
