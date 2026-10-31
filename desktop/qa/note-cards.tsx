// Browser QA only: the harness supplies every native response. No native data is opened.
import {createRoot} from 'react-dom/client';
import {nativeTransport} from '../src/lib/nativeCore';
import {useState} from 'react';
import NoteCardsPreview from '../src/editorial/NoteCardsPreview';
import '../src/styles.css';
import '../src/workspace.css';
declare global {interface Window{noteCardsFixture:{html:string};noteCardsInvoke:(command:string,args:unknown)=>Promise<unknown>}}
nativeTransport.invoke=async<T,>(command:string,args?:unknown)=>await window.noteCardsInvoke(command,args) as T;
document.documentElement.dataset.mode=new URLSearchParams(location.search).get('dark')?'dark':'light';
function Fixture(){const [pane,setPane]=useState('notes');return <main style={{height:'100vh',display:'flex',flexDirection:'column',padding:12,background:'var(--paper)'}}><header style={{display:'flex',gap:16,alignItems:'center',padding:'10px 8px 18px',fontSize:13}}><strong style={{marginRight:'auto'}}>作品 · 图文笔记验收</strong><button onClick={()=>setPane('wechat')}>公众号预览</button><button onClick={()=>setPane('notes')}>图文笔记预览</button></header>{pane==='notes'?<NoteCardsPreview articleId="qa-only" html={window.noteCardsFixture.html}/>:<p>隔离验收：点击图文笔记预览继续。</p>}</main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
