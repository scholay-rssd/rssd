// @vitest-environment jsdom
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
// Agent selection is covered by writingAgents.test.ts; these cases assert the
// workflow's command sequencing independently of its read-only toolbar.
vi.mock('../agents/AgentSelector',()=>({default:()=>null}));
const {call,renderWork,renderPublisher}=vi.hoisted(()=>({call:vi.fn(),renderWork:vi.fn(),renderPublisher:vi.fn()}));
vi.mock('../editorial/taskWorkbench',async importOriginal=>({...await importOriginal<any>(),taskCall:call}));
vi.mock('../editorial/CursorAgentPane',async()=>{const {default:Rail}=await import('../editorial/FlowStepRail');return {default:(props:any)=>createElement('aside',null,'Cursor Auto',createElement(Rail,{steps:props.workflowRail?.steps||[]}))};});
vi.mock('../editorial/WorkDetail',()=>({default:(props:any)=>{renderWork(props);return createElement('section',{'data-draft-editor':true,'data-agent-busy':props.agentBusy},createElement('button',{onClick:()=>props.onEditorContext({context:'正文',dirty:true})},'fixture-edit'));}}));
vi.mock('../publications/WebsitePublisher',()=>({default:(props:any)=>{renderPublisher(props);return createElement('section',{'data-cloud-settings':true},createElement('button',{onClick:()=>void props.onPublished().catch(()=>{})},'fixture-cloud-saved'),createElement('button',{onClick:()=>props.onPending(true)},'fixture-cloud-pending')); }}));
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async(command:string)=>command==='list_articles'?[]:null)}));
import StructuredWorkflow from '../editorial/StructuredWorkflow';
import {invoke} from '@tauri-apps/api/core';
function fixture(){return {id:'task-1',mode:'xiwen',title:'测试',brief:'研究工具',days:30,articleId:'draft-1',workIds:[],board:{titles:[],sections:[]},outline:{blocks:[]},assets:[],revision:1,ui:{tabs:[]}} as any;}
const sure=(host:HTMLElement)=>act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.flow-confirm-dialog button')].find(b=>b.textContent==='确认')!.click());
it('authorizes one structured task with default combined sources before running; no chat or model choice',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);let current=fixture();current.board.sections=[{id:'s',title:'栏目',slotCount:1,slots:[{id:'smart',mode:'smart',prompt:'科研新进展'}],items:[]}];call.mockReset();call.mockImplementation(async(method,p)=>{if(method==='task_workflow'){current={...current,workflow:{authorized:p.authorized,sources:p.sources}};return current;}if(method==='task_run')return {started:true,runId:'new-run'};throw Error(method);});
 function Harness(){const [task,setTask]=useState(current);return createElement(StructuredWorkflow,{task,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));expect(host.querySelectorAll('.flow-progress li')).toHaveLength(4);expect(host.querySelectorAll('.flow-progress button')).toHaveLength(0);expect(host.textContent).toContain('Cursor Auto');expect(host.textContent).not.toContain('Model picker');
 expect(host.querySelector('[aria-current=step]')?.textContent).toContain('选题');
 expect(host.textContent).not.toContain('检索设置');expect(host.querySelector('.flow-search-settings')).toBeNull();expect(host.querySelector('.flow-grant-note')).toBeNull();expect(host.querySelector('.flow-summary')).toBeNull();
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.classList.contains('topic-collect'))!.click());
 expect(call.mock.calls.slice(-2)).toEqual([['task_workflow',expect.objectContaining({sources:'combined',authorized:true,expectedRevision:1})],['task_run',{taskId:'task-1',action:'topic',target:expect.any(String)}]]);
 expect(host.querySelector('[aria-current=step]')?.textContent).toContain('选题');expect(host.textContent).not.toContain('任务要求');await act(async()=>root.unmount());vi.unstubAllGlobals();
});
it('legacy requirements step opens topic directly; selection saves before top confirmation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 let current={...fixture(),workflow:{authorized:true,sources:'combined'},ui:{tabs:[],flowStep:'brief'},board:{titles:['旧标题'],sections:[{id:'s',title:'栏目',items:[{id:'n',title:'材料',summary:'摘要',url:'https://example.org',publisher:'机构',date:'2026-10-04',selected:false,excluded:true}]}]}};
 call.mockReset();call.mockImplementation(async(method,p)=>{if(method==='task_confirm'){expect(p.expectedRevision).toBe(2);expect(current.board.sections[0].items[0].selected).toBe(true);current={...current,revision:3,topicConfirmed:'ok'} as any;return current;}if(method==='task_run')return {started:true,runId:'new-run'};throw Error(method);});
 function Harness(){const [task,setTask]=useState(current);return createElement(StructuredWorkflow,{task:task as any,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask as any,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async(p,rev)=>{expect(rev).toBe(1);current={...current,...p,revision:2};setTask(current);},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));
 expect(host.querySelector('[aria-current=step]')?.textContent).toContain('选题');
 await act(async()=>(host.querySelector('[aria-label="选用：材料"]') as HTMLInputElement).click());
 const confirm=[...host.querySelectorAll<HTMLButtonElement>('.flow-nav-actions button')].find(b=>b.textContent==='确认选题')!;
 expect(host.querySelector('.flow-stage')?.contains(confirm)).toBe(false);
 await act(async()=>confirm.click());expect(host.querySelector('.flow-confirm-dialog')).not.toBeNull();expect(call).not.toHaveBeenCalledWith('task_confirm',expect.anything());await sure(host);expect(call).toHaveBeenCalledWith('task_run',{taskId:'task-1',action:'outline'});expect(host.querySelector('[aria-current=step]')?.textContent).toContain('生成');
 await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();
});
it('shows loading cards while the current stage runs and preserves already returned material',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const task={...fixture(),board:{titles:['已有标题'],sections:[]},workflow:{authorized:true,sources:'combined'}};
 await act(async()=>root.render(createElement(StructuredWorkflow,{task,run:{busy:true,lastAction:{action:'topic'}},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:()=>{},onUi:()=>{},onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}})));
 expect(host.querySelector('.topic-sections')?.getAttribute('aria-busy')).toBe('true');expect(host.querySelectorAll('.topic-placeholder')).toHaveLength(3);expect(host.querySelector('[aria-label="标题候选 1"]')).toBeNull();await act(async()=>root.unmount());vi.unstubAllGlobals();
});
it('shows a read-only progress rail and offers no way to switch or go back',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);call.mockReset();
 function Harness({busy}:{busy:boolean}){const [task,setTask]=useState(fixture());return createElement(StructuredWorkflow,{task,run:{busy},active:true,refreshToken:0,obscured:false,agentBusy:busy,onAccept:setTask,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 for(const busy of [false,true]){
  await act(async()=>root.render(createElement(Harness,{busy})));
  expect([...host.querySelectorAll('.flow-progress li strong')].map(x=>x.textContent)).toEqual(['选题','生成','编辑','交稿']);
  expect(host.querySelectorAll('.flow-progress button,.flow-progress a,.flow-progress [tabindex]')).toHaveLength(0);expect(host.querySelector('.flow-steps')).toBeNull();
  expect(host.querySelector('.flow-progress [aria-current=step]')?.textContent).toContain('选题');expect(host.querySelector('.topic-placeholder')).not.toBeNull();
  await act(async()=>host.querySelectorAll<HTMLElement>('.flow-progress li')[2].click());expect(host.querySelector('.flow-progress [aria-current=step]')?.textContent).toContain('选题');
 }
 expect(call).not.toHaveBeenCalled();await act(async()=>root.unmount());vi.unstubAllGlobals();
});
it('manual-only selection authorizes the structured workflow before starting outline generation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 let current={...fixture(),board:{titles:[],sections:[{id:'s',title:'手动栏目',slotCount:1,slots:[{id:'rss',mode:'manual'}],items:[{id:'rss',title:'手动材料',summary:'摘要',url:'https://example.org',publisher:'机构',date:'2026-10-04',rssId:'42',acquiredVia:'rss',selected:true,locked:true,excluded:false}]}]}};
 call.mockReset();call.mockImplementation(async(method,p)=>{if(method==='task_confirm'){current={...current,revision:2,topicConfirmed:'yes'};return current;}if(method==='task_workflow'){expect(p.expectedRevision).toBe(2);current={...current,workflow:{authorized:true,sources:'combined'}};return current;}if(method==='task_run'){expect(current.workflow.authorized).toBe(true);return {started:true,runId:'new-run'};}throw Error(method);});
 function Harness(){const [task,setTask]=useState(current);return createElement(StructuredWorkflow,{task,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));const confirm=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认选题')!;expect(confirm.disabled).toBe(false);await act(async()=>confirm.click());await sure(host);expect(call.mock.calls.map(c=>c[0])).toEqual(['task_confirm','task_workflow','task_run']);expect(call).toHaveBeenLastCalledWith('task_run',{taskId:'task-1',action:'outline'});await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('moves on only after confirmation; a stopped run keeps the confirmed topic and retries from the next step',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);let setRun:any;let runs=0;let current={...fixture(),workflow:{authorized:true},board:{titles:[],sections:[{id:'s',title:'素材',items:[{id:'n',title:'新闻',summary:'事实',url:'https://example.org',selected:true}]}]}};
 call.mockReset();call.mockImplementation(async(method)=>{if(method==='task_confirm'){current={...current,topicConfirmed:'ok',revision:2};return current;}if(method==='task_run')return {runId:++runs===1?'new-run':'new-run-2'};if(method==='task_get')return {...current,revision:3,outline:{titleCandidates:['完整编排标题'],selectedTitle:0,blocks:[{id:'p',type:'paragraph',text:'编排结果'}]}};throw Error(method);});
 function Harness(){const [task,setTask]=useState(current),[run,updateRun]=useState<any>({runId:'old-run',status:'已完成'});setRun=updateRun;return createElement(StructuredWorkflow,{task,run,active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='确认选题')!.click());
 expect(host.querySelector('[aria-current=step]')?.textContent).toContain('选题');expect(call).not.toHaveBeenCalledWith('task_confirm',expect.anything());
 await sure(host);expect(host.querySelector('[aria-current=step]')?.textContent).toContain('生成');expect(call).not.toHaveBeenCalledWith('task_get',expect.anything());
 await act(async()=>setRun({runId:'new-run',busy:true,status:'正在处理'}));expect(host.querySelector('[aria-current=step]')?.textContent).toContain('生成');
 await act(async()=>setRun({runId:'new-run',busy:false,status:'已停止'}));expect(host.textContent).toContain('生成未完成');expect(host.querySelector('[aria-current=step]')?.textContent).toContain('生成');expect(host.querySelector('.flow-steps')).toBeNull();
 await act(async()=>[...host.querySelectorAll('.flow-nav-actions button')].find(b=>b.textContent==='生成大纲')!.click());
 await act(async()=>setRun({runId:'new-run-2',busy:true,status:'正在处理'}));await act(async()=>setRun({runId:'new-run-2',busy:false,status:'已完成'}));
 expect(host.querySelector('[aria-current=step]')?.textContent).toContain('生成');expect(host.querySelector('textarea')?.value).toBe('编排结果');await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it.each(['xiwen','observation','opensource','calendar','history'])('%s enters editing at once after confirmation and settles when its draft is saved',async(mode)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);let setRun:any;
 let current={...fixture(),mode,topicConfirmed:'topic-hash',workflow:{authorized:true,sources:'combined'},ui:{tabs:[],flowStep:'outline'},outline:{titleCandidates:['标题'],selectedTitle:0,blocks:[{id:'paragraph',type:'paragraph',text:'已编排事实',sourceIds:[]}]}};
 call.mockReset();call.mockImplementation(async(method)=>{
  if(method==='task_confirm'){current={...current,outlineConfirmed:'outline-hash',revision:2};return current;}
  if(method==='task_run')return {runId:'draft-run'};
  if(method==='task_get')return {...current,workIds:['draft-1'],generated:{revision:2,sha:'new-sha',at:'2026-10-04T16:00:00Z'}};
  if(method==='task_check')return {sha256:'new-sha',ready:false,images:0,reviewed:false,checks:[{key:'body',ok:true},{key:'images',ok:false}]};
  throw Error(method);
 });
 function Harness(){const [task,setTask]=useState(current),[run,updateRun]=useState<any>({runId:'old-run',status:'已完成'});setRun=updateRun;return createElement(StructuredWorkflow,{task,run,active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='确认大纲')!.click());await sure(host);
 expect(host.querySelector('[aria-current=step]')?.textContent).toContain('编辑');expect(host.querySelector('.flow-stage-placeholder')?.getAttribute('aria-busy')).toBe('true');
 await act(async()=>setRun({runId:'draft-run',busy:true,status:'正在生成'}));expect(call).not.toHaveBeenCalledWith('task_get',expect.anything());
 await act(async()=>setRun({runId:'draft-run',busy:false,status:'已完成'}));
 expect(host.querySelector('[aria-current=step]')?.textContent).toContain('编辑');expect(host.querySelector('.flow-stage-status')).toBeNull();
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('recovers pending draft verification after reopening and does not move away from a browsed stage',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);let setRun:any;
 const current={...fixture(),topicConfirmed:'topic-hash',outlineConfirmed:'outline-hash',workflow:{authorized:true,sources:'combined'},ui:{tabs:[],flowStep:'review',flowPending:{runId:'recovered-run',action:'draft',source:'outline',target:'draft',revision:2,confirmation:'outline-hash'}},revision:2,outline:{blocks:[{id:'p',type:'paragraph',text:'事实'}]}};
 call.mockReset();call.mockImplementation(async(method)=>{
  if(method==='task_get')return {...current,workIds:['draft-1'],generated:{revision:2,sha:'new-sha',at:'fresh-save'}};
  if(method==='task_check')return {sha256:'new-sha',ready:false,images:0,reviewed:false,checks:[{key:'body',ok:true}]};
  throw Error(method);
 });
 function Harness(){const [task,setTask]=useState(current),[run,updateRun]=useState<any>({runId:'recovered-run',busy:true,status:'正在处理'});setRun=updateRun;return createElement(StructuredWorkflow,{task:task as any,run,active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask as any,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));expect(host.querySelector('[aria-current=step]')?.textContent).toContain('编辑');
 await act(async()=>setRun({runId:'recovered-run',busy:false,lastRunStatus:'已完成',status:'连接已结束，可继续'}));
 expect(host.querySelector('[aria-current=step]')?.textContent).toContain('编辑');expect(host.querySelector('.flow-stage-status')).toBeNull();expect(call).not.toHaveBeenCalledWith('task_run',expect.anything());
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('a successful turn without the new draft cannot advance or leave waiting cards running',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const current={...fixture(),topicConfirmed:'topic-hash',outlineConfirmed:'outline-hash',workflow:{authorized:true,sources:'combined'},ui:{tabs:[],flowStep:'outline',flowPending:{runId:'missing-run',action:'draft',source:'outline',target:'draft',revision:2,confirmation:'outline-hash'}},revision:2,outline:{blocks:[{id:'p',type:'paragraph',text:'事实'}]}};
 call.mockReset();call.mockImplementation(async(method)=>{if(method==='task_get')return current;if(method==='task_check')return {ready:false,images:0,reviewed:false,checks:[{key:'body',ok:false}]};throw Error(method);});
 function Harness(){const [task,setTask]=useState(current);return createElement(StructuredWorkflow,{task:task as any,run:{runId:'missing-run',status:'已完成'},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask as any,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));expect(host.querySelector('[aria-current=step]')?.textContent).toContain('编辑');expect(host.textContent).toContain('本次未返回完整正文');expect(host.querySelector('.flow-stage-placeholder')?.getAttribute('aria-busy')).toBe('false');
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it.each([
 ['xiwen','科研突破',12,3],['observation','制度变化',3,1],['opensource','科研软件',3,1],
 ['calendar','会议征稿',3,1],['history','论文里程碑',3,1],
])('%s presents its own source presets and shows a read-only progress rail during execution',async(mode,preset,templateCount,sectionCount)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);call.mockReset();
 const initial={...fixture(),mode,ui:{tabs:[],flowStep:'topic'}};
 function Harness(){const [task,setTask]=useState(initial);return createElement(StructuredWorkflow,{task:task as any,run:{runId:'qa-run',busy:true,lastAction:{action:'topic'},status:'正在检索'},active:true,refreshToken:0,obscured:false,agentBusy:true,onAccept:setTask as any,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));
 expect(host.querySelectorAll('.topic-section')).toHaveLength(Number(sectionCount));
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(b=>b.textContent==='AI 模板')!.click());
 const material=host.querySelectorAll('.topic-shelf-card').length,materialText=host.querySelector('.topic-shelf-results')?.textContent||'';
 // Column templates belong to the matrix; a single-material type offers material templates only and no column management.
 const single=mode!=='xiwen',kinds=host.querySelector<HTMLButtonElement>('.topic-template-switch [data-kind=section]');
 expect(!!kinds).toBe(!single);expect(!!host.querySelector('.topic-add-section')).toBe(!single);expect(host.querySelector('.topic-selection-layout')?.getAttribute('data-topic')).toBe(single?'single':'matrix');
 if(kinds)await act(async()=>kinds.click());
 expect(single?material:material+host.querySelectorAll('.topic-shelf-card').length).toBe(Number(templateCount));expect(materialText+(host.querySelector('.topic-shelf-results')?.textContent||'')).toContain(String(preset));
 expect(host.querySelector('[aria-label="给 Cursor 的任务"]')).toBeNull();expect(host.querySelector('[aria-label="选择模型"]')).toBeNull();
 expect(host.querySelectorAll('.flow-progress li')).toHaveLength(4);expect(host.querySelectorAll('.flow-progress button')).toHaveLength(0);
 expect(call).not.toHaveBeenCalled();await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('settles a recovered pending stage whose authoritative terminal run has been superseded',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);call.mockReset();
 const initial={...fixture(),topicConfirmed:'topic-hash',ui:{tabs:[],flowStep:'topic',flowPending:{runId:'pending-run',previousRunId:'old-run',action:'outline',source:'topic',target:'outline',revision:2}}};
 function Harness(){const [task,setTask]=useState(initial);return createElement(StructuredWorkflow,{task:task as any,run:{runId:'old-run',busy:false,status:'已完成'},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask as any,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));expect(host.querySelector('.flow-stage-status')).toBeNull();expect(host.textContent).toContain('生成未完成');expect(host.querySelector('[aria-current=step]')?.textContent).toContain('生成');expect(call).not.toHaveBeenCalled();
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});


const deliveryContext=vi.fn();
const localWork={id:'draft-1',title:'本地稿件',category:'学界犀闻',locations:['local'],external:[],local:{id:'draft-1',canonicalPath:'articles/新闻.md'}} as any;
const editableTask=()=>({...fixture(),revision:7,topicConfirmed:'topic',outlineConfirmed:'outline',workIds:['draft-1'],ui:{tabs:[],flowStep:'deliver'}});
const localCheck={draftReady:true,ready:false,reviewed:false,images:0,sha256:'saved-body-sha',fingerprint:'record-and-assets-sha',checks:[{key:'topic',label:'选题已确认',ok:true},{key:'outline',label:'大纲已确认',ok:true},{key:'body',label:'正文已保存',ok:true},{key:'images',label:'配图文件完整',ok:false}]};
function DeliveryHarness(){const [task,setTask]=useState(editableTask());return createElement(StructuredWorkflow,{task:task as any,work:localWork,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask as any,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:deliveryContext,onOpenLocal:()=>{}});}
it('uses four stages and maps a saved review stage to the same editor',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);call.mockReset().mockResolvedValue(localCheck);
 const task={...editableTask(),ui:{tabs:[],flowStep:'review'}};
 await act(async()=>root.render(createElement(StructuredWorkflow,{task:task as any,work:localWork,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:()=>{},onUi:()=>{},onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}})));
 expect([...host.querySelectorAll('.flow-progress li strong')].map(x=>x.textContent)).toEqual(['选题','生成','编辑','交稿']);expect(host.querySelector('[aria-current=step]')?.textContent).toContain('编辑');expect(host.querySelector('[data-draft-editor]')).not.toBeNull();expect(host.textContent).not.toContain('审校');await act(async()=>root.unmount());vi.unstubAllGlobals();
});
it('confirms delivery twice and then saves the checked local draft automatically, with no destination choice',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);call.mockReset().mockImplementation(async(method,params)=>{if(method==='task_check')return localCheck;if(method==='task_finish')return {...editableTask(),completedAt:'now',delivery:{destination:params.destination}};throw Error(method);});
 await act(async()=>root.render(createElement(DeliveryHarness)));expect(host.querySelector('.flow-delivery-panel')).toBeNull();expect(host.querySelector('[aria-label="保存位置"]')).toBeNull();expect(host.querySelector('[data-cloud-settings]')).toBeNull();
 const deliver=[...host.querySelectorAll<HTMLButtonElement>('.flow-nav-actions button')].find(b=>b.textContent==='确认交稿')!;expect(deliver.disabled).toBe(false);await act(async()=>deliver.click());
 expect(call.mock.calls.some(([method])=>method==='task_finish')).toBe(false);await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.flow-confirm-dialog button')].find(b=>b.textContent==='再看看')!.click());expect(host.querySelector('.flow-confirm-dialog')).toBeNull();expect(call.mock.calls.some(([method])=>method==='task_finish')).toBe(false);
 await act(async()=>deliver.click());await sure(host);
 expect(call).toHaveBeenCalledWith('task_finish',{taskId:'task-1',destination:'local',expectedRevision:7,expectedSha256:'saved-body-sha',expectedFingerprint:'record-and-assets-sha'});expect(host.textContent).toContain('任务已完成');expect(host.querySelector('.flow-delivery-complete')).toBeNull();expect(host.querySelector('.flow-done-scrim .flow-done-card')?.textContent).toContain('稿件已保存到本地');expect(host.querySelector('.flow-stage')?.hasAttribute('inert')).toBe(true);const jumped=vi.fn();window.addEventListener('scholay-open-manuscripts',jumped);await act(async()=>host.querySelector<HTMLButtonElement>('.flow-done-card button')!.click());expect(jumped).toHaveBeenCalledTimes(1);expect((jumped.mock.calls[0][0] as CustomEvent).detail).toEqual({id:'draft-1'});window.removeEventListener('scholay-open-manuscripts',jumped);expect(host.querySelector('.flow-progress [aria-current=step]')).toBeNull();expect([...host.querySelectorAll('.flow-progress li.is-done')]).toHaveLength(4);await act(async()=>root.unmount());vi.unstubAllGlobals();
});
it('offers the use at delivery: a free-form post can be placed elsewhere before the task closes, a structured one cannot',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),order:string[]=[];
 call.mockReset().mockImplementation(async(method,params)=>{if(method==='task_check')return localCheck;if(method==='task_finish'){order.push('finish');return {...editableTask(),completedAt:'now',delivery:{destination:params.destination}};}throw Error(method);});
 vi.mocked(invoke).mockClear();vi.mocked(invoke).mockImplementation(async(command:string,args?:any)=>{if(command==='website_publish_call')order.push(args.params.action+':'+args.params.category);return command==='list_articles'?[]:null;});
 await act(async()=>root.render(createElement(DeliveryHarness)));
 const deliver=[...host.querySelectorAll<HTMLButtonElement>('.flow-nav-actions button')].find(b=>b.textContent==='确认交稿')!;await act(async()=>deliver.click());
 const use=host.querySelector<HTMLSelectElement>('.flow-confirm-dialog select[aria-label="稿件用途"]')!;
 expect(use.value).toBe('学界犀闻');expect(use.disabled).toBe(false);expect([...use.options].map(o=>o.value)).toEqual(['学界犀闻','学者观察','学术开源','学术情报','昔日学术']);expect(use.options[0].textContent).toBe('Scholay Today · 学界犀闻');
 await act(async()=>{use.value='学者观察';use.dispatchEvent(new Event('change',{bubbles:true}));});await sure(host);
 expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'local_action',params:{id:'draft-1',action:'category',category:'学者观察',expectedFingerprint:undefined}});
 expect(order).toEqual(['category:学者观察','finish']);
 await act(async()=>root.unmount());
 const second=document.createElement('div'),bound=createRoot(second);
 function Structured(){return createElement(StructuredWorkflow,{task:{...editableTask(),mode:'calendar',articleId:'record-1'} as any,work:{...localWork,category:'学术情报'},run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:()=>{},onUi:()=>{},onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>bound.render(createElement(Structured)));
 await act(async()=>[...second.querySelectorAll<HTMLButtonElement>('.flow-nav-actions button')].find(b=>b.textContent==='确认交稿')!.click());
 const fixed=second.querySelector<HTMLSelectElement>('.flow-confirm-dialog select[aria-label="稿件用途"]')!;
 expect(fixed.disabled).toBe(true);expect([...fixed.options].map(o=>o.value)).toEqual(['学术情报']);expect(second.querySelector('.flow-confirm-use small')?.textContent).toContain('由内容类型决定');
 await act(async()=>bound.unmount());vi.mocked(invoke).mockImplementation(async(command:string)=>command==='list_articles'?[]:null);vi.unstubAllGlobals();
});

