import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCenterEdition,produceCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';
import {editorialContract} from '../scripts/rssd-editorial-contract.mjs';
const mountedSkills={snapshotHash:'a'.repeat(64),skills:[{id:'site-writing',version:'fixture-v1',contentHash:'b'.repeat(64),content:'Fixture domain rules'}]};
const fakeSkillSnapshot=async()=>mountedSkills;

test('progress text before the final article JSON is retained separately from the article',()=>{
 const article={notebook:{version:2,kind:'article',title:'Fixture',skills:[],fields:{},sources:[],blocks:[{id:'body',type:'paragraph',state:'ready',text:'Article body',sourceIds:[]}]},metadata:{}};
 const preface='Warning: Model metadata for `gpt-6.1-terra` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.\n\n我会核对官方资料，并区分正文与私有备注。';
 assert.match(parseCenterEdition(preface+JSON.stringify(article),{}).bodyMarkdown,/Article body/);
 assert.throws(()=>parseCenterEdition(preface+JSON.stringify(article)+'\nUnrelated trailing text',{}),/完整的文章 JSON/);
 assert.throws(()=>parseCenterEdition('unexpected {not-json}\n'+JSON.stringify(article),{}),/完整的文章 JSON/);
});

test('the production adapter negotiates ACP, freezes policy and denies mutation permissions',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-acp-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const script=join(directory,'fixture.cjs');
 await writeFile(script,`
 const {createInterface}=require('node:readline');
 const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');let prompt;
 createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
 if(m.method==='initialize'){if(m.params.clientCapabilities.terminal!==false)throw Error('terminal enabled');send({id:m.id,result:{protocolVersion:1}});}
 if(m.method==='session/new')send({id:m.id,result:{sessionId:'fixture'}});
 if(m.method==='session/prompt'){prompt=m;
 send({id:900,method:'session/request_permission',params:{sessionId:'fixture',toolCall:{kind:'edit'},options:[{kind:'allow_once',optionId:'yes'}]}});}
 if(m.id===900){if(m.result.outcome.outcome!=='cancelled')throw Error('write allowed');
 send({id:901,method:'session/request_permission',params:{sessionId:'fixture',toolCall:{kind:'search'},options:[{kind:'allow_once',optionId:'yes'}]}});}
 if(m.id===901){if(m.result.outcome.optionId!=='yes')throw Error('search denied');
 const value={notebook:{version:2,kind:'article',title:'Fixture article',skills:[],fields:{},sources:[{id:'s',title:'Evidence',url:'https://example.org/evidence',summary:'Evidence',acquiredVia:'web',reviewed:false}],blocks:[{id:'body',type:'paragraph',state:'ready',text:'Full researched body',sourceIds:['s']}],blockNotes:{body:{notes:{verification:'Private verification'}}}},metadata:{}};
 send({method:'session/update',params:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(value)}}}});
 send({id:prompt.id,result:{stopReason:'end_turn'}});}
 });
 `);
 const brief=editorialContract({siteId:'legis',contentMode:'documentation',editorialRules:['保留法域与现行有效日期']});
 const edition=await produceCenterEdition({directory,agentId:'fixture',locale:'en',claim:{title:'Synthetic task',payload:{brief,policy:{instructions:'Frozen section rules'}}},imageTranslationInstructions:'Fixture frozen per-image suffix',writingPolicy:{version:'frozen-v1',instructions:'Frozen common rules'}},{registry:{launch:async()=>({command:process.execPath,args:[script],env:{}})},skillSnapshot:fakeSkillSnapshot,timeoutMs:10000});
 assert.match(edition.bodyMarkdown,/Full researched body/);assert.doesNotMatch(edition.bodyMarkdown,/Private verification/);
 assert.match(edition.bodyMarkdown,/### References/);assert.doesNotMatch(edition.bodyMarkdown,/参考文献/);
 assert.equal(edition.metadata.notebook.blockNotes.body.notes.verification,'Private verification');
 assert.equal(edition.metadata.notebook.modelSignatures[0].agentId,'fixture');
 assert.equal(edition.metadata.notebook.modelSignatures[0].modelId,null);
 const prompt=await readFile(join(directory,'en.prompt.txt'),'utf8');assert.match(prompt,/frozen-v1/);assert.match(prompt,/Frozen common rules/);assert.match(prompt,/Frozen section rules/);assert.match(prompt,/技术文档/);assert.match(prompt,/保留法域与现行有效日期/);assert.match(prompt,/本次只生成 en 一种语言/);assert.match(prompt,/Fixture domain rules/);assert.match(prompt,/Fixture frozen per-image suffix/);assert.equal(edition.metadata.notebook.modelSignatures[0].writingSkillSnapshotHash,mountedSkills.snapshotHash);
 assert.match(await readFile(join(directory,'en.agent-output.txt'),'utf8'),/Full researched body/);
});

test('pilot model mismatch stops before sending the writing prompt',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-acp-model-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const script=join(directory,'fixture.cjs'),marker=join(directory,'prompt-sent');
 await writeFile(script,`
 const fs=require('node:fs'),{createInterface}=require('node:readline');
 const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');
 createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});
 if(m.method==='session/new')send({id:m.id,result:{sessionId:'fixture',models:{currentModelId:'other-model'}}});
 if(m.method==='session/prompt')fs.writeFileSync(${JSON.stringify(marker)},'unexpected');
 });`);
 let checked=false;
 await assert.rejects(produceCenterEdition({directory,agentId:'codex',expectedModel:'gpt-6.1-terra',locale:'zh-CN',claim:{title:'Test',payload:{brief:'',policy:{}}}},{registry:{launch:async()=>({command:process.execPath,args:[script],env:{RSSD_CENTER_TOKEN:'sensitive'}})},skillSnapshot:fakeSkillSnapshot,timeoutMs:10000,pilotEnvironment:async(env,{cwd})=>{assert.equal(env.RSSD_CENTER_TOKEN,undefined);assert.equal(cwd,directory);checked=true;return env;}}),/未确认使用 gpt-6.1-terra/);
 assert.equal(checked,true);
 await assert.rejects(readFile(marker),{code:'ENOENT'});
});
