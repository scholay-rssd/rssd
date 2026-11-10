import {createInterface} from 'node:readline';
let promptId,permissionId;
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
const result=(id,value)=>send({jsonrpc:'2.0',id,result:value});
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.id===1999999&&!m.method){result(promptId,{stopReason:'end_turn'});return;}
 if(m.id===permissionId&&!m.method){
  send({jsonrpc:'2.0',method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Permission outcome: '+m.result?.outcome?.outcome}}}});
  result(promptId,{stopReason:'end_turn'});return;
 }
 if(m.method==='initialize')setTimeout(()=>result(m.id,{agentCapabilities:{}}),150);
 else if(m.method==='session/new'||m.method==='session/load')result(m.id,{sessionId:'fixture-session',configOptions:[{id:'model',category:'model',currentValue:'auto',options:[{name:'Auto',value:'auto'}]}]});
 else if(m.method==='session/prompt'){
  promptId=m.id;
  send({jsonrpc:'2.0',method:'session/update',params:{update:{sessionUpdate:'tool_call',toolCallId:'fixture-tool',title:'Fixture tool',status:'in_progress'}}});
  const text=m.params.prompt[0].text;
  if(text.endsWith('notebook:image:generated'))send({jsonrpc:'2.0',id:1999999,method:'cursor/generate_image',params:{data:'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=',description:'合成回调图片'}});
  if(text.endsWith('permission:auto:mcp')||text.endsWith('permission:deny:execute')){
   permissionId=1000000;const allowed=text.endsWith('permission:auto:mcp');
   send({jsonrpc:'2.0',id:permissionId,method:'session/request_permission',params:{toolCall:{toolCallId:'fixture-tool',title:allowed?'scholay-workbench-task_read: task_read':'Unapproved execution',kind:allowed?'other':'execute',rawInput:allowed?{}:{command:'touch /tmp/unapproved-cursor-command'}},options:[{optionId:'once',kind:'allow_once',name:'Allow once'}]}});
  }
  if(m.params.prompt[0].text.endsWith('complete'))result(promptId,{stopReason:'end_turn'});
  if(m.params.prompt[0].text.includes('图库无文件验收'))result(promptId,{stopReason:'end_turn'});
  if(m.params.prompt[0].text.endsWith('crash'))process.exit(1);
 }else if(m.method==='session/cancel')result(promptId,{stopReason:'cancelled'});
 else result(m.id,{});
});
process.stdin.on('end',()=>process.exit());
