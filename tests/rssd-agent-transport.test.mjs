import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {produceCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';

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
 const value={title:'Fixture article',bodyMarkdown:'Full researched body',metadata:{}};
 send({method:'session/update',params:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(value)}}}});
 send({id:prompt.id,result:{stopReason:'end_turn'}});}
 });
 `);
 const edition=await produceCenterEdition({directory,agentId:'fixture',locale:'en',claim:{title:'Synthetic task',payload:{brief:'Test only',policy:{instructions:'Frozen section rules'}}},writingPolicy:{version:'frozen-v1',instructions:'Frozen common rules'}},{registry:{launch:async()=>({command:process.execPath,args:[script],env:{}})},timeoutMs:10000});
 assert.equal(edition.bodyMarkdown,'Full researched body');
 const prompt=await readFile(join(directory,'en.prompt.txt'),'utf8');assert.match(prompt,/frozen-v1/);assert.match(prompt,/Frozen common rules/);assert.match(prompt,/Frozen section rules/);
 assert.match(await readFile(join(directory,'en.agent-output.txt'),'utf8'),/Full researched body/);
});
