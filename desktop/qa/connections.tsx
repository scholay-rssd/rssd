// Synthetic fixture only. No native IPC, accounts, credentials, or provider requests.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import ConnectionCenter from '../src/connections/ConnectionCenter';
import {providers,type CenterState,type Connection,type ConnectionService} from '../src/connections/client';
import '@fontsource-variable/inter-tight';
import '../src/styles.css';
const state:CenterState={spaceId:'design-fixture',spaceName:'设计空间 · 测试数据',vault:'隔离测试凭证库',connections:providers.map(p=>({provider:p.id,configured:p.id==='github',status:p.id==='github'?'verified':'unconfigured',target:''}))};
const save=(v:Connection)=>{state.connections=state.connections.map(c=>c.provider===v.provider?v:c);return v;};
const service:ConnectionService={
 list:async()=>structuredClone(state),
 setEnabled:async(provider,enabled,spaceId)=>{if(spaceId!==state.spaceId)throw Error('工作空间已切换');return save({...state.connections.find(c=>c.provider===provider)!,enabled});},
 save:async(provider,secret,target)=>{await new Promise(r=>setTimeout(r,300));if(secret==='invalid')throw Error('测试：授权无效，现有连接已保留');return save({provider,configured:true,status:'verified',target,checkedAt:new Date().toISOString()});},
 verify:async provider=>save({...state.connections.find(c=>c.provider===provider)!,status:'verified',checkedAt:new Date().toISOString()}),
 disconnect:async provider=>save({provider,configured:false,status:'unconfigured',target:''}),
 browse:async provider=>({items:[{id:'fixture-1',title:provider==='google-books'?'认知与学习 · 示例书库':provider==='figma'?'阅读器首页 · 桌面画板':provider==='github'?'example/reading-workspace':'跨书阅读如何整理引用',kind:provider==='figma'?'画板':'资料',detail:'这是隔离验收数据，用于检查资料预览、长文本和操作状态。不会读取真实账户。',url:'https://example.com/source'}]}),
};
document.documentElement.dataset.palette='frost';
document.documentElement.dataset.mode=new URLSearchParams(location.search).has('light')?'light':'dark';
document.documentElement.dataset.platform='windows';
function Preview(){const[mode,setMode]=useState(document.documentElement.dataset.mode);return <main style={{minHeight:'100vh',background:'var(--paper)',padding:'40px 24px',boxSizing:'border-box',overflow:'auto'}}><div style={{maxWidth:960,margin:'0 auto',padding:'36px',background:'var(--panel-2)',borderRadius:16,boxSizing:'border-box'}}><header style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:26}}><h1 style={{font:'600 24px var(--ui)',margin:0}}>连接</h1><button style={{background:'transparent',border:0,color:'var(--muted)',cursor:'pointer'}} onClick={()=>{const next=mode==='dark'?'light':'dark';document.documentElement.dataset.mode=next;setMode(next);}}>切换明暗</button></header><ConnectionCenter service={service} compact/></div></main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
