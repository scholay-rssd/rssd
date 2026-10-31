// Synthetic IPC only. No native accounts, processes, models or user documents.
import {createRoot} from 'react-dom/client';
import WritingAgentSettings from '../src/agents/WritingAgentSettings';
import AgentSelector from '../src/agents/AgentSelector';
import '@fontsource-variable/inter-tight';
import '../src/styles.css';
document.documentElement.dataset.mode=new URLSearchParams(location.search).has('light')?'light':'dark';
document.documentElement.dataset.palette='frost';
const agents=['Cursor','Codex','Claude Code','Hermes','Gemini CLI','GitHub Copilot','OpenCode','Kimi CLI','Qwen Code'].map((name,i)=>({id:['cursor','codex','claude','hermes','gemini','copilot','opencode','kimi','qwen'][i],name,command:name.toLowerCase().split(' ')[0],args:['acp'],available:i<3,enabled:true,...(i===1||i===2?{adapter:'fixture'}:{})}));
let defaultAgentId='codex',agentId='codex',model='balanced';
const status=()=>({agentId,connected:true,history:[],configuration:{configOptions:[{id:'model',category:'model',currentValue:model,options:[{value:'balanced',name:'标准模型'},{value:'deep',name:'深度模型'}]}]}});
Object.defineProperty(window,'__TAURI_EVENT_PLUGIN_INTERNALS__',{value:{unregisterListener:()=>{}}});
Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command:string,args:any={})=>{
 if(command==='plugin:event|listen')return 1;if(command==='plugin:event|unlisten')return;
 if(command!=='cursor_agent_call')throw Error('Fixture blocked '+command);
 const p=args.params||{};
 if(args.method==='agent_list')return structuredClone({agents,defaultAgentId});
 if(args.method==='status'||args.method==='connect')return status();
 if(args.method==='agent_select'){agentId=p.agentId;return {};}
 if(args.method==='configure'){model=p.value;return {};}
 if(args.method==='agent_default'){defaultAgentId=p.agentId;return {};}
 if(args.method==='agent_check')return {status:'ACP 协议就绪（合成数据）'};
 if(args.method==='agent_login')return {manual:true,command:'example-agent login',note:'隔离测试授权说明，不执行真实登录'};
 if(args.method==='agent_save'){const item=agents.find(a=>a.id===p.id);if(item)Object.assign(item,p);else agents.push({...p,available:true});return {};}
 if(args.method==='agent_remove'){const i=agents.findIndex(a=>a.id===p.agentId);if(i>=0)agents.splice(i,1);return {};}
 throw Error('Fixture blocked '+args.method);
}}});
createRoot(document.getElementById('root')!).render(<main style={{height:'100vh',overflow:'auto',background:'var(--paper)',padding:'24px',boxSizing:'border-box'}}><div style={{maxWidth:820,margin:'0 auto'}}><div style={{marginBottom:24,padding:16,border:'1px solid var(--hair)',borderRadius:10}}><p style={{color:'var(--muted)',fontSize:12}}>会话输入区 · 合成验收</p><AgentSelector taskId="fixture"/></div><WritingAgentSettings/></div></main>);
