import {notebookPreparation} from '../scripts/agent/notebook-completion.mjs';
// Synthetic UI fixture. Every native call is intercepted; unknown calls fail.
// No real files, services, credentials, RSS data or platform writes are used.
import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {UI_SCALES,applyUiScale,type UiScale} from '../src/lib/uiScale';
import {WindowChromeContext} from '../src/components/PaneToolbar';
import ToastViewport from '../src/components/ToastViewport';
import {toast} from '../src/toast';
import {ACTIVE_SITE} from '../../scripts/site-profile.mjs';
import '@fontsource-variable/inter-tight';
import '../src/styles.css';
import '../src/workspace.css';
document.documentElement.dataset.mode='dark';
document.documentElement.dataset.platform='mac';
Object.defineProperty(window,'__TAURI_EVENT_PLUGIN_INTERNALS__',{configurable:true,value:{unregisterListener:()=>{}}});
const date='2026-10-02T10:00:00Z';
const image=new URL('./publication-preview.svg',location.href).href;
const drafts=[
  {id:'sample-one',shortTitle:'开放科学的下一步：从论文走向可复现的研究',canonicalPath:'articles/2026-10/2026-10-02_01_开放科学/正文.md',batchDate:'2026-10-02',markdown:'# 开放科学的下一步\n\n从论文走向可复现的研究。',sha256:'one',sync:{state:'synced',baseRevision:2,remoteRevision:2}},
  {id:'sample-two',shortTitle:'研究工具与学术平台观察',canonicalPath:'articles/annex/新闻聚合/01_研究工具与学术平台观察/正文.md',batchDate:null,markdown:'# 研究工具与学术平台观察\n\n这是合成验收正文。',sha256:'two',sync:{state:'local_changed',baseRevision:1,remoteRevision:1}},
  {id:'sample-three',shortTitle:'本周学术情报',canonicalPath:'articles/annex/新闻聚合/02_本周学术情报/正文.md',batchDate:null,markdown:'# 本周学术情报\n\n保留来源与日期。',sha256:'three',sync:{state:'unpublished',baseRevision:null,remoteRevision:null}},
];
const qaFlags=new URLSearchParams(location.search);
if(qaFlags.has('many'))for(let i=1;i<=9;i++)drafts.push({id:'sample-many-'+i,shortTitle:'合成验收稿件 '+i+'：标签页滚动',canonicalPath:'articles/annex/新闻聚合/m'+i+'/正文.md',batchDate:null,markdown:'# 合成验收稿件 '+i+'\n\n正文。',sha256:'m'+i,sync:{state:'synced',baseRevision:2,remoteRevision:2},cloudOnly:true} as any);
if(qaFlags.has('editcopy'))Object.assign(drafts[0],{editCopy:true});
const publishedRevision=(id:string)=>website.items.find(x=>x.articleId===id)?.publishedVersion??null;
const html=(id:string)=>`<h1>${drafts.find(x=>x.id===id)?.shortTitle||'官网定稿'}</h1><p>这是一份隔离验收稿件。正文、图片和状态均为合成数据。</p><img src="${image}" alt="本地合成配图"><h2>研究如何变得可以复现</h2><p>研究方法、数据集与实验代码一同公开，让阅读者能够追溯每一步工作的依据。文章保留来源、日期与引用，方便后续修订。</p><p>本地稿件经过编辑与确认，推送到服务器后，以官网已发布版本为定稿。</p>`;
const metadata={date:'2026-10-02',summary:'开放科学与研究方法观察',author:'Scholay 编辑部',category:'学者观察'};
const calls:string[]=[];
const fixtureCallbacks=new Map<number,(event:any)=>void>(),fixtureListeners=new Map<number,{event:string;handler:number}>();let fixtureSequence=0;
const fixtureEmit=(event:string,payload:unknown)=>{for(const [id,listener] of fixtureListeners)if(listener.event===event)fixtureCallbacks.get(listener.handler)?.({event,id,payload});};
const galleryStates=new Map<string,any>();
const qaSettings:Record<string,string>={};
const receipts:Record<string,any>={};
const publishingDetails:Record<string,any>={};
const records=[{id:'external-one',taskId:'task-one',sourceId:'sample-one',title:'开放科学的下一步',platform:'微信公众号',status:'已发布',url:'',account:'Scholay'}];
const snapshot=()=>({connection:{configured:true,origin:'https://example.invalid'},checkedAt:date,articles:drafts.filter((x:any)=>!x.cloudOnly).map(x=>({...x,sync:{...x.sync,publishedRevision:publishedRevision(x.id)},stage:x.sync.state==='synced'?'published':'local',receipt:null,preparedAt:null}))});
const website={scope:'all',updatedAt:date,items:drafts.filter((x,i)=>i<2||x.id.startsWith('sample-many-')).map(x=>({key:'news:'+x.id,articleId:x.id,kind:'news',version:2,publishedVersion:x.id==='sample-one'?2:null,title:x.shortTitle,summary:'从研究的日常出发，记录学术实践与开放工具。',dateLabel:x.batchDate||'2026-10-02',category:'学者观察',url:'https://example.invalid/news/'+x.id+'/',detailPage:true,lastmod:date,sourceUrls:[]}))};
const demoTask=(id:string,title:string,mode='xiwen')=>({id,mode,title,brief:'开放科学与科研工具',days:30,revision:1,stage:'topic',articleId:'draft-'+id,workIds:['sample-one'],board:{titles:['开放科学的下一步','让研究可以复现','从论文到开放工具'],sections:[{id:'methods',title:'研究方法与工具',items:[{id:'news-one',title:'开放数据与可重复研究实践',summary:'隔离演示材料，用于验证选题板交互与排版，不代表真实新闻。',publisher:'合成验收',date:'2026-10-02',url:'https://example.invalid/source',locked:true}]}]},outline:{blocks:[{id:'title',type:'title',text:'开放科学的下一步'},{id:'paragraph',type:'paragraph',text:'研究方法、数据与代码如何共同提升可重复性。'},{id:'image',type:'image',text:'用流程图解释从原始资料到可重复成果的过程。'}]},assets:[],ui:{tabs:[],contexts:[],composer:''}});
const tasks:any[]=[{...demoTask('demo-one','开放科学的下一步'),articleId:'sample-one',workflow:{authorized:false,sources:'combined'},ui:{tabs:[],contexts:[],flowStep:'brief'}},demoTask('demo-two','新的研究工具观察','observation')];
const qa=new URLSearchParams(location.search);
if(qa.has('notebook'))tasks[0].notebook={version:2,title:'让研究可以复现',kind:'article',skills:[],fields:{},sources:[],mounts:{templates:[],brands:[],skills:[]},assets:{},groups:[{id:'section',kind:'section'}],blocks:[
 {id:'intro',type:'paragraph',text:'从论文走向可复现的研究，需要把方法、数据与代码放在一起理解。每一步都有来源，也给后续修订留下空间。',state:'ready',sourceIds:[]},
 {id:'heading',type:'heading',level:2,text:'从原始资料到研究结果',groupId:'section',state:'ready',sourceIds:[]},
 {id:'body',type:'paragraph',text:'记录材料的出处和处理过程，让读者能够沿着同一条路径检查结果。分组帮助整理结构，正文仍然连贯可读。',groupId:'section',state:'ready',sourceIds:[]},
 {id:'next',type:'paragraph',text:'保留必要的操作入口，同时让注意力停留在内容上。',state:'ready',sourceIds:[]}
]};
const fixtureSkills=[['site-writing','自然表达','清楚交代主题和背景，让文章顺畅可读。'],['copy-editing','文字编辑','检查语句、标点与表达，保留作者的原意。'],['research','资料核查','核对来源与事实，明确已知和未知。'],['statistics-explainer','数据说明','把统计结果写成易于理解的解释。']].map(([id,name,description])=>({id,name,description,version:'1',contentHash:'a'.repeat(64),content:'合成技能：'+description}));
if(qa.has('resources'))qaSettings['writing.brands.v1.'+ACTIVE_SITE.spaceId]=JSON.stringify([{id:'scholay',version:1,name:'Scholay',description:'研究与写作的日常伙伴',voice:'清楚、克制，尊重原始资料。',endnotes:[{id:'learn',label:'了解更多',text:'[Scholay](https://example.invalid/scholay)'}]},{id:'today',version:1,name:'Today',description:'从素材到文章，专注内容本身',voice:'自然表达，说明事实与背景。',endnotes:[]},{id:'studio',version:1,name:'研究工作室',description:'分享研究方法与实践经验',voice:'以证据为基础，让经验可复用。',endnotes:[]}]);
const qaModes={xiwen:'学界犀闻',observation:'学者观察',opensource:'学术开源',calendar:'学术日历维护',history:'昔日学术维护',rss:'RSS 来源发现'};
const qaMode=qa.get('mode');if(qaMode&&qaMode in qaModes){Object.assign(tasks[0],{mode:qaMode,title:'隔离验收 · '+qaModes[qaMode as keyof typeof qaModes],days:qaMode==='xiwen'?7:30});}
const qaStep=qa.get('step');if(qaStep){Object.assign(tasks[0],{topicConfirmed:'fixture',outlineConfirmed:'fixture',workflow:{authorized:true,sources:'combined'},ui:{...tasks[0].ui,flowStep:qaStep}});}
if(qa.has('cards'))tasks[0].board={titles:[],sections:['研究方法','学术生态','开源工具'].map((title,i)=>({id:'section-'+i,title,items:Array.from({length:qa.has('partial')?(i===0?1:0):qa.has('overflow')?6:3},(_,j)=>({id:`news-${i}-${j}`,title:['让研究成果可以复现','开放数据的新进展','从论文走向共享工具'][j%3] + (qa.has('overflow')?'：用于验证超长标题省略和固定卡片高度的候选材料'.repeat(5):''),summary:'合成验收材料：此卡用于检验勾选、拖拽、删除与分栏布局，不作为真实新闻。'.repeat(qa.has('overflow')?30:1),publisher:'示例研究机构',date:'2026-10-04',url:`https://example.invalid/${i}/${j}`,selected:j===0,locked:j===0,excluded:j!==0,acquiredVia:j===0?'rss':'web'}))})),targetSections:3,targetPerSection:3};
if(qa.has('empty'))Object.assign(tasks[0],{articleId:'empty-fixture',workIds:[],topicConfirmed:null,outlineConfirmed:null,board:{titles:[],sections:[],targetSections:tasks[0].mode==='xiwen'?3:1,targetPerSection:1},outline:{blocks:[]}});
if(qa.has('extension'))tasks[0].ui={...tasks[0].ui,tabs:[{id:'web:fixture',kind:'web',title:'来源网页 · 合成验收',url:'https://example.invalid/source'}],activeTab:'web:fixture',expansionOpen:true};
Object.defineProperty(window,'__TAURI_INTERNALS__',{configurable:true,value:{metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:(callback:(event:any)=>void)=>{const id=++fixtureSequence;fixtureCallbacks.set(id,callback);return id;},unregisterCallback:(id:number)=>fixtureCallbacks.delete(id),invoke:async(command:string,args:any={})=>{
  calls.push(command+':'+(args.method||''));
  if(command==='list_folders')return [{id:7,name:'科研资讯',position:0}];
  if(command==='list_feeds')return [{id:9,title:'研究机构 RSS',folderId:7}];
  if(command==='list_tags')return [{id:3,name:'开放科学',articleCount:2}];
  if(command==='list_articles')return [{id:42,feedId:9,feedTitle:'研究机构 RSS',title:'开放科研资助计划发布新规',snippet:'用于验证本地素材选择的合成资讯，不代表真实新闻。',url:'https://example.invalid/rss/42',publishedAt:'2026-10-04T08:00:00Z',sourceType:'rss'},{id:43,feedId:9,feedTitle:'研究机构 RSS',title:'研究团队发布共享数据工具',snippet:'用于验证搜索与单条填充的合成资讯。',url:'https://example.invalid/rss/43',publishedAt:'2026-10-03T08:00:00Z',sourceType:'rss'}].filter(a=>!args.search||a.title.includes(args.search));
  if(command==='workbench_device_name')return 'Scholay 的 Mac Studio';
  if(command==='workbench_exit_guard'||command==='workbench_finish_exit')return;
  if(command==='cursor_agent_call'&&args.method==='status'&&tasks.find(t=>t.id===args.params?.taskId)?.mode==='image')return galleryStates.get(args.params.taskId)||{connected:true,busy:false,status:'尚未开始 · 合成验收',history:[],pending:[],sessionId:args.params.taskId};
  if(command==='cursor_agent_call'&&args.method==='gallery_list')return [{key:'fixture:image',taskId:'demo-one',id:'image',storage:'gallery',name:'合成验收图片',createdAt:date},...tasks.filter(t=>t.mode==='image').flatMap(t=>t.assets.map((asset:any)=>({...asset,taskId:t.id,key:t.id+':'+asset.id,taskTitle:t.title,storage:'gallery',createdAt:date})))];
  if(command==='cursor_agent_call'&&args.method==='gallery_prompt'){
    const p=args.params,task=tasks.find(t=>t.id===p.taskId);if(task?.mode!=='image')throw Error('隔离图库仅支持图片对话');
    const state=galleryStates.get(task.id)||{connected:true,busy:false,status:'尚未开始',history:[],pending:[],sessionId:task.id};if(state.busy)throw Error('此图片对话正在运行');
    const runId='fixture-image-'+crypto.randomUUID(),tool={id:runId+'-tool',role:'tool',text:'',tool:{title:'Generate Image · 合成演示',status:'in_progress'}};
    state.history.push({id:runId+'-user',role:'user',text:p.text},tool);state.busy=true;state.status='正在生成 · 合成验收';galleryStates.set(task.id,state);task.runtime={busy:true,status:state.status};
    fixtureEmit('cursor-agent-event',{type:'state',taskId:task.id,...state});fixtureEmit('cursor-agent-event',{type:'task_state',taskId:task.id,state:task.runtime});
    setTimeout(()=>{if(!state.busy)return;tool.tool.status='completed';state.history.push({id:runId+'-assistant',role:'assistant',text:'合成图片已准备好，可在右侧查看。此页面没有运行真实 Cursor 或写入图片。'},{id:runId+'-turn',role:'turn',text:'',status:'已完成 · 合成验收'});state.busy=false;state.status='已完成 · 合成验收';task.runtime={busy:false,status:state.status,lastRunStatus:'已完成'};task.assets.push({id:runId,articleId:task.articleId,name:'合成图片 · '+(task.assets.length+1),path:'fixture.webp',originalPath:'fixture.webp'});fixtureEmit('cursor-agent-event',{type:'state',taskId:task.id,...state});fixtureEmit('cursor-agent-event',{type:'task_state',taskId:task.id,state:task.runtime});fixtureEmit('cursor-agent-event',{type:'task_changed',taskId:task.id});},1200);
    return {started:true,queued:false,runId};
  }
  if(command==='cursor_agent_call'&&args.method==='cancel'&&galleryStates.has(args.params?.taskId)){
    const state=galleryStates.get(args.params.taskId);state.busy=false;state.status='已停止';state.history.push({id:crypto.randomUUID(),role:'turn',text:'',status:'已停止'});fixtureEmit('cursor-agent-event',{type:'state',taskId:args.params.taskId,...state});return {ok:true};
  }
  if(command==='get_article')return {id:args.id,contentHtml:`<p>隔离 RSS 图文</p><img src="${image}" alt="合成配图">`};
  if(command==='cursor_agent_call'&&args.method?.startsWith('notebook_')){
    if(args.method==='notebook_brands')return JSON.parse(qaSettings['writing.brands.v1.'+ACTIVE_SITE.spaceId]||'[]');
    if(args.method==='notebook_brand_save'){const values=JSON.parse(qaSettings['writing.brands.v1.'+ACTIVE_SITE.spaceId]||'[]'),p=args.params,old=values.find((b:any)=>b.id===p.brand.id);if((old?.version||0)!==p.expectedVersion)throw Error('品牌版本冲突');const next=[{...p.brand,version:p.expectedVersion+1},...values.filter((b:any)=>b.id!==p.brand.id)];qaSettings['writing.brands.v1.'+ACTIVE_SITE.spaceId]=JSON.stringify(next);return next;}
    if(args.method==='notebook_catalog')return {siteId:ACTIVE_SITE.id,sections:[{id:'research',name:'学术研究'}],skills:qa.has('resources')?fixtureSkills:[]};
    const p=args.params||{},t=tasks.find(t=>t.id===p.taskId);if(!t)throw Error('Unknown fixture task');
    if(args.method==='notebook_open'){t.notebook??={version:2,title:'',kind:'article',skills:['xiwen'],fields:{},sources:[],groups:[],assets:{},mounts:{templates:[],brands:[]},blocks:[{id:'note-1',type:'paragraph',requirement:'整理核心事实',text:'',state:'placeholder',sourceIds:[]},{id:'note-2',type:'paragraph',requirement:'说明事实的背景与适用范围',text:'',state:'placeholder',sourceIds:[]}]};return structuredClone(t);}
    if(args.method==='notebook_check'){const issues=p.phase==='prepare'?notebookPreparation(t.notebook).filter(c=>!c.ok).map(c=>c.label):[];return {ready:!issues.length,issues};}
    if(args.method==='notebook_image_search')return {items:[p.mode==='local'?{id:'image',taskId:'demo-one',kind:'gallery',name:'合成验收图片'}:{id:'online-image',kind:'online',name:'在线搜索合成图片',url:image,thumbnail:image,sourceUrl:'https://example.invalid/image',creator:'合成作者',license:'cc0'}],hasMore:false};
    if(args.method==='notebook_image_read')return {src:image};
    if(args.method==='notebook_image_apply'){const b=t.notebook.blocks.find((x:any)=>x.id===p.blockId);b.text='assets/notebook/'+('a'.repeat(64))+'.webp';b.state='ready';b.locked=true;t.revision++;return structuredClone(t);}
    if(args.method==='notebook_prompt'){
      t.notebook=structuredClone(t.notebook);
      if(p.action==='research'){t.notebook.sources.push(...[1,2].map(i=>({id:'web-'+crypto.randomUUID(),title:i===1?'开放科学实践指南':'研究资料共享的基本原则',summary:'用于检验联网候选卡片和拖拽的合成资料，不代表实际搜索结果。',url:'https://example.invalid/web/'+i,publisher:'示例研究机构',reviewed:false,acquiredVia:'web'})));}
      else{const ids=p.targetIds||t.notebook.blocks.filter((x:any)=>x.state==='placeholder'||p.action==='complete'&&x.type==='heading'&&!x.locked).map((x:any)=>x.id);
       for(const b of t.notebook.blocks.filter((x:any)=>ids.includes(x.id))){b.text=b.type==='image'?'assets/notebook/'+('a'.repeat(64))+'.webp':b.type==='heading'?'可复现的研究过程':'这是合成验收内容，用于检查指定占位的回填。';b.state='ready';}}
      if(p.action==='complete')t.completedAt=new Date().toISOString();
      t.revision++;fixtureEmit('cursor-agent-event',{type:'task_changed',taskId:t.id});
      fixtureEmit('cursor-agent-event',{type:'message',taskId:t.id,message:{id:crypto.randomUUID(),role:'user',text:p.text}});
      fixtureEmit('cursor-agent-event',{type:'message',taskId:t.id,message:{id:crypto.randomUUID(),role:'assistant',text:p.action==='research'?'候选资料已准备好 · 隔离演示。':'已填入指定位置 · 隔离演示。'}});return {started:true};
    }
    if(args.method==='notebook_export'){t.completedAt=new Date().toISOString();return structuredClone(t);}
    if(args.method==='notebook_reopen'){delete t.completedAt;delete t.delivery;t.revision++;return structuredClone(t);}
    throw Error('Unsupported notebook fixture operation');
  }
  if(command==='cursor_agent_call'){const p=args.params||{};if(args.method==='agent_list')return {defaultAgentId:'cursor',agents:[{id:'cursor',name:'Cursor',enabled:true,available:true},{id:'codex',name:'Codex',enabled:true,available:true},{id:'claude',name:'Claude Code',enabled:true,available:true},{id:'hermes',name:'Hermes',enabled:true,available:false}]};if(args.method==='agent_select'){const t=tasks.find(t=>t.id===p.taskId)!;t.agentId=p.agentId;return t;}if(args.method==='gallery_list')return [{key:'fixture:image',taskId:'demo-one',id:'image',storage:'gallery',name:'合成验收图片',createdAt:date}];if(args.method==='gallery_read')return {src:image};if(args.method==='article_images')return {sha:'one',slots:qaStep==='draft'?[{path:'assets/placeholders/demo.png',prompt:'研究资料如何变为可重复成果'}]:[]};if(args.method==='task_list')return tasks.filter(t=>!p.query||JSON.stringify(t).includes(p.query));if(args.method==='task_settings')return {parallelism:3};if(args.method==='task_states')return qa.has('running')?{'demo-one':{busy:true,lastAction:{action:qaStep||'topic'}}}:{};if(['task_leases','task_lease'].includes(args.method))return {};if(args.method==='task_get')return structuredClone(tasks.find(t=>t.id===p.taskId));if(args.method==='task_create'){const t={...demoTask(crypto.randomUUID(),p.title,p.mode),workIds:[],board:{titles:[],sections:[],targetSections:p.mode==='xiwen'?3:1,targetPerSection:1},outline:{blocks:[]},ui:{tabs:[],contexts:[],composer:''}};tasks.push(t);return t;}if(args.method==='task_finish'){const t=tasks.find(t=>t.id===p.taskId)!;t.completedAt=new Date().toISOString();t.delivery={destination:p.destination||'local',completedAt:t.completedAt};return t;}if(args.method==='task_update'){const t=tasks.find(t=>t.id===p.taskId)!;if(p.patch.board||p.patch.outline||p.patch.notebook)t.revision++;Object.assign(t,{...p.patch,...(p.patch.ui?{ui:{...t.ui,...p.patch.ui}}:{})});return t;}if(args.method==='task_workflow'){const t=tasks.find(t=>t.id===p.taskId)!;t.workflow={...t.workflow,authorized:p.authorized,sources:p.sources};return t;}if(args.method==='task_check')return {ready:true,draftReady:true,reviewed:true,images:2,sha256:'one',fingerprint:'fixture',checks:[{key:'topic',label:'选题已确认',ok:true,detail:'这是隔离演示'},{key:'outline',label:'大纲已确认',ok:true,detail:'这是隔离演示'},{key:'body',label:'正文已保存',ok:true,detail:'这是隔离演示'},{key:'images',label:'配图文件完整',ok:true,detail:'这是隔离演示'}]};if(args.method==='task_run')return {started:true,runId:'fixture-run'};if(args.method==='task_confirm'){const t=tasks.find(t=>t.id===p.taskId)!;t[p.stage==='topic'?'topicConfirmed':'outlineConfirmed']='fixture';return t;}if(args.method==='prompt')return {started:true};return {connected:true,busy:qa.has('running'),status:qa.has('running')?'正在检索 RSS 与机构原文':'已连接 · 隔离验收',history:[{id:'u',role:'user',text:'取回云端草稿，检查来源并保存修订，先不公开。'},{id:'tool-demo',role:'tool',text:'',tool:{title:'读取稿件并核对来源',status:'completed',rawInput:{scope:'current-space',limit:3},content:[{type:'content',content:{type:'text',text:'隔离工具记录：已检查 3 条来源链接。'}}]}},{id:'diff-demo',role:'change',text:'',change:{articleId:'sample-one',path:'articles/正文.md',oldText:'# 开放科学\n\n整理研究资料。',newText:'# 开放科学的下一步\n\n整理研究资料，保留原始来源与日期。',sha256:'fixture'}},{id:'a',role:'assistant',text:'已取回正文与配图，保留了来源。查看 [来源网页](https://example.invalid/source)。'}],pending:p.taskId==='demo-one'?[]:[{requestId:'qa',kind:'business',title:'保存云端草稿（不公开）',detail:'开放科学的下一步 · 基于云端 v2 · 1 张图片',html:html('sample-one')}],sessionId:'fixture',configuration:{configOptions:[{id:'mode',category:'mode',currentValue:'agent',options:[{value:'agent',name:'Agent'},{value:'plan',name:'Plan'},{value:'ask',name:'Ask'}]},{id:'model',category:'model',currentValue:'fixture-model[fast=true]',options:[{value:'fixture-model[fast=true]',name:'演示模型'},{value:'fixture-other[effort=high]',name:'备用演示模型'}]}]}};}
  if(command==='editorial_location')return {path:'/示例/RSSD/editorial',count:drafts.length};
  if(command==='editorial_open_workspace'||command==='editorial_open_directory')return;
  if(command==='list_structured_documents')return [];
  if(command==='editorial_call'){
    if(args.method==='draft_list')return {articles:drafts.filter((x:any)=>!x.cloudOnly),columns:['新闻聚合','学术开源']};
    if(args.method==='workspace_stamp')return {stamp:'unchanged'};
    if(args.method==='publication_status')return {status:'not_submitted'};
    const d=drafts.find(x=>x.id===args.params?.id);
    if(args.method==='draft_read')return d;
    if(args.method==='draft_preview'){const text=String(args.params.markdown??d!.markdown).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');return {html:text.split('\n\n').map(p=>p.startsWith('# ')?'<h1>'+p.slice(2)+'</h1>':'<p>'+p+'</p>').join(''),warnings:[]};}
    if(args.method==='draft_save'){d!.markdown=args.params.markdown;d!.sha256='saved';d!.sync={...d!.sync,state:'local_changed'};return d;}
  }
  if(command==='website_publish_call'){
    if(args.method==='reconcile')return {changed:false,results:[]};
    if(args.method==='snapshot'||args.method==='refresh')return snapshot();
    const d=drafts.find(x=>x.id===args.params?.id)!;
    if(args.method==='cloud_action_cached')return receipts[args.params.id]||null;
    if(args.method==='cloud')return {id:d.id,title:d.shortTitle,metadata,html:html(d.id),version:2,publishedVersion:website.items.find(x=>x.articleId===d.id)?.publishedVersion,url:'https://example.invalid/news/'+d.id+'/'};
    if(args.method==='cloud_action'){const row=website.items.find(x=>x.articleId===d.id)!;if(args.params.action==='delete')website.items.splice(website.items.indexOf(row),1);else row.publishedVersion=args.params.action==='publish'?2:null;return receipts[d.id]={action:args.params.action,status:'success',requestKey:'fixture-request',publicReadback:args.params.action==='publish',withdrawnReadback:args.params.action==='withdraw'};}
    if(args.method==='cloud_action_status')return receipts[args.params.id];
    if(args.method==='local_action'){if(args.params.action==='discard_pull'){if(!args.params.confirmed||!(d as any).editCopy)throw Error('合成验收：不是编辑副本');if(d.sync.state!=='synced'&&!args.params.discardChanges)throw Error('编辑副本有未推送的修改，请确认放弃修改');Object.assign(d,{editCopy:false,cloudOnly:true,sync:{...d.sync,state:'synced'}});return {id:d.id,discarded:true};}if(args.params.action==='delete')drafts.splice(drafts.indexOf(d),1);return {id:args.params.id};}
    if(args.method==='published')return {id:d.id,title:d.shortTitle,metadata,html:html(d.id),revision:2,url:'https://example.invalid/news/'+d.id+'/'};
    if(args.method==='inspect')return publishingDetails[d.id]||{id:d.id,title:d.shortTitle,canonicalPath:d.canonicalPath,sourceSha256:d.sha256,metadata,metadataSha256:'meta',stage:'local',stale:false,validation:'',receipt:null,html:html(d.id),warnings:[],prepared:null,sync:{...d.sync,fingerprint:'fixture-fingerprint',publishedRevision:publishedRevision(d.id)}};
    if(args.method==='prepare')return publishingDetails[d.id]={id:d.id,title:d.shortTitle,canonicalPath:d.canonicalPath,sourceSha256:d.sha256,metadata:args.params.metadata,metadataSha256:'meta',stage:'prepared',stale:false,validation:'',receipt:null,html:html(d.id),warnings:[],prepared:{requestKey:'fixture-only-request',packetSha256:'fixture-only-packet',sourceSha256:d.sha256,preparedAt:date,intent:args.params.intent,expectedVersion:2,title:d.shortTitle,metadata:args.params.metadata,assetCount:2}};
    if(args.method==='publish'){const detail=publishingDetails[d.id];if(!detail?.prepared||!args.params.confirmed)throw Error('合成验收需要先确认');detail.stage='queued';detail.receipt={requestKey:'fixture-only-request',revision:3,job:{id:'fixture-job',status:'queued'}};return detail;}
    if(args.method==='status'){const detail=publishingDetails[d.id];detail.stage='published';detail.receipt={...detail.receipt,job:{id:'fixture-job',status:'success'},publicReadback:true};return detail;}
    if(args.method==='pull'){const copy=(d as any).cloudOnly;Object.assign(d,{cloudOnly:false,editCopy:copy||(d as any).editCopy});return {id:d.id,conflict:false,revision:2,editCopy:!!(d as any).editCopy};}
  }
  if(command==='editorial_call'&&args.method==='draft_create'){const p=args.params;drafts.push({id:p.id,shortTitle:p.title,canonicalPath:'articles/annex/学者观察/fixture/正文.md',batchDate:null,markdown:p.markdown,sha256:'new',sync:{state:'unpublished',baseRevision:null,remoteRevision:null}});return {id:p.id};}
  if(command==='publications_call'&&args.method==='refresh_website'&&qa.has('toast-refresh'))throw Error('官网内容在读取期间发生变化，请重新刷新');
  if(command==='publications_call')return args.method==='refresh_website'?website:{website,feishu:{configured:true,updatedAt:date,records},drafts:drafts.map(x=>({id:x.id,title:x.shortTitle}))};
  if(command==='get_setting')return qaSettings[args.key]||null;
  if(command==='set_setting'){qaSettings[args.key]=args.value;return;}
  if(command==='plugin:event|listen'){const id=++fixtureSequence;fixtureListeners.set(id,{event:args.event,handler:args.handler});return id;}
  if(command==='plugin:event|unlisten'){fixtureListeners.delete(args.eventId);return;}
  if(command==='set_page_view_theme')return;
  throw Error('隔离验收不执行：'+command);
}}});
await import('../src/i18n');
const {default:ImageGallery}=await import('../src/editorial/ImageGallery');
const {default:ContentWorkspace}=await import('../src/editorial/ContentWorkspace');
const {useUi}=await import('../src/store');
applyUiScale(useUi.getState().uiScale);
const {default:WorkspaceSwitcher}=await import('../src/components/WorkspaceSwitcher');
function Fixture(){const [collapsed,setCollapsed]=useState(false);const [chromeHost,setChromeHost]=useState<HTMLDivElement|null>(null);const [dark,setDark]=useState(true),[workspace,setWorkspace]=useState<'editorial'|'library'|'manuscripts'|'gallery'>(new URLSearchParams(location.search).get('view')==='library'?'library':'editorial');useEffect(()=>{const open=()=>setWorkspace('manuscripts'),conversation=()=>setWorkspace('editorial');window.addEventListener('scholay-open-manuscripts',open);window.addEventListener('scholay-open-creation',conversation);return()=>{window.removeEventListener('scholay-open-manuscripts',open);window.removeEventListener('scholay-open-creation',conversation);};},[]);const scale=useUi(s=>s.uiScale),setScale=useUi(s=>s.setUiScale);return <div style={{height:'100%',display:'flex',flexDirection:'column'}}><div style={{height:32,flexShrink:0,padding:'0 14px',display:'flex',alignItems:'center',gap:12,fontSize:12}}>隔离验收 · 全部为合成数据<button onClick={()=>{document.documentElement.dataset.mode=dark?'light':'dark';setDark(!dark);}}>切换明暗</button><select aria-label="验收界面缩放" value={scale} onChange={e=>setScale(e.target.value as UiScale)}>{UI_SCALES.map(n=><option key={n} value={n}>{n}%</option>)}</select>{qa.has('toast')&&<><button onClick={()=>toast.error('官网内容在读取期间发生变化，请重新刷新')}>模拟读取失败</button><button onClick={()=>toast.show('工作草稿已保存')}>模拟保存成功</button><button onClick={()=>toast.error('读取失败，请重新刷新。错误详情：'+('https://example.invalid/a-long-resource-path/').repeat(8))}>模拟长消息</button></>}</div><WindowChromeContext.Provider value={{host:chromeHost,workspace,collapsed,toggle:()=>setCollapsed(!collapsed)}}><div className={"workspace-host is-content-workspace has-pane-chrome"+(collapsed?" is-sidebar-collapsed":"")} style={{height:'auto',flex:1}}><div className="workspace-window-header" ref={setChromeHost}><nav className="workspace-window-navigation"><button aria-label="展开或收起第一栏" onClick={()=>setCollapsed(!collapsed)}>◧</button></nav></div><WorkspaceSwitcher workspace={workspace} captureBusy={false} onChange={v=>{if(v==='editorial'||v==='library'||v==='manuscripts'||v==='gallery')setWorkspace(v);}}/><div className="workspace-panels"><div style={{height:'100%',display:workspace==='gallery'?'none':undefined}}><ContentWorkspace active={workspace!=='gallery'} view={workspace==='library'?'works':workspace==='manuscripts'?'manuscripts':'conversations'} chromeHost={chromeHost}/></div>{workspace==='gallery'&&<ImageGallery active/>}</div></div></WindowChromeContext.Provider><ToastViewport/></div>;}
Object.assign(window,{__CONTENT_FIXTURE__:{calls}});const fixtureRoot=createRoot(document.getElementById('root')!);fixtureRoot.render(<Fixture/>);import.meta.hot?.dispose(()=>fixtureRoot.unmount());
