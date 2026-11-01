// Synthetic browser-only fixture. All IPC is intercepted; no device or server state is used.
import {createRoot} from 'react-dom/client';
import {nativeTransport} from '../src/lib/nativeCore';
import '../src/styles.css';
import '@fontsource-variable/inter-tight';
const query=new URLSearchParams(location.search);
document.documentElement.dataset.mode=query.get('mode')==='light'?'light':'dark';
const writable=query.get('staged')!=='1';
const work={id:'fixture-work',workspaceId:'academic',sectionId:'news',editions:[{locale:'zh-CN',revision:1,payload:{title:'开放数据与科研工具',bodyMarkdown:'# 开放数据\n\n这是一份用于界面验收的合成稿件。'}}]};
const drafts=new Map<string,any>();
nativeTransport.invoke=(async(command:string,args:any)=>{
 if(command!=='rssd_center_call')throw Error('Fixture blocks native calls');
 switch(args.method){
 case 'status':return {configured:true,origin:'https://center.example.invalid',agents:[{id:'fixture',name:'测试智能体',enabled:true,available:true}],outbox:[],drafts:[]};
 case 'auth_status':return {state:'idle'};
 case 'registry':return {workspaces:[{id:'academic',name:'今日学术',writable,sections:[{id:'news',name:'研究进展'}]}]};
 case 'demands':return query.has('empty')?[]:[{id:'fixture-demand',title:'开放数据与科研工具',state:'queued',payload:{brief:'整理近期研究进展与公开资料。'}}];
 case 'works':return query.has('empty')?[]:Array.from({length:args.params.offset?1:51},(_,i)=>({id:'fixture-'+i,editions:[{title:'开放数据与科研工具 '+(i+1+(args.params.offset||0)),locale:'zh-CN',revision:1}]}));
 case 'publications':return [{id:'fixture-publication',workId:'fixture-work',locale:'zh-CN',revision:1,destinationId:'示例站点',state:'published'}];
 case 'work':return work;
 case 'local_draft':return drafts.get(args.params.workId+':'+args.params.locale)||null;
 case 'save_local':drafts.set(args.params.work.id+':'+args.params.locale,args.params);return {saved:true};
 default:throw Error('Fixture blocks mutations: '+args.method);
 }
}) as typeof nativeTransport.invoke;
const {default:CenterWorkspace}=await import('../src/center/CenterWorkspace');
createRoot(document.getElementById('root')!).render(<CenterWorkspace active/>);
