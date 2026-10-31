import {spawn} from 'node:child_process';
import {agentEnvironment,validAuthUrl} from './agent-registry.mjs';
// Login is independent of a manuscript. Never create an empty task merely to
// configure an account, and never stream arbitrary CLI output into the UI.
export class AgentManager{
 constructor(registry,emit){this.registry=registry;this.emit=emit;this.logins=new Map();}
 async login(id){
  if(this.logins.has(id))return {started:true};
  const attempt={child:null};this.logins.set(id,attempt);
  try{
  const a=await this.registry.get(id);
  if(this.logins.get(id)!==attempt)return {started:false,cancelled:true};
  if(!a.loginArgs)return {manual:true,command:a.loginCommand||a.command,docs:a.docs||'',note:a.authNote||'请在终端完成官方 CLI 登录，再检查连接。'};
  const launch=await this.registry.launch(id,{login:true});
  if(this.logins.get(id)!==attempt)return {started:false,cancelled:true};
  const child=spawn(launch.command,launch.args,{env:agentEnvironment({...launch.env,NO_OPEN_BROWSER:'1'}),windowsHide:true,stdio:['ignore','pipe','pipe']});
  attempt.child=child;let buffer='',url='',code='';
  const scan=part=>{if(this.logins.get(id)!==attempt)return;buffer=(buffer+part.toString().replace(/\x1b\[[0-9;]*m/g,'')).slice(-12000);const found=[...buffer.matchAll(/https:\/\/[^\s<>"']+/g)].map(m=>validAuthUrl(m[0],a)).find(Boolean);const foundCode=id==='codex'?buffer.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0]:undefined;if(found||foundCode){url=found||url;code=foundCode||code;this.emit({type:'agent_auth',agentId:id,url,code,status:'waiting'});}};
  child.stdout.on('data',scan);child.stderr.on('data',scan);
  const timer=setTimeout(()=>child.kill(),10*60*1000);timer.unref();
  const ended=(status)=>{clearTimeout(timer);if(this.logins.get(id)!==attempt)return;this.logins.delete(id);this.emit({type:'agent_auth',agentId:id,status,url:'',code:''});};
  child.on('error',()=>ended('failed'));child.on('exit',code=>ended(code===0?'complete':'failed'));
  return {started:true};
  }finally{if(!attempt.child&&this.logins.get(id)===attempt)this.logins.delete(id);}
 }
 cancel(id){const attempt=this.logins.get(id);if(attempt){this.logins.delete(id);attempt.child?.kill();this.emit({type:'agent_auth',agentId:id,status:'cancelled',url:'',code:''});}return {ok:true};}
 close(){for(const id of this.logins.keys())this.cancel(id);}
}