it('protects unsaved editing from delivery confirmation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);call.mockReset().mockResolvedValue(localCheck);
 await act(async()=>root.render(createElement(DeliveryHarness)));await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='fixture-edit')!.click());
 expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认交稿')?.disabled).toBe(true);expect(call.mock.calls.some(([method])=>method==='task_finish')).toBe(false);await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it.each([['publication','status'],['action','cloud_action_status']])('restores an unresolved %s request before the default local delivery can finish',async(kind,method)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);call.mockReset().mockResolvedValue({...localCheck,pendingCloudRequest:{kind,requestKey:'original-request',stage:'unknown'}});vi.mocked(invoke).mockClear();
 await act(async()=>root.render(createElement(DeliveryHarness)));expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认交稿')?.disabled).toBe(true);expect(host.querySelector('[data-draft-editor]')?.getAttribute('data-agent-busy')).toBe('true');expect(deliveryContext.mock.calls.at(-1)?.[0].busy).toBe(false);
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='查询原请求')!.click());expect(invoke).toHaveBeenCalledWith('website_publish_call',{method,params:{id:'draft-1'}});expect(call.mock.calls.some(([name])=>name==='task_finish')).toBe(false);await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it.each(['review','draft','topic'])('makes the original cloud request query reachable when restored at %s',async(flowStep)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);call.mockReset().mockResolvedValue({...localCheck,pendingCloudRequest:{kind:'publication',requestKey:'original-request',stage:'unknown'}});vi.mocked(invoke).mockClear();const task={...editableTask(),ui:{tabs:[],flowStep}};
 await act(async()=>root.render(createElement(StructuredWorkflow,{task:task as any,work:localWork,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:()=>{},onUi:()=>{},onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}})));
 const query=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='查询原请求')!;expect(query.disabled).toBe(false);expect(host.querySelector('.flow-stage')?.contains(query)).toBe(true);expect(host.querySelector('.flow-delivery-panel')?.contains(query)).not.toBe(true);expect(host.querySelectorAll('.flow-progress button')).toHaveLength(0);await act(async()=>query.click());expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'status',params:{id:'draft-1'}});await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('shows public delivery as unfinished when retirement fails and retries the saved proof before completing',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);const refreshed=vi.fn(),cloudRefreshed=vi.fn(async()=>{});let attempts=0;
 const blocked={...editableTask(),delivery:{destination:'cloud',articleId:'draft-1',phase:'cleanup_blocked',error:'人工编辑冲突',sha256:'saved-body-sha',fingerprint:'record-and-assets-sha',at:'now'}};
 call.mockReset().mockImplementation(async(method)=>{if(method==='task_check')return localCheck;if(method==='task_get')return blocked;if(method==='task_finish'){if(++attempts===1)throw Error('官网已公开，本地副本回收未完成：人工编辑冲突');return {...blocked,completedAt:'done',delivery:{...blocked.delivery,phase:'complete'}};}throw Error(method);});
 function Harness(){const [task,setTask]=useState<any>(blocked);return createElement(StructuredWorkflow,{task:task as any,work:localWork,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask as any,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:refreshed,onCloudChanged:cloudRefreshed,onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));expect(host.textContent).toContain('官网已公开，本地副本回收未完成');await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='继续回收本地副本')!.click());
 expect(host.textContent).toContain('官网已公开，本地副本回收未完成');expect(host.textContent).not.toContain('稿件已公开到官网，本地副本已回收');expect(refreshed).toHaveBeenCalled();expect(cloudRefreshed).toHaveBeenCalled();
 call.mockClear();await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='继续回收本地副本')!.click());
 expect(call).toHaveBeenCalledWith('task_finish',{taskId:'task-1',destination:'cloud',delivered:true,expectedRevision:7,expectedSha256:'saved-body-sha',expectedFingerprint:'record-and-assets-sha'});expect(call.mock.calls.some(([method])=>method==='task_check')).toBe(false);expect(host.textContent).toContain('任务已完成');await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('querying a completed public request finalizes cloud delivery instead of leaving the task on local saving',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);let checks=0;
 call.mockReset().mockImplementation(async(method,params)=>{if(method==='task_check')return ++checks===1?{...localCheck,pendingCloudRequest:{kind:'publication',requestKey:'original-request',stage:'verify'}}:localCheck;if(method==='task_finish')return {...editableTask(),completedAt:'done',delivery:{destination:params.destination,phase:'complete'}};throw Error(method);});
 // The permanent preview also reads the saved draft, so the status answer is keyed by command rather than by call order.
 vi.mocked(invoke).mockImplementation(async(command:string)=>command==='editorial_call'?{html:''}:command==='list_articles'?[]:{stage:'published',receipt:{publicReadback:true}});
 await act(async()=>root.render(createElement(DeliveryHarness)));await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='查询原请求')!.click());
 expect(call).toHaveBeenCalledWith('task_finish',expect.objectContaining({destination:'cloud',delivered:true}));expect(host.textContent).toContain('任务已完成');await act(async()=>root.unmount());vi.mocked(invoke).mockImplementation(async(command:string)=>command==='list_articles'?[]:null);vi.unstubAllGlobals();
});

