import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {agentEnvironment} from './agent-registry.mjs';
export async function probeAgent(registry,id,{timeout=20000}={}){
 const launch=await registry.launch(id);
 return new Promise((resolve,reject)=>{
  const child=spawn(launch.command,launch.args,{env:agentEnvironment(launch.env),windowsHide:true,stdio:['pipe','pipe','pipe']});let done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.end();child.kill();error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(Error('协议检查超时，请确认 CLI 可正常启动')),timeout);
  child.stderr.resume();child.on('error',()=>finish(Error('无法启动 '+launch.agent.name)));child.on('exit',()=>finish(Error(launch.agent.name+' 在握手前退出')));
  createInterface({input:child.stdout,crlfDelay:Infinity}).on('line',line=>{try{const m=JSON.parse(line);if(m.id!==1)return;if(m.error)finish(Error(m.error.message||'ACP 握手失败'));else if(m.result)finish(null,{agentId:id,protocolVersion:m.result.protocolVersion,agentInfo:m.result.agentInfo||null,capabilities:m.result.agentCapabilities||{},authMethods:(m.result.authMethods||[]).map(a=>({id:a.id,name:a.name})),status:'协议就绪'});}catch{}});
  child.stdin.on('error',()=>finish(Error('协议连接已关闭')));
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:1,clientInfo:{name:'today',version:'1.0.0'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}}})+'\n');
 });
}
