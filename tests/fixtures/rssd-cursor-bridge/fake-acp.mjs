import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
let promptId,sessionId,mcp,mcpSequence=0;const waits=new Map();
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const answer=(id,result)=>send({id,result});
const update=update=>send({method:'session/update',params:{sessionId,update}});
function mcpCall(method,params={}){const id=++mcpSequence;return new Promise((resolve,reject)=>{waits.set(id,{resolve,reject});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
async function setup(server){const env={...process.env,...Object.fromEntries(server.env.map(v=>[v.name,v.value]))};mcp=spawn(server.command,server.args,{env,stdio:['pipe','pipe','ignore']});createInterface({input:mcp.stdout}).on('line',line=>{const v=JSON.parse(line),p=waits.get(v.id);if(p){waits.delete(v.id);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}});await mcpCall('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic',version:'1'}});}
const expected=new Map();
function permission(id,title,kind,rawInput){return new Promise((resolve,reject)=>{expected.set(id,{resolve,reject});send({id,method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'tool-'+id,title,kind,rawInput},options:[{optionId:'once',kind:'allow_once'}]}});});}
async function run(m){
 promptId=m.id;const blocks=m.params.prompt,text=blocks[0].text,match=text.match(/taskId=([\w-]+)，runId=([\w-]+)/);if(!match)throw Error('missing scope');
 if(text.includes('SLOW TEST'))await new Promise(resolve=>setTimeout(resolve,1500));
 const image=blocks.find(b=>b.type==='image');if(!image)throw Error('missing actual reference attachment');
 const refHash=createHash('sha256').update(Buffer.from(image.data,'base64')).digest('hex');
 const listed=await mcpCall('tools/list');if(listed.tools.map(t=>t.name).sort().join(',')!=='asset_register,task_read')throw Error('unexpected MCP capabilities');
 for(const [id,title,kind,raw,want] of [[101,'Generate Image','other',{_toolName:'GenerateImage'},'selected'],[102,'Execute arbitrary shell','execute',{command:'touch /tmp/must-not-run'},'cancelled'],[103,'Edit private file','edit',{path:'/tmp/must-not-edit'},'cancelled'],[104,'scholay-workbench-asset_register: asset_register','other',{},'selected'],[105,'Shell(ls) canary','execute',{command:'ls > '+join(process.cwd(),'permission-canary.txt')},'cancelled']]){
  const decision=await permission(id,title,kind,raw);if(decision?.outcome?.outcome!==want)throw Error('unexpected permission decision '+id);
  update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:`fixture-permission-${id}=${want}\n`}});
 }
 update({sessionUpdate:'tool_call',toolCallId:'image',title:'Generate Image',status:'completed'});
 const reply=await mcpCall('tools/call',{name:'asset_register',arguments:{taskId:match[1],runId:match[2],path:join(process.cwd(),'synthetic.png'),name:'Synthetic fixture'}});
 if(reply.isError)throw Error('asset registration failed');
 update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:`fixture-reference-sha256=${refHash}\n`}});
 answer(promptId,{stopReason:'end_turn'});
}
createInterface({input:process.stdin}).on('line',line=>{void(async()=>{const m=JSON.parse(line);
 if(m.id!==undefined&&!m.method){const p=expected.get(m.id);if(p){expected.delete(m.id);p.resolve(m.result);}return;}
 if(m.method==='initialize')answer(m.id,{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}});
 else if(m.method==='session/new'){sessionId='fixture-session';await setup(m.params.mcpServers[0]);answer(m.id,{sessionId,configOptions:[{id:'model',category:'model',currentValue:'auto',options:[{name:'Auto',value:'auto'}]}]});}
 else if(m.method==='session/prompt')await run(m);
 else if(m.method==='session/cancel')answer(promptId,{stopReason:'cancelled'});
 else answer(m.id,{});
 })().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;process.exit();});});
process.stdin.on('end',()=>{mcp?.stdin.end();process.exit();});