it('runs per-card AI retrieval one slot at a time: a second card queues while a run is active and starts after it finishes',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);let current=fixture();
 current.board.sections=[{id:'s',title:'栏目',slotCount:2,slots:[{id:'a',mode:'smart',prompt:'方向一'},{id:'b',mode:'smart',prompt:'方向二'}],items:[]}];
 let runs=0;call.mockReset();call.mockImplementation(async(method,p)=>{if(method==='task_workflow'){current={...current,workflow:{authorized:p.authorized,sources:p.sources}};return current;}if(method==='task_run')return {started:true,runId:'r'+(++runs)};throw Error(method);});
 let setRun:(r:any)=>void=()=>{};
 function Harness(){const [task,setTask]=useState(current),[run,setRunState]=useState<any>({});setRun=setRunState;return createElement(StructuredWorkflow,{task,run,active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 const runCalls=()=>call.mock.calls.filter(c=>c[0]==='task_run').map(c=>c[1]);
 const cards=()=>[...host.querySelectorAll<HTMLButtonElement>('.topic-collect')];
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>cards()[0].click());expect(runCalls()).toEqual([{taskId:'task-1',action:'topic',target:'a'}]);
 await act(async()=>setRun({runId:'r1',busy:true}));
 await act(async()=>cards()[1].click());expect(runCalls()).toHaveLength(1);expect(cards()[1].textContent).toContain('排队中');
 await act(async()=>setRun({runId:'r1',busy:false,status:'已完成'}));
 expect(runCalls()).toEqual([{taskId:'task-1',action:'topic',target:'a'},{taskId:'task-1',action:'topic',target:'b'}]);
 await act(async()=>root.unmount());
});

