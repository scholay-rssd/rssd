// Isolated synthetic data only. No real agent, files, network or publication calls.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import '../src/styles.css';
import '../src/editorial/content-workspace.css';
import '../src/editorial/structured-workflow.css';
const callbacks=new Map<number,(event:any)=>void>();let callbackId=0,eventId=0;
const configuration={configOptions:[{id:'model',category:'model',name:'模型',currentValue:'model-0',options:Array.from({length:43},(_,i)=>({value:'model-'+i,name:'测试模型 '+i}))}]};
const history=Array.from({length:30},(_,i)=>({id:String(i),role:'assistant',text:`## 第 ${i+1} 条验收消息\n\n`+'这是一段合成长对话，用于确认执行记录滚动。\n\n'.repeat(6)}));
const state={connected:true,busy:false,status:'隔离验收',sessionId:'fixture',configuration,history,pending:[]};
let listener=0;
const emit=(payload:any)=>callbacks.get(listener)?.({event:'cursor-agent-event',id:eventId++,payload:{...payload,taskId:'qa'}});
Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{transformCallback:(fn:any)=>{callbacks.set(++callbackId,fn);return callbackId;},unregisterCallback:(id:number)=>callbacks.delete(id),invoke:async(command:string,args:any)=>{
 if(command==='plugin:event|listen'){listener=args.handler;return 1;}
 if(command==='plugin:event|unlisten')return;
 if(command==='cursor_agent_call'){
  if(args.method==='status')return structuredClone(state);
  if(args.method==='configure'){await new Promise(r=>setTimeout(r,1500));configuration.configOptions[0].currentValue=args.params.value;emit({type:'configuration',configuration:structuredClone(configuration)});return {configuration:structuredClone(configuration)};}
 }
 throw Error('隔离验收不执行 '+command);
}}});
const {default:CursorAgentPane}=await import('../src/editorial/CursorAgentPane');
function Fixture(){const busy=false;const [streaming,setStreaming]=useState(false),[dark,setDark]=useState(false);return <div style={{display:'flex',height:'100vh'}}>
 <section style={{flex:1,padding:30}}><h1>Cursor 滚动隔离验收</h1><p>30 条长记录 · 实时流式追加</p><p data-testid="workbench-status">稿件区：{busy?'已锁定':'可操作'}</p><button disabled={busy} onClick={()=>{document.documentElement.dataset.mode=dark?'light':'dark';setDark(!dark);}}>切换明暗</button> <button disabled={streaming} onClick={()=>{setStreaming(true);state.busy=true;emit({type:'state',...structuredClone(state)});let i=0;const timer=setInterval(()=>{const text='新增流式段落 '+(++i)+'。\n\n';history[29].text+=text;emit({type:'chunk',id:'29',text});if(i===180){clearInterval(timer);state.busy=false;emit({type:'state',...structuredClone(state)});setStreaming(false);}},80);}}>追加流式文字</button><p>仅使用合成内容；不连接真实服务。</p></section>
 <div style={{width:470,height:'100%',borderLeft:'1px solid var(--hair)'}}><CursorAgentPane active taskId="qa" onChanged={()=>{}} workflowRail={{collapsed:false,onToggle:()=>{}}}/></div>
 </div>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
