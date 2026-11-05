import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookEdition} from '../desktop/scripts/agent/center-notebook.mjs';
import {formatErrors} from '../desktop/scripts/agent/notebook-model.mjs';
import {publicContent} from '../contracts/rssd-publication.cjs';
const notebook=()=>({version:2,kind:'article',title:'Fixture',skills:[],fields:{},sources:[],blocks:[{id:'body',type:'markdown',state:'ready',text:'Public body\n\n- List\n\n```js\n1+1\n```',sourceIds:[]}],internalNotes:{verification:'Private verification'},blockNotes:{body:{notes:{supplement:'Private supplement'}}},modelSignatures:[{agentId:'forged'}]});
test('one notebook yields public Markdown and preserved private notes with a service signature',()=>{
 const result=notebookEdition({notebook:notebook()},{signature:{agentId:'actual'},sectionId:'research'});
 assert.match(result.bodyMarkdown,/```js/);assert.doesNotMatch(result.bodyMarkdown,/Private/);
 assert.deepEqual(result.metadata.notebook.modelSignatures,[{agentId:'actual'}]);
 assert.equal(result.metadata.notebook.sectionId,'research');
 assert.doesNotMatch(JSON.stringify(publicContent({...result,locale:'en'})),/Private|modelSignatures|notebook/);
});
test('updates preserve previous notes and signatures even when the agent omits them',()=>{
 const previous=notebook();previous.modelSignatures=[{agentId:'previous'}];
 const next=notebook();next.internalNotes={verification:'New verification'};next.blockNotes={};
 const result=notebookEdition({notebook:next},{source:{payload:{metadata:{notebook:previous}}},signature:{agentId:'actual'}});
 assert.equal(result.metadata.notebook.internalNotes.verification,'Private verification\n\nNew verification');
 assert.equal(result.metadata.notebook.blockNotes.body.notes.supplement,'Private supplement');
 assert.deepEqual(result.metadata.notebook.modelSignatures,[{agentId:'previous'},{agentId:'actual'}]);
});
test('center editions use the requested language for generated reference headings',()=>{
 const n=notebook();
 n.sources=[{id:'s',title:'Source',url:'https://example.org/source',summary:'Source evidence',acquiredVia:'web',reviewed:false}];
 n.blocks[0].sourceIds=['s'];
 const english=notebookEdition({notebook:n},{locale:'en'}),chinese=notebookEdition({notebook:n},{locale:'zh-CN'});
 assert.match(english.bodyMarkdown,/### References\n\n1\. \[Source\]\(https:\/\/example\.org\/source\)/);
 assert.doesNotMatch(english.bodyMarkdown,/参考文献|Private/);
 assert.match(chinese.bodyMarkdown,/### 参考文献/);
 assert.equal(english.metadata.notebook.internalNotes.verification,'Private verification');
 n.blocks[0].text+='\n\n### References\n\n- [Earlier](https://example.org/earlier)';
 const merged=notebookEdition({notebook:n},{locale:'en'}).bodyMarkdown;
 assert.equal((merged.match(/### References/g)||[]).length,1);
 assert.match(merged,/1\. \[Earlier\].*\n\n2\. \[Source\]/s);
 n.blocks[0].text='Article body\n\n### Notes\n\nOrdinary narrative.';
 const withNotes=notebookEdition({notebook:n},{locale:'en'}).bodyMarkdown;
 assert.match(withNotes,/### Notes\n\nOrdinary narrative\.\n\n### References/);
});
test('center images use real HTTP references while desktop local image validation is preserved',()=>{
 const n=notebook();n.blocks.push({id:'image',type:'image',state:'ready',text:'https://example.com/image.png',alt:'Fixture',sourceIds:[]});
 assert.match(notebookEdition({notebook:n}).bodyMarkdown,/!\[Fixture\]\(https:/);
 assert.ok(formatErrors(n).some(e=>e.path==='blocks.1.text'));
 n.blocks[1].text='file:///private/image.png';assert.throws(()=>notebookEdition({notebook:n}),/图片/);
});
test('invalid notebook and uncompleted rows retain the output instead of silently falling back',()=>{
 assert.throws(()=>notebookEdition({title:'Legacy',bodyMarkdown:'Lost notes'}),/notebook v2/);
 const n=notebook();n.blocks[0].state='placeholder';assert.throws(()=>notebookEdition({notebook:n}),/未完成/);
 assert.throws(()=>notebookEdition({notebook:{version:2}}),/blocks/);
});
