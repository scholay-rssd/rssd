// Isolated, memory-only QA. All IPC is intercepted; no real drafts, settings,
// accounts, network requests or published content are accessible from this page.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {nativeTransport} from '../src/lib/nativeCore';
import {ACTIVE_SITE,setActiveSite} from '../../scripts/site-profile.mjs';
import {sectionsForSite} from '../../contracts/site-sections.mjs';
import profiles from '../../sites/profiles.json';
import NotebookWorkflow from '../src/editorial/NotebookWorkflow';
import ConnectionCenter from '../src/connections/ConnectionCenter';
import {providers,type Connection} from '../src/connections/client';
import {selectTemplate,stampTemplateBaseline,templateTaskMode} from '../scripts/agent/notebook-templates.mjs';
import {stampNotebook} from '../scripts/agent/notebook.mjs';
import '../src/styles.css';
import '../src/workspace.css';
import '../src/editorial/task-workbench.css';
document.documentElement.dataset.mode='light';document.documentElement.dataset.palette='paper';
const settings=new Map<string,string>(),tasks=new Map<string,any>(),connections=new Map<string,Connection[]>();
function spaceConnections(){if(!connections.has(ACTIVE_SITE.spaceId))connections.set(ACTIVE_SITE.spaceId,providers.map(p=>({provider:p.id,configured:p.id==='github',enabled:p.id==='github'&&ACTIVE_SITE.spaceId===profiles[0].spaceId,status:p.id==='github'?'verified':'unconfigured',target:p.id==='github'?'example/project':''})));return connections.get(ACTIVE_SITE.spaceId)!;}
const bundledSkills=Object.entries(import.meta.glob('../resources/workspace-template/.agents/skills/*/SKILL.md',{query:'?raw',import:'default',eager:true})).map(([path,raw])=>{const content=String(raw),id=path.split('/').at(-2)!;return {id,name:content.match(/^name: *(.+)$/m)?.[1]||id,description:content.match(/^description: *(.+)$/m)?.[1]||'',version:'qa',contentHash:'a'.repeat(64),content};});
function task(){if(!tasks.has(ACTIVE_SITE.spaceId))tasks.set(ACTIVE_SITE.spaceId,{id:ACTIVE_SITE.spaceId,mode:'observation',title:'新的创作',brief:'',days:30,revision:1,stage:'topic',articleId:'draft-'+ACTIVE_SITE.spaceId,workIds:[],board:{titles:[],sections:[]},outline:{blocks:[]},assets:[],ui:{tabs:[]},notebook:{version:2,title:'',kind:'article',skills:[],fields:{},sources:[],groups:[],assets:{},mounts:{templates:[],brands:[],skills:[]},blocks:[]}});return tasks.get(ACTIVE_SITE.spaceId);}
const mock=async(command:string,args:any={})=>{
 if(command==='plugin:event|listen')return 1;if(command==='plugin:event|unlisten')return;
 if(command==='connection_center'){if(args.method==='list')return {spaceId:ACTIVE_SITE.spaceId,spaceName:ACTIVE_SITE.name,vault:'隔离测试',connections:spaceConnections()};if(args.method==='set_enabled'){if(args.expectedSpace!==ACTIVE_SITE.spaceId)throw Error('工作空间已切换');const connection=spaceConnections().find(c=>c.provider===args.provider)!;connection.enabled=args.enabled;return {...connection};}if(args.method==='browse'){if(spaceConnections().find(c=>c.provider===args.provider)?.enabled===false)throw Error('此来源已停用');return {items:[{id:'release-1',title:'项目 v1.0',detail:'隔离的版本说明',kind:'release',url:'https://example.org/project/v1'}]};}throw Error('QA blocked connection mutation');}
 if(command==='get_setting')return settings.get(ACTIVE_SITE.spaceId+':'+args.key)||null;
 if(command==='set_setting'){settings.set(ACTIVE_SITE.spaceId+':'+args.key,args.value);return;}
 if(command==='list_articles')return [{id:1,title:'开源项目的设计与实践',snippet:'项目背景、核心能力、运行方式与参考资料。',url:'https://example.org/project',feedTitle:'示例 RSS',publishedAt:'2026-10-17T08:00:00Z',isStarred:true}];
 if(command!=='cursor_agent_call')throw Error('QA blocked: '+command);
 const p=args.params||{},t=p.taskId?(tasks.get(p.taskId)||task()):task();
 if(args.method==='status')return {connected:false,busy:false,status:'隔离验收',history:t.history||[],pending:[]};
 if(args.method==='notebook_catalog')return {siteId:ACTIVE_SITE.id,sections:sectionsForSite(ACTIVE_SITE),skills:bundledSkills};
 if(args.method==='notebook_brands')return [{id:'brand',name:'个人品牌',description:'关注实用经验与可信信息。',voice:'自然、克制。',version:1,endnotes:[]}];
 if(args.method==='task_get'||args.method==='notebook_open')return structuredClone(t);
 if(args.method==='notebook_template'){
  if(p.expectedRevision!==t.revision)throw Error('CONFLICT');
  if(p.undo){if(t.templateUndo?.revision!==t.revision)throw Error('后续修改不能撤销');t.notebook=t.templateUndo.note;delete t.templateUndo;}
  else{const before=structuredClone(t.notebook),kind=p.template?.mode;const headings=kind==='calendar'?['摘要','正文']:kind==='history'?['事实摘要',ACTIVE_SITE.legacy?'学术意义':'历史意义']:kind==='opensource'?['项目简介',ACTIVE_SITE.legacy?'学术价值':'使用价值']:[];const result=selectTemplate(before,p.template,{spaceId:ACTIVE_SITE.spaceId,makeId:()=>crypto.randomUUID(),headings});t.notebook=stampTemplateBaseline(stampNotebook(result.note,before,{documentId:t.articleId,actor:'template'}));t.mode=templateTaskMode(kind||'observation');t.templateUndo={revision:t.revision+1,note:before};t.templateNotice='模板已更新，已有正文保留。';}
  t.revision++;return structuredClone(t);
 }
 if(args.method==='task_update'){if(p.patch.notebook){t.notebook=stampNotebook(p.patch.notebook,t.notebook,{documentId:t.articleId});t.revision++;}else if(p.patch.ui)t.ui={...t.ui,...p.patch.ui};return structuredClone(t);}
 if(args.method==='notebook_check')return {ready:false,issues:[]};
 if(args.method==='notebook_prompt'){
  const id=crypto.randomUUID(),block={id:crypto.randomUUID(),type:'paragraph',text:'这是隔离验收生成的示例正文。正式正文只有在接受后才更新。',state:'ready',sourceIds:[]};
  t.notebookTurns=[...(t.notebookTurns||[]),{id,text:p.text,status:'ready',createdAt:new Date().toISOString(),context:p.turnContext,items:[{id:'body',kind:'blocks',label:'示例正文',blocks:[block]}],sources:[{id:'demo',title:'来源网页',url:'https://example.org/project',summary:'隔离资料',acquiredVia:'rss',reviewed:false}]}];
  t.history=[...(t.history||[]),{id:id+'u',role:'user',text:p.text,notebookTurnId:id},{id:id+'a',role:'assistant',text:'请查看候选内容，也可以打开 [来源网页](https://example.org/project)。'},{id:id+'t',role:'turn',text:'',status:'已完成',notebookTurnId:id}];t.revision++;return {started:true};
 }
 if(args.method==='notebook_accept'){const turn=t.notebookTurns.find((x:any)=>x.id===p.turnId);for(const item of turn.items)if(!item.accepted&&(!p.itemIds||p.itemIds.includes(item.id))){t.notebook.blocks.push(...item.blocks.map((b:any)=>({...b,locked:true})));item.accepted=true;}t.revision++;return structuredClone(t);}
 throw Error('QA blocked: '+args.method);
};
nativeTransport.invoke=mock as typeof nativeTransport.invoke;
Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:mock,transformCallback:()=>1,unregisterCallback:()=>{}}});
Object.defineProperty(window,'__TAURI_EVENT_PLUGIN_INTERNALS__',{value:{unregisterListener:()=>{}}});
function Fixture(){const [site,setSite]=useState(ACTIVE_SITE.spaceId),[current,setCurrent]=useState(task()),[dark,setDark]=useState(false),[remount,setRemount]=useState(0),[layout,setLayout]=useState('wide'),[connectionOpen,setConnectionOpen]=useState(false);
 return <div className="task-workbench" style={{height:'100vh'}}><header style={{display:'flex',alignItems:'center',gap:12,padding:12,borderBottom:'1px solid var(--hair)'}}><strong>写作模板 · 隔离验收</strong><select aria-label="验收工作空间" value={site} onChange={e=>{const next=profiles.find(s=>s.spaceId===e.target.value)!;setActiveSite(next);setSite(next.spaceId);setCurrent(task());}}>{profiles.map(s=><option value={s.spaceId} key={s.spaceId}>{s.name}</option>)}</select><select aria-label="验收布局" value={layout} onChange={e=>setLayout(e.target.value)}><option value="wide">桌面</option><option value="narrow">窄屏 390px</option></select><button onClick={()=>{setRemount(n=>n+1);setCurrent(structuredClone(task()));}}>重新打开草稿</button><button onClick={()=>setConnectionOpen(true)}>连接中心</button><button onClick={()=>{document.documentElement.dataset.mode=dark?'light':'dark';setDark(!dark);}}>切换明暗</button></header><div style={{height:'calc(100vh - 60px)',minHeight:0,width:layout==='narrow'?390:'100%',maxWidth:'100%'}}><NotebookWorkflow key={site+':'+remount} task={current} run={{}} active refreshToken={0} obscured={false} agentBusy={false} onAccept={setCurrent} onUi={ui=>{task().ui={...task().ui,...ui};setCurrent(structuredClone(task()));}} onSave={async()=>{}} onDraft={()=>{}} onRefresh={()=>{setCurrent(structuredClone(task()));setRemount(n=>n+1);}} onChanged={()=>{}} onCloudChanged={async()=>{}} onOpenUrl={()=>{}} onEditorContext={()=>{}} onOpenLocal={()=>{}}/></div>{connectionOpen&&<div role="dialog" aria-label="连接中心验收" style={{position:'fixed',inset:40,zIndex:100,overflow:'auto',padding:24,background:'var(--reader)',border:'1px solid var(--hair)',borderRadius:12}}><button onClick={()=>setConnectionOpen(false)}>关闭连接中心</button><ConnectionCenter key={site}/></div>}</div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
