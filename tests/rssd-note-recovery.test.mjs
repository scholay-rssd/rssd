import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {persistGenerationEvidence,recoverPersistedCenterEdition} from '../scripts/rssd-center-generation-evidence.mjs';

const context={origin:'https://center.example',workspaceId:'metho',sectionId:'statistics',agentId:'cursor',demandId:'demand-1',generation:1,workerId:'device-1'};
const signature={runId:'run-1',agentId:'cursor',agentName:'Cursor',startedAt:'2026-11-10T00:00:00Z',completedAt:'2026-11-10T00:01:00Z',action:'write',status:'completed',modelId:'auto',modelName:'Auto'};
const draft=()=>({notebook:{version:2,kind:'article',title:'示例文章',skills:[],fields:{},sources:[],blocks:[
 {id:'first',type:'paragraph',state:'ready',text:'公开正文一。',sourceIds:[]},
 {id:'second',type:'paragraph',state:'ready',text:'公开正文二。',sourceIds:[]},
],internalNotes:{verification:'整篇私有说明'},blockNotes:{first:{supplement:'第一条私有补充',verification:'第一条核对'},second:{notes:{writing:'已有的私有备注'}}},modelSignatures:[{agentId:'forged'}]},summary:'摘要'});

async function saved(t,value){
 const directory=await mkdtemp(join(tmpdir(),'rssd-note-recovery-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const output=JSON.stringify(value);await writeFile(join(directory,'zh-CN.agent-output.txt'),output);
 await persistGenerationEvidence({directory,locale:'zh-CN',output,signature,...context});
 return {directory,output};
}

test('recoverable flat notes keep the raw output, private text, and device signature',async t=>{
 const {directory,output}=await saved(t,draft());
 const result=await recoverPersistedCenterEdition({directory,locale:'zh-CN',...context});
 assert.equal(result.recovered,true);assert.deepEqual(result.repair.blockIds,['first']);
 assert.deepEqual(result.edition.metadata.notebook.blockNotes.first.notes,{supplement:'第一条私有补充',verification:'第一条核对'});
 assert.deepEqual(result.edition.metadata.notebook.blockNotes.second.notes,{writing:'已有的私有备注'});
 assert.deepEqual(result.edition.metadata.notebook.modelSignatures,[signature]);
 assert.doesNotMatch(result.edition.bodyMarkdown,/私有/);
 assert.equal(await readFile(join(directory,'zh-CN.agent-output.txt'),'utf8'),output);
 assert.deepEqual(JSON.parse(await readFile(join(directory,'zh-CN.normalization.json'),'utf8')),result.repair);
 assert.deepEqual((await recoverPersistedCenterEdition({directory,locale:'zh-CN',...context})).repair,result.repair);
});

test('ambiguous or mixed invalid note structures remain blocked without a repair record',async t=>{
 const value=draft();value.notebook.blockNotes.second={supplement:'保留',unexpected:'不可猜测'};
 const {directory,output}=await saved(t,value);
 await assert.rejects(recoverPersistedCenterEdition({directory,locale:'zh-CN',...context}),{code:'generation_unrecoverable'});
 assert.equal(await readFile(join(directory,'zh-CN.agent-output.txt'),'utf8'),output);
 await assert.rejects(readFile(join(directory,'zh-CN.normalization.json')),{code:'ENOENT'});
});