it('topic toolbar shows board status, hosts the batch AI action and explains a disabled confirm',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);let current=fixture();
 const picked={id:'m',title:'已选素材',summary:'摘要',url:'https://example.org/m',date:'2026-10-01',selected:true,locked:true};
 current.board.sections=[{id:'s',title:'栏目',slotCount:2,slots:[{id:'m',mode:'manual'},{id:'ai',mode:'smart',prompt:'方向'}],items:[picked]}];
 call.mockReset();call.mockImplementation(async(method,p)=>{if(method==='task_workflow'){current={...current,workflow:{authorized:p.authorized,sources:p.sources}};return current;}if(method==='task_run')return {started:true,runId:'r1'};throw Error(method);});
 function Harness(){const [task,setTask]=useState(current);return createElement(StructuredWorkflow,{task,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));
 const bar=host.querySelector('.flow-nav-actions')!,confirm=()=>[...bar.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认选题')!;
 expect(bar.querySelector('.topic-toolbar-status')!.textContent).toBe('1 个 AI 槽位待检索');expect(host.querySelector('.topic-ai-bar')).toBeNull();
 expect(confirm().disabled).toBe(true);expect(confirm().title).toBe('还有 1 个 AI 槽位待检索');
 await act(async()=>bar.querySelector<HTMLButtonElement>('.topic-toolbar-ai')!.click());
 expect(call.mock.calls.filter(c=>c[0]==='task_run').map(c=>c[1])).toEqual([{taskId:'task-1',action:'topic'}]);
 await act(async()=>root.unmount());

 const done=document.createElement('div'),root2=createRoot(done);current=fixture();current.board.sections=[{id:'s',title:'栏目',slotCount:1,slots:[{id:'m',mode:'manual'}],items:[picked]}];
 function Harness2(){const [task,setTask]=useState(current);return createElement(StructuredWorkflow,{task,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask,onUi:()=>{},onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root2.render(createElement(Harness2)));
 const bar2=done.querySelector('.flow-nav-actions')!;expect(bar2.querySelector('.topic-toolbar-status')!.textContent).toBe('已选用 1 张素材');expect(bar2.querySelector('.topic-toolbar-ai')).toBeNull();
 const ok=[...bar2.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认选题')!;expect(ok.disabled).toBe(false);expect(ok.getAttribute('title')).toBeNull();
 await act(async()=>root2.unmount());
});

it('a brand-new topic task opens with nine AI slots saved once; touched or non-empty tasks are left alone',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();call.mockImplementation(async()=>{throw Error('unexpected');});
 async function open(task:any){const host=document.createElement('div'),root=createRoot(host),saves:any[]=[];
  function Harness(){const [t,setT]=useState(task);return createElement(StructuredWorkflow,{task:t,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:setT,onUi:()=>{},onSave:async(patch:any,revision?:number)=>{saves.push({patch,revision});setT((x:any)=>({...x,...patch,revision:(revision||x.revision)+1}));},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
  await act(async()=>root.render(createElement(Harness)));await act(async()=>{await new Promise(r=>setTimeout(r,20));});return {host,root,saves};}
 const fresh=await open(fixture());
 expect(fresh.saves).toHaveLength(1);expect(fresh.saves[0].revision).toBe(1);const board=fresh.saves[0].patch.board;expect(board.sections.flatMap((s:any)=>s.slots)).toHaveLength(9);
 expect(fresh.host.querySelectorAll('.topic-section')).toHaveLength(3);expect(fresh.host.querySelectorAll('.is-smart-slot')).toHaveLength(9);expect(fresh.host.querySelector('.flow-nav-actions .topic-toolbar-status')!.textContent).toBe('9 个 AI 槽位待检索');
 await act(async()=>fresh.root.unmount());
 const touched=await open({...fixture(),revision:2});expect(touched.saves).toHaveLength(0);await act(async()=>touched.root.unmount());
 const filled=fixture();filled.board.sections=[{id:'s',title:'栏目',slotCount:1,slots:[{id:'m',mode:'manual'}],items:[]}];const withSections=await open(filled);expect(withSections.saves).toHaveLength(0);await act(async()=>withSections.root.unmount());
 const done=await open({...fixture(),completedAt:'2026-10-06'});expect(done.saves).toHaveLength(0);await act(async()=>done.root.unmount());
});

it('a finished task has no top bar or delivery panel; only the jump card remains',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset().mockImplementation(async()=>{throw Error('unexpected');});vi.mocked(invoke).mockClear();
 async function open(delivery:any){const host=document.createElement('div'),root=createRoot(host);const task={...fixture(),completedAt:'2026-10-06',workIds:['draft-1'],articleId:'draft-1',outlineConfirmed:'o',topicConfirmed:'t',delivery,ui:{tabs:[],flowStep:'deliver'}};
  function Harness(){return createElement(StructuredWorkflow,{task,run:{},work:localWork,active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:()=>{},onUi:()=>{},onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
  await act(async()=>root.render(createElement(Harness)));return {host,root};}
 const local=await open({destination:'local',phase:'complete'});expect(local.host.querySelector('.flow-delivery-complete')).toBeNull();
 expect(local.host.querySelector('.flow-delivery-panel')).toBeNull();expect(local.host.querySelector('.flow-navigation')).toBeNull();expect(local.host.querySelector('.flow-done-card')).not.toBeNull();await act(async()=>local.root.unmount());
 const cloud=await open({destination:'cloud',phase:'complete'});expect(cloud.host.querySelector('.flow-delivery-complete')).toBeNull();
 await act(async()=>cloud.root.unmount());
});
