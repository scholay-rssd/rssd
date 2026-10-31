// Synthetic, memory-only fixture. Every native command is intercepted; no user files or publications.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {marked} from 'marked';
import type {WebsiteDraftDetail} from '../src/publications/websitePublishing';
import '../src/styles.css';
import '../src/workspace.css';
const id='qa-responsive-editor',metadata={date:'2026-10-20',summary:'隔离界面验收：编辑、预览、开关与后台状态。',author:'测试',category:'新闻聚合'};
let markdown='# 稿件编辑交互验收\n\n'+Array.from({length:24},(_,i)=>`## 第 ${i+1} 段\n\n这是一段合成的验收文字。切换编辑与预览应保留滚动位置、编辑记录和清晰的操作反馈。`).join('\n\n');
let revision=1,statusReads=0;
let detail:WebsiteDraftDetail={id,title:'稿件编辑交互验收',canonicalPath:'articles/qa/正文.md',sourceSha256:'1',metadata,metadataSha256:'meta',stage:'local',stale:false,validation:'',receipt:null,prepared:null,html:String(marked.parse(markdown)),warnings:[]};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const calls:string[]=[];
(window as any).__TAURI_INTERNALS__={invoke:async(command:string,args:any={})=>{
 calls.push(command+':'+args.method);
 if(command==='editorial_call'){
  if(args.method==='draft_read')return {markdown,sha256:String(revision)};
  if(args.method==='draft_save'){await delay(400);markdown=args.params.markdown;detail.sourceSha256=String(++revision);return {markdown,sha256:String(revision)};}
  if(args.method==='draft_preview'){await delay(120);return {html:marked.parse(args.params.markdown??markdown),imageSources:{}};}
 }
 if(command==='website_publish_call'){
  if(args.method==='snapshot')return {connection:{configured:true,origin:'https://example.invalid'},articles:[{id,shortTitle:detail.title,canonicalPath:detail.canonicalPath,batchDate:null,stage:detail.stage,receipt:detail.receipt,preparedAt:null}]};
  if(args.method==='inspect')return structuredClone(detail);
  if(args.method==='prepare'){await delay(650);detail={...detail,stage:'prepared',metadata:args.params.metadata,prepared:{intent:args.params.intent,requestKey:'qa-request',packetSha256:'qa-packet',sourceSha256:String(revision),preparedAt:new Date().toISOString(),expectedVersion:0,title:detail.title,metadata:args.params.metadata,assetCount:0}};}
  else if(args.method==='publish'||args.method==='save_cloud'){await delay(600);statusReads=0;detail={...detail,stage:args.method==='save_cloud'?'draft_saved':'queued',receipt:{requestKey:'qa-request',...(args.method==='publish'?{job:{id:'qa-job',status:'queued'}}:{})}};}
  else if(args.method==='status'){await delay(700);const done=++statusReads>1;detail={...detail,stage:done?'published':'running',receipt:{requestKey:'qa-request',publicReadback:done,job:{id:'qa-job',status:done?'success':'running'}}};}
  else throw Error('隔离验收未实现该操作：'+args.method);
  return structuredClone(detail);
 }
 throw Error('隔离验收阻止外部操作：'+command);
}};
const {default:WebsitePublisher}=await import('../src/publications/WebsitePublisher');
await import('../src/editorial/content-library.css');
document.documentElement.dataset.mode='light';document.documentElement.dataset.palette='paper';
function Fixture(){const [narrow,setNarrow]=useState(false),[dark,setDark]=useState(false);
 return <div style={{height:'100vh',display:'flex',flexDirection:'column',background:'var(--bg)',color:'var(--ink)'}}>
  <header style={{height:44,padding:8,display:'flex',gap:12,alignItems:'center'}}><strong>稿件编辑 · 隔离验收</strong><button onClick={()=>setNarrow(!narrow)}>切换窄屏</button><button onClick={()=>{document.documentElement.dataset.mode=dark?'light':'dark';setDark(!dark);}}>切换明暗</button></header>
  <div className="content-library" style={{display:'block',flex:1,minHeight:0,width:narrow?'560px':'100%',maxWidth:'100%',margin:'auto'}}><section className="work-detail" style={{width:'100%',height:'100%'}}><WebsitePublisher active embedded editable openRequest={{id,nonce:1,mode:'edit'}} onOpenDraft={()=>{}}/></section></div>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
