// Synthetic, memory-only fixture. Native calls are intercepted before loading
// the editor; no manuscript, credential or publication service is accessed.
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Editor} from '@tiptap/core';
import '../src/styles.css';
import '../src/editorial/notebook-workflow.css';

const image = await fetch('/rssd-icon.png').then(response=>response.blob()).then(blob=>new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);
}));
(window as any).__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
  if(command==='editorial_call'&&args.method==='draft_preview')return {imageSources:{'assets/fixture.png':image},warnings:[]};
  throw Error('Isolated editor fixture blocked native call: '+command);
}};
const {default:EditorialRichEditor}=await import('../src/editorial/EditorialRichEditor');
document.documentElement.dataset.mode='light';document.documentElement.dataset.palette='paper';
document.documentElement.dataset.platform=/Mac/.test(navigator.platform)?'mac':'other';

function Fixture(){
  const [text,setText]=useState('图片前的合成正文。\n\n![隔离图片](assets/fixture.png)\n\n图片后的合成正文。');
  const [tick,setTick]=useState(0),[running,setRunning]=useState(true),[dark,setDark]=useState(false);
  const host=useRef<HTMLDivElement>(null),counts=useRef({viewUpdates:0,srcChanges:0,imageRemovals:0,imageLoads:0});
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>setTick(value=>value+1),300);return()=>clearInterval(timer);},[running]);
  useEffect(()=>{
    const node=host.current!;
    const observer=new MutationObserver(records=>{
      for(const record of records){
        if(record.type==='attributes'&&record.target instanceof HTMLImageElement)counts.current.srcChanges++;
        for(const removed of record.removedNodes)if(removed instanceof Element&&(removed.tagName==='IMG'||removed.querySelector('img')))counts.current.imageRemovals++;
      }
    });
    observer.observe(node,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
    const load=(event:Event)=>{if(event.target instanceof HTMLImageElement)counts.current.imageLoads++;};
    node.addEventListener('load',load,true);
    const timer=setInterval(()=>{
      const editor=(node.querySelector('.notebook-prosemirror') as HTMLElement&{editor?:Editor})?.editor;
      if(!editor||(editor.view as any).__imageQaObserved)return;
      const update=editor.view.updateState.bind(editor.view);
      (editor.view as any).__imageQaObserved=true;
      editor.view.updateState=state=>{counts.current.viewUpdates++;update(state);};
    },50);
    return()=>{observer.disconnect();node.removeEventListener('load',load,true);clearInterval(timer);};
  },[]);
  return <div className="task-workbench" style={{height:'100vh',overflow:'auto',background:'var(--bg)',color:'var(--ink)'}}>
    <header style={{position:'sticky',top:0,zIndex:100,background:'var(--reader)',padding:12,display:'flex',gap:12,flexWrap:'wrap'}}>
      <strong>编辑图片稳定性 · 合成稿件</strong>
      <button onClick={()=>setRunning(value=>!value)}>{running?'暂停后台刷新':'开启后台刷新'}</button>
      <button onClick={()=>{counts.current={viewUpdates:0,srcChanges:0,imageRemovals:0,imageLoads:0};setTick(value=>value+1);}}>重置计数</button>
      <button onClick={()=>{document.documentElement.dataset.mode=dark?'light':'dark';setDark(!dark);}}>切换明暗</button>
      <output aria-label="稳定性计数">刷新 {tick} · 视图更新 {counts.current.viewUpdates} · 图片移除 {counts.current.imageRemovals} · src 变化 {counts.current.srcChanges} · 图片加载 {counts.current.imageLoads}</output>
    </header>
    <section ref={host} className="notebook-workflow" style={{display:'block',maxWidth:760,margin:'0 auto'}}>
      <div className="notebook-paper"><EditorialRichEditor articleId="qa-editor-image" text={text} disabled={false} onChange={setText}/></div>
    </section>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
