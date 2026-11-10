import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
if(process.env.RSSD_CENTER_TOKEN)throw Error('Center credential leaked to model process');
let proxy,number=0;const pending=new Map();
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
const mcp=(method,params={})=>new Promise(resolve=>{const id=++number;pending.set(id,resolve);proxy.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 const m=JSON.parse(line);void(async()=>{let result={};
 if(m.method==='initialize')result={agentCapabilities:{loadSession:true}};
 if(['session/new','session/load'].includes(m.method)){
  const def=m.params.mcpServers[0];proxy=spawn(def.command,def.args,{env:{...process.env,...Object.fromEntries(def.env.map(e=>[e.name,e.value]))},stdio:['pipe','pipe','pipe'],windowsHide:true});proxy.stderr.resume();
  createInterface({input:proxy.stdout}).on('line',line=>{const v=JSON.parse(line);pending.get(v.id)?.(v.result);pending.delete(v.id);});
  await mcp('initialize',{protocolVersion:'2025-11-25'});result={sessionId:'test-session'};
 }
 if(m.method==='session/prompt'){
  const text=m.params.prompt[0].text;
  if(text.endsWith('wait'))return;
  const list=await mcp('tools/list');if(list.tools.some(t=>t.name==='rssd_submit'))throw Error('Unexpected publisher tool');
  const output=await mcp('tools/call',{name:text.endsWith('edit')?'rssd_edit_demand':'rssd_overview',arguments:text.endsWith('edit')?{id:'demand-a',baseGeneration:2,requestId:'model-generated-id',changes:{title:'Updated'}}:{}});
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'test-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(output)}}}});
  result={stopReason:'end_turn'};
 }
 if(m.method==='session/cancel')return;
 if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,result});})();
}
proxy?.kill();
