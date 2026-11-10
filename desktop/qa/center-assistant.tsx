// Isolated visual QA: synthetic history, no native calls and no model/network.
import {createRoot} from 'react-dom/client';
import {nativeTransport} from '../src/lib/nativeCore';
import LocalCenterAssistant from '../src/center/LocalCenterAssistant';
import '../src/styles.css';
import '../src/center/preview/preview.css';
document.documentElement.dataset.mode='dark';document.documentElement.dataset.palette='paper';
let history=[{role:'user',text:'检查研究方法的需求缺口，先不要修改。',at:1},{role:'tool',text:'rssd_overview · 已返回\n（界面测试使用的合成回执）',at:2},{role:'assistant',text:'这是界面测试回复。实际使用时，这里会显示本机智能体读取中心后的结果。',at:3}];
nativeTransport.invoke=async(_command,args:any)=>{
 if(args.method==='assistant_reset')history=[];
 if(args.method==='assistant_send')history=[...history,{role:'user',text:args.params.text,at:Date.now()},{role:'assistant',text:'仅验证界面交互；没有连接中心或调用模型。',at:Date.now()}];
 return {state:'complete',history,message:'隔离界面测试 · 合成数据'} as any;
};
createRoot(document.getElementById('root')!).render(<main className="center-preview" style={{padding:24,minHeight:'100vh'}}><p>隔离界面测试 · 合成数据</p><LocalCenterAssistant agents={[{id:'codex',name:'Codex',available:true,enabled:true},{id:'cursor',name:'Cursor',available:true,enabled:true}]} workspaceIds={['metho']} manage={()=>{}}/></main>);
