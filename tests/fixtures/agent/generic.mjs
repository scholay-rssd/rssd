import {createInterface} from 'node:readline';
let model='alpha',pending;
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
const result=(id,value)=>send({jsonrpc:'2.0',id,result:value});
const config=()=>({configOptions:[{id:'model',type:'select',category:'model',currentValue:model,options:[{value:'alpha',name:'Alpha'},{value:'beta',name:'Beta'}]}]});
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.id===999&&!m.method){send({jsonrpc:'2.0',method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'model='+model+'; permission='+m.result?.outcome?.outcome}}}});result(pending,{stopReason:'end_turn'});return;}
 if(m.method==='initialize')result(m.id,{protocolVersion:1,agentCapabilities:{loadSession:true,promptCapabilities:{image:true}},authMethods:[]});
 else if(m.method==='session/new'||m.method==='session/load')result(m.id,{sessionId:m.params.sessionId||'generic-session',...config()});
 else if(m.method==='session/set_config_option'){model=m.params.value;result(m.id,config());}
 else if(m.method==='session/prompt'){pending=m.id;if(m.params.prompt[0].text.endsWith('hold'))return;send({jsonrpc:'2.0',id:999,method:'session/request_permission',params:{toolCall:{toolCallId:'read',title:'mcp.scholay-workbench.task_read',kind:'other'},options:[{optionId:'one',kind:'allow_once',name:'Allow'}]}});}
 else if(m.method==='session/cancel')result(pending,{stopReason:'cancelled'});
 else result(m.id,{});
});
process.stdin.on('end',()=>process.exit());
