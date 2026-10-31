import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import ContentWorkspace from '../editorial/ContentWorkspace';
import ToastViewport from '../components/ToastViewport';
import {useToasts} from '../toast';
import {WindowChromeContext} from '../components/PaneToolbar';
import {openCreativeSpace} from '../components/SpaceEntrances';

const {invoke,listen,shortcutUi}=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),shortcutUi:{uiScale:100,modalOpen:false,menuOpen:false,aiOpen:false}}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen}));
vi.mock('../store',()=>({useUi:Object.assign((selector:any)=>selector(shortcutUi),{getState:()=>shortcutUi})}));
vi.mock('../editorial/EditorialRichEditor',()=>({default:({text,onChange}:{text:string;onChange:(value:string)=>void})=>createElement('textarea',{'aria-label':'Markdown 正文',value:text,onChange:(event:{target:{value:string}})=>onChange(event.target.value)})}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
vi.mock('../publications/PublicationReader',()=>({default:()=>createElement('div',{},'readonly external reader')}));
const local={id:'local-one',shortTitle:'本地稿件',canonicalPath:'articles/annex/新闻聚合/01_稿件/正文.md',batchDate:null,markdown:'# saved',sha256:'sha',archiveCategory:'学界犀闻',stage:'local',sync:{state:'unpublished',fingerprint:'fp'}};
const cloud={key:'news:cloud-one',articleId:'cloud-one',title:'仅云端稿件',summary:'摘要',kind:'news',category:'学者观察',dateLabel:'2026-10-02',url:'https://example.org/cloud',version:1,publishedVersion:null,sourceUrls:[]};
let root:Root,host:HTMLDivElement,toastRoot:Root,toastHost:HTMLDivElement,cloudVisibility:number|null,tasks:any[],actionReceipt:any;
const navigateToManuscripts=()=>root.render(createElement(ContentWorkspace,{active:true,view:'manuscripts'}));
const navigateToCreation=()=>root.render(createElement(ContentWorkspace,{active:true,view:'conversations'}));
const fixtureTask=(id='task-one')=>({id,mode:'observation',title:id,brief:'',days:30,revision:1,stage:'topic',articleId:'draft-'+id,workIds:[],board:{titles:[],sections:[]},outline:{blocks:[]},assets:[],ui:{tabs:[],composer:''}});
beforeEach(()=>{
  cloudVisibility=null;actionReceipt=null;tasks=[fixtureTask(),fixtureTask('task-two')];Object.assign(shortcutUi,{modalOpen:false,menuOpen:false,aiOpen:false});
  listen.mockReset().mockImplementation(async()=>()=>{});
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('ResizeObserver',class{callback:()=>void;constructor(cb:()=>void){this.callback=cb;}observe(el:HTMLElement){Object.defineProperty(el,'clientWidth',{configurable:true,value:1920});this.callback();}disconnect(){}});localStorage.clear();
  invoke.mockReset().mockImplementation(async(command:string,args:any)=>{
    if(command==='get_setting')return null;if(command==='set_setting')return;
    if(command==='space_context')return {site:ACTIVE_SITE};
    if(command==='workbench_device_name')return 'Isaac 的 Mac Studio';
    if(command==='workbench_exit_guard'||command==='workbench_finish_exit'||command==='set_reader_shortcuts')return;
    if(command==='cursor_agent_call'){const p=args.params||{};if(args.method==='notebook_catalog')return {siteId:'scholay-today',sections:[{id:'briefings',name:'学界犀闻'},{id:'observations',name:'学者观察'},{id:'calendar',name:'学术日历'},{id:'resources',name:'学术资源'}],skills:[]};if(args.method==='notebook_brands')return [];if(args.method==='notebook_open'){const task=tasks.find(t=>t.id===p.taskId);task.notebook??={version:1,title:task.workIds.length?'本地稿件':'',kind:'article',skills:['observation'],fields:{},sources:[],blocks:[{id:'row-'+task.id,type:'markdown',text:task.workIds.length?'saved':'',state:task.workIds.length?'ready':'placeholder',locked:!!task.workIds.length,sourceIds:[]}]};return {...task};}if(args.method==='task_get')return tasks.find(t=>t.id===p.taskId);if(args.method==='task_list')return tasks;if(args.method==='task_settings')return {parallelism:2};if(['task_states','task_leases','task_lease'].includes(args.method))return {};if(args.method==='task_update'){const task=tasks.find(t=>t.id===p.taskId);Object.assign(task,{...p.patch,...(p.patch.ui?{ui:{...task.ui,...p.patch.ui}}:{})});return task;}if(args.method==='task_delete'){tasks=tasks.filter(t=>t.id!==p.taskId);return {ok:true};}if(args.method==='task_create'){const task={...fixtureTask('task-new'),...p};tasks.push(task);return task;}return {connected:false,busy:false,status:'未连接',history:[],pending:[]};}
    if(command==='editorial_location')return {path:'/fixture'};
    if(command==='list_articles')return [];
    if(command==='publications_call')return {drafts:[],website:{updatedAt:'2026-10-02',scope:'all',items:[{...cloud,publishedVersion:cloudVisibility}]},feishu:{updatedAt:null,records:[],configured:false}};
    if(args.method==='reconcile')return {changed:false,results:[]};
    if(args.method==='snapshot')return {connection:{configured:true,origin:'https://today.scholay.com'},articles:[local]};
    if(args.method==='draft_list')return {articles:[local]};
    if(args.method==='draft_read')return local;
    if(args.method==='draft_preview')return {html:'<h1>Saved</h1>'};
    if(args.method==='cloud_action'){cloudVisibility=args.params.action==='publish'?1:null;return actionReceipt={action:args.params.action,status:'success',requestKey:'test-action',publicReadback:args.params.action==='publish',withdrawnReadback:args.params.action==='withdraw'};}
    if(args.method==='cloud_action_cached')return actionReceipt;
    if(args.method==='cloud')return {id:'cloud-one',html:'<h1>云端定稿</h1>',metadata:{date:'2026-10-02'},version:1,publishedVersion:cloudVisibility};
    if(args.method==='inspect')return {id:local.id,title:local.shortTitle,canonicalPath:local.canonicalPath,sourceSha256:local.sha256,metadata:{date:'2026-10-05',summary:'摘要',category:'学界犀闻',author:'编辑'},metadataSha256:'meta',stage:'local',stale:false,validation:'',receipt:null,html:'<h1>Saved</h1>',warnings:[],prepared:null,sync:local.sync};
    if(args.method==='publication_status')return {};
    if(args.method==='workspace_stamp')return {stamp:'1'};
    throw Error('Unexpected operation '+args.method);
  });
  useToasts.getState().dismiss();toastHost=document.createElement('div');document.body.append(toastHost);toastRoot=createRoot(toastHost);act(()=>toastRoot.render(createElement(ToastViewport)));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);window.addEventListener('scholay-open-manuscripts',navigateToManuscripts);window.addEventListener('scholay-open-creation',navigateToCreation);
});
afterEach(()=>{window.removeEventListener('scholay-open-manuscripts',navigateToManuscripts);window.removeEventListener('scholay-open-creation',navigateToCreation);act(()=>{root.unmount();toastRoot.unmount();});host.remove();toastHost.remove();useToasts.getState().dismiss();vi.unstubAllGlobals();});
const button=(text:string)=>{const b=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text&&b.closest<HTMLElement>('.library-manager')?.dataset.active!=='false');if(!b)throw Error('Missing '+text);return b;};
const source=(location:string)=>host.querySelector<HTMLElement>('[data-scope='+location+'] .manager-source')!;
async function switchList(scope:'local'|'cloud'){await act(async()=>root.render(createElement(ContentWorkspace,{active:true,view:scope==='cloud'?'works':'manuscripts'})));}
const check=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('[data-active=true] fieldset button')].find(x=>x.textContent?.includes(text))!;
async function selectWork(title:string){await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('[data-active=true] .manager-card')].find(x=>x.textContent?.includes(title))!.click());}
async function start(manuscripts=true){await act(async()=>root.render(createElement(ContentWorkspace,{active:true,view:manuscripts?'manuscripts':'conversations'})));}
it('opens works with only cloud content and keeps a divergent local title out of the cloud list',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{const result=await original(command,args);if(command==='publications_call'&&args.method==='snapshot')return {...result,website:{...result.website,items:[{...cloud,articleId:local.id,title:'云端定稿标题'}]}};return result;});
 await switchList('cloud');
 expect(host.querySelector('[data-active=true] .manager-card strong')?.textContent).toBe('云端定稿标题');
 expect(host.querySelector('.manager-locations')).toBeNull();
 expect(invoke.mock.calls.some(([,args])=>args?.method==='task_create')).toBe(false);
 await switchList('local');expect(host.querySelector('[data-active=true] .manager-card strong')?.textContent).toBe('本地稿件');
});
it('opens a completed cloud work conversation without starting or deleting it',async()=>{
 const completed={...fixtureTask('finished'),title:'原始创作对话',articleId:'cloud-one',workIds:['cloud-one'],completedAt:'2026-10-23',updatedAt:'2026-10-23'};
 tasks=[completed,fixtureTask('unrelated')];
 await switchList('cloud');await selectWork('仅云端稿件');
 const summary=host.querySelector<HTMLElement>('[data-active=true] summary[aria-label="创作记录"]')!;
 await act(async()=>summary.click());
 const records=host.querySelector('[data-active=true] [aria-label="相关创作对话"]')!;
 expect(records.textContent).toContain('原始创作对话');expect(records.textContent).toContain('已完成');expect(records.textContent).not.toContain('unrelated');
 await act(async()=>records.querySelector<HTMLButtonElement>('button')!.click());
 expect(host.querySelector('.task-history-item[aria-current=true]')?.textContent).toContain('原始创作对话');
 expect(host.querySelector('.completed-creation-history')?.textContent).toContain('已完成 · 创作记录');
 expect(tasks.find(t=>t.id==='finished')?.completedAt).toBe('2026-10-23');
 expect(invoke.mock.calls.some(([,args])=>['task_create','task_delete','task_run','prompt','connect'].includes(args?.method))).toBe(false);
 await switchList('cloud');expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('仅云端稿件');
});
it('reports missing creation history without inventing a conversation',async()=>{
 await switchList('cloud');await selectWork('仅云端稿件');
 await act(async()=>host.querySelector<HTMLElement>('[data-active=true] summary[aria-label="创作记录"]')!.click());
 expect(host.querySelector('[data-active=true] [aria-label="相关创作对话"]')?.textContent).toBe('暂无关联的创作对话');
 expect(invoke.mock.calls.some(([,args])=>args?.method==='task_create')).toBe(false);
});
it('deletes a local manuscript only after confirmation while retaining cloud works and conversations',async()=>{
 let removed=false;const original=invoke.getMockImplementation()!;
 tasks[0].workIds=[local.id];
 invoke.mockImplementation(async(command,args)=>{
  if(command==='website_publish_call'&&args.method==='local_action'){removed=true;return {id:local.id,deleted:true,backup:'.local/editorial-trash/fixture'};}
  const result=await original(command,args);
  return removed&&command==='website_publish_call'&&args.method==='snapshot'?{...result,articles:[]}:result;
 });
 await start();await selectWork('本地稿件');
 expect(button('删除本地').disabled).toBe(false);
 await act(async()=>button('删除本地').click());
 expect(host.querySelector('[role=alertdialog]')?.textContent).toContain('可恢复备份');
 expect(removed).toBe(false);
 await act(async()=>button('取消').click());expect(removed).toBe(false);
 await act(async()=>button('删除本地').click());
 await act(async()=>button('确认操作').click());
 expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'local_action',params:{id:local.id,action:'delete',confirmed:true,expectedFingerprint:'fp'}});
 expect(source('local').querySelector('small')?.textContent).toBe('0');
 expect(tasks[0].workIds).toEqual([local.id]);
 expect(invoke.mock.calls.some(([,args])=>['task_delete','cloud_action'].includes(args?.method))).toBe(false);
 await switchList('cloud');expect(host.querySelector('[data-active=true] .manager-card strong')?.textContent).toBe('仅云端稿件');
});
it('restores a manuscript after leaving and remounting its independent view without creating a dialogue',async()=>{
 tasks=[];
 await start();await selectWork('本地稿件');
 await switchList('cloud');await selectWork('仅云端稿件');
 await act(async()=>root.render(createElement(ContentWorkspace,{active:false,view:'works'})));
 await act(async()=>root.render(createElement(ContentWorkspace,{active:true,view:'manuscripts'})));
 expect(host.querySelector('.creation-tabs')).toBeNull();expect(host.querySelector('[data-active=true]')?.getAttribute('data-scope')).toBe('local');
 expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('本地稿件');
 await act(async()=>root.render(null));await act(async()=>root.render(createElement(ContentWorkspace,{active:true,view:'manuscripts'})));
 expect(host.querySelector('.creation-tabs')).toBeNull();expect(host.querySelector('[data-active=true]')?.getAttribute('data-scope')).toBe('local');
 expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('本地稿件');
 await switchList('cloud');expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('仅云端稿件');
 expect(invoke.mock.calls.some(([,args])=>args?.method==='task_create')).toBe(false);
});
it('creates a manuscript from its own tab and opens the editor without creating a dialogue',async()=>{
 let created:typeof local|undefined,finish!:()=>void;const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='editorial_call'&&args.method==='draft_create'){await new Promise<void>(resolve=>{finish=resolve;});created={...local,id:args.params.id,shortTitle:args.params.title,markdown:args.params.markdown};return created;}
  if(created&&command==='website_publish_call'&&args.method==='snapshot')return {connection:{configured:true},articles:[local,created]};
  if(created&&command==='editorial_call'&&args.method==='draft_list')return {articles:[local,created]};
  if(created&&command==='editorial_call'&&args.method==='draft_read'&&args.params.id===created.id)return created;
  if(created&&command==='website_publish_call'&&args.method==='inspect'&&args.params.id===created.id)return {...await original(command,args),id:created.id};
  return original(command,args);
 });
 await start();await act(async()=>button('新建稿件').click());
 expect(invoke.mock.calls.some(([,args])=>args?.method==='draft_create')).toBe(false);
 const input=host.querySelector<HTMLInputElement>('[role=dialog] input')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'独立稿件');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>button('创建').click());
 const pending:Promise<unknown>[]=[];window.dispatchEvent(new CustomEvent('scholay-space-will-switch',{detail:{promises:pending}}));
 await expect(Promise.all(pending)).rejects.toThrow();
 await act(async()=>finish());
 expect(created?.id).toMatch(/^draft-/);expect(created?.markdown).toBe('# 独立稿件\n\n');
 expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('独立稿件');
 expect(host.querySelector('[data-active=true] [aria-label="Markdown 正文"]')).not.toBeNull();
 expect(invoke.mock.calls.some(([,args])=>args?.method==='task_create')).toBe(false);
});
it('loads local inventory after StrictMode replays startup effects',async()=>{
 await act(async()=>root.render(createElement(StrictMode,null,createElement(ContentWorkspace,{active:true,view:'manuscripts'}))));
 expect(host.querySelector('[data-active=true] .manager-card')?.textContent).toContain('本地稿件');
 expect(host.querySelector<HTMLButtonElement>('[data-active=true] .manager-refresh')!.disabled).toBe(false);
});

it('shows local inventory before a slow catalog cache and preserves it if the cache fails',async()=>{
 const original=invoke.getMockImplementation()!;let rejectCache!:(e:Error)=>void;
 invoke.mockImplementation((command,args)=>command==='publications_call'&&args.method==='snapshot'?new Promise((_,reject)=>{rejectCache=reject;}):original(command,args));
 await start();expect(host.querySelector('[data-active=true] .manager-card')?.textContent).toContain('本地稿件');
 expect(invoke.mock.calls.some(([,args])=>args?.method==='refresh_website')).toBe(false);
 await act(async()=>rejectCache(Error('本机发布缓存无法读取')));
 expect(host.querySelector('[data-active=true] .manager-card')?.textContent).toContain('本地稿件');
 expect(toastHost.textContent).toContain('本机发布缓存无法读取');
});

it('automatically reads an uncached cloud list once when opened, with loading feedback and no writes',async()=>{
 const original=invoke.getMockImplementation()!;let cached=false,finish!:(value:unknown)=>void;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='publications_call'&&args.method==='refresh_website'){await new Promise(resolve=>{finish=resolve;});cached=true;return {};}
  const result=await original(command,args);
  if(command==='publications_call'&&args.method==='snapshot'&&!cached)return {...result,website:{updatedAt:null,items:[]}};
  return result;
 });
 await start();expect(host.querySelector('[data-active=true] .manager-card')?.textContent).toContain('本地稿件');
  await switchList('cloud');expect(host.querySelector('[data-active=true] .manager-empty[role=status]')?.textContent).toContain('正在读取作品');
 expect(host.querySelector<HTMLButtonElement>('[data-active=true] .manager-refresh')!.disabled).toBe(true);
 await switchList('local');await switchList('cloud');
 expect(invoke.mock.calls.filter(([,args])=>args?.method==='refresh_website')).toHaveLength(1);
 await act(async()=>finish({}));expect(host.querySelector('[data-active=true] .manager-card')?.textContent).toContain('仅云端稿件');
 await act(async()=>root.render(createElement(ContentWorkspace,{active:false,view:'works'})));await start();
 expect(invoke.mock.calls.filter(([,args])=>args?.method==='refresh_website')).toHaveLength(1);
 expect(invoke.mock.calls.filter(([command])=>['publications_call','website_publish_call'].includes(command)).every(([,args])=>['snapshot','refresh_website','reconcile'].includes(args.method))).toBe(true);
});

it('retains cached cloud works offline without repeatedly retrying the automatic read',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation((command,args)=>command==='publications_call'&&args.method==='refresh_website'?Promise.reject(Error('云端暂时无法连接')):original(command,args));
 await start();await switchList('cloud');
 expect(host.querySelector('[data-active=true] .manager-card')?.textContent).toContain('仅云端稿件');expect(toastHost.textContent).toContain('云端暂时无法连接');
 await act(async()=>window.dispatchEvent(new Event('focus')));
 await switchList('local');await switchList('cloud');
 expect(invoke.mock.calls.filter(([,args])=>args?.method==='refresh_website')).toHaveLength(1);
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-active=true] .manager-refresh')!.click());
 expect(invoke.mock.calls.filter(([,args])=>args?.method==='refresh_website')).toHaveLength(2);
});

it('shows cached cloud works even when reading local inventory fails',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation((command,args)=>command==='website_publish_call'&&args.method==='snapshot'?Promise.reject(Error('本地稿件不可读')):original(command,args));
 await start();await switchList('cloud');
 expect(host.querySelector('[data-active=true] .manager-card')?.textContent).toContain('仅云端稿件');
 expect(toastHost.textContent).toContain('本地稿件不可读');
});

it('discards a cloud read completed after leaving its workspace',async()=>{
 const original=invoke.getMockImplementation()!;let finish!:(value:unknown)=>void;
 invoke.mockImplementation((command,args)=>command==='publications_call'&&args.method==='refresh_website'?new Promise(resolve=>{finish=resolve;}):original(command,args));
 await start();await switchList('cloud');await act(async()=>root.render(null));
 invoke.mockClear();await act(async()=>finish({}));
 expect(invoke.mock.calls.filter(([command])=>['publications_call','website_publish_call'].includes(command))).toHaveLength(0);
});

it('reads again after a publication completes during an automatic catalog read',async()=>{
 const original=invoke.getMockImplementation()!;let changed=false,attempts=0,finish!:(value:unknown)=>void;
 invoke.mockImplementation((command,args)=>{
  if(command==='website_publish_call'&&args.method==='reconcile')return Promise.resolve({changed,results:[]});
  if(command==='publications_call'&&args.method==='refresh_website'&&++attempts===1)return new Promise(resolve=>{finish=resolve;});
  return original(command,args);
 });
 await start();await switchList('cloud');changed=true;
 await act(async()=>window.dispatchEvent(new Event('focus')));expect(attempts).toBe(1);
 await act(async()=>finish({}));expect(attempts).toBe(2);
});

it('waits for asynchronous UI flush listeners before shutdown and preserves synchronous listeners',async()=>{
 await start(false);let resolveSave!:(value:unknown)=>void;const save=new Promise(resolve=>{resolveSave=resolve;});let legacySeen=false;
 const persist=(event:Event)=>(event as CustomEvent<{promises:Promise<unknown>[]}>).detail.promises.push(save),legacy=()=>{legacySeen=true;};
 window.addEventListener('scholay-workbench-flush',persist);window.addEventListener('scholay-workbench-flush',legacy);
 try{const exit=listen.mock.calls.find(([name])=>name==='workbench-exit-requested')![1];await act(async()=>exit({payload:{}}));
  expect(legacySeen).toBe(true);expect(invoke.mock.calls.some(([,args])=>args?.method==='task_shutdown')).toBe(false);expect(invoke.mock.calls.some(([command])=>command==='workbench_finish_exit')).toBe(false);
  await act(async()=>{resolveSave({saved:true});await save;});
  expect(invoke.mock.calls.some(([,args])=>args?.method==='task_shutdown')).toBe(true);expect(invoke.mock.calls.some(([command])=>command==='workbench_finish_exit')).toBe(true);
 }finally{window.removeEventListener('scholay-workbench-flush',persist);window.removeEventListener('scholay-workbench-flush',legacy);}
});
it('keeps the app open and reports a rejected asynchronous UI save',async()=>{
 await start(false);const persist=(event:Event)=>(event as CustomEvent<{promises:Promise<unknown>[]}>).detail.promises.push(Promise.reject(Error('图库草稿保存失败')));
 window.addEventListener('scholay-workbench-flush',persist);
 try{const exit=listen.mock.calls.find(([name])=>name==='workbench-exit-requested')![1];await act(async()=>exit({payload:{}}));
  expect(toastHost.querySelector('[role=alert]')?.textContent).toContain('图库草稿保存失败');expect(invoke.mock.calls.some(([,args])=>args?.method==='task_shutdown')).toBe(false);expect(invoke.mock.calls.some(([command])=>command==='workbench_finish_exit')).toBe(false);
 }finally{window.removeEventListener('scholay-workbench-flush',persist);}
});
it('keeps the current workbench usable when native selection fails after its UI save',async()=>{
 const original=invoke.getMockImplementation()!;
 let bridgeClosed=false;
 invoke.mockImplementation((command,args)=>{
  if(command==='space_select')return Promise.reject(Error('目标资料库不可用'));
  if(command==='cursor_agent_call'){
   if(args.method==='task_shutdown')bridgeClosed=true;
   else if(bridgeClosed)return Promise.reject(Error('正在退出，请重新打开工作台'));
  }
  return original(command,args);
 });
 await start(false);
 let finish!:(value:unknown)=>void;
 const saved=new Promise(resolve=>{finish=resolve;});
 const persist=(event:Event)=>(event as CustomEvent<{promises:Promise<unknown>[]}>).detail.promises.push(saved);
 window.addEventListener('scholay-workbench-flush',persist);
 try{
  const failed=expect(openCreativeSpace('pets')).rejects.toThrow('目标资料库不可用');
  await Promise.resolve();expect(invoke.mock.calls.some(([command])=>command==='space_select')).toBe(false);
  await act(async()=>{finish({saved:true});await failed;});
  expect(bridgeClosed).toBe(false);
  // A failed native selection remounts this same space. Reads must still work.
  await act(async()=>root.render(null));await start(false);
  expect(host.querySelectorAll('.task-history-item').length).toBeGreaterThan(0);
  expect(host.textContent).not.toContain('正在退出');
  expect(invoke.mock.calls.some(([,args])=>args?.method==='task_shutdown')).toBe(false);
 }finally{window.removeEventListener('scholay-workbench-flush',persist);}
});
it('restores completed, stopped and interrupted task labels without starting the agent',async()=>{
  tasks=[
    {...fixtureTask('done'),stage:'draft',workIds:['draft-done'],runtime:{busy:false,status:'连接已结束，可继续',lastRunStatus:'已完成'}},
    {...fixtureTask('ended'),completedAt:'done'},
    {...fixtureTask('stopped'),runtime:{busy:false,status:'已停止'}},
    {...fixtureTask('interrupted'),runtime:{busy:true,status:'正在处理',lastRunStatus:null}},
    {...fixtureTask('failed'),runtime:{busy:false,status:'连接已结束，可继续',lastRunStatus:'Cursor 执行异常，可继续重试'}},
    {...fixtureTask('confirm'),mode:'xiwen',board:{titles:['标题'],sections:[{id:'a',title:'栏目',items:[]}]},runtime:{busy:false,status:'已完成'}}
  ];
  await start(false);
  const label=(id:string)=>[...host.querySelectorAll('.task-history-item')].find(x=>x.textContent?.includes(id))?.querySelector('[role=img]')?.getAttribute('aria-label');
  expect(label('done')).toContain('写作 · 待交稿');expect(label('ended')).toContain('已结束 · 完成');expect(label('stopped')).toContain('已停止');expect(label('interrupted')).toContain('上次执行已中断');expect(label('failed')).toContain('异常');expect(label('confirm')).toContain('等你确认');
  expect(invoke.mock.calls.some(([command,args])=>command==='cursor_agent_call'&&['connect','prompt'].includes(args.method))).toBe(false);
});
it('keeps source-discovery tasks out of content tasks; they belong to Settings › Subscriptions',async()=>{
 tasks=[{...fixtureTask('old-discovery'),mode:'rss'},fixtureTask('content')];
 await start(false);
 expect(host.textContent).not.toContain('old-discovery');expect(host.querySelectorAll('.task-history-item')).toHaveLength(1);
 await act(async()=>button('新建对话').click());
 expect(host.querySelector('[aria-label="新建AI 搜索订阅源"]')).toBeNull();expect(host.querySelector('[aria-label="新建RSS 来源发现"]')).toBeNull();
 expect(tasks.some(t=>t.id==='old-discovery')).toBe(true);
});

it('keeps stored image conversations out of content tasks and removes their creation template',async()=>{
 tasks=[{...fixtureTask('old-image'),mode:'image'},fixtureTask('content')];
 await start(false);
 expect(host.textContent).not.toContain('old-image');expect(host.querySelector('.image-task-panel')).toBeNull();
 await act(async()=>button('新建对话').click());
 expect(host.querySelector('[aria-label="新建图片生成"]')).toBeNull();
 expect(tasks.some(t=>t.id==='old-image')).toBe(true);
});
it('separates position, category and card management and confirms cloud actions',async()=>{
  await start();expect(host.querySelector('.manager-locations')).toBeNull();expect(host.querySelectorAll('fieldset')).toHaveLength(1);
  await switchList('cloud');await selectWork('仅云端稿件');expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);expect(host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.disabled).toBe(false);expect(host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.getAttribute('aria-checked')).toBe('false');expect([...host.querySelectorAll('button')].some(x=>x.textContent==='删除本地')).toBe(false);
  await act(async()=>host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.click());expect(host.querySelector('[role=alertdialog]')?.textContent).toContain('云端 v1');expect(invoke.mock.calls.some(([,x])=>x?.method==='cloud_action')).toBe(false);
  await act(async()=>button('取消').click());expect(host.querySelector('[role=alertdialog]')).toBeNull();
});
it('exports cloud works directly while keeping previews responsive and never pulls an editing copy',async()=>{
 const original=invoke.getMockImplementation()!;let finish!:(value:unknown)=>void;
 invoke.mockImplementation((command,args)=>command==='editorial_export_cloud'?new Promise(resolve=>{finish=resolve;}):original(command,args));
 await start();await switchList('cloud');await selectWork('仅云端稿件');
 const exportButton=button('导出');
 expect(exportButton.closest('.work-action-controls')).not.toBeNull();
 await act(async()=>{exportButton.click();exportButton.click();});
 expect(exportButton.disabled).toBe(true);expect(exportButton.textContent).toBe('正在导出…');
 expect(invoke.mock.calls.filter(([command])=>command==='editorial_export_cloud')).toEqual([['editorial_export_cloud',{id:'cloud-one'}]]);
 await act(async()=>button('公众号预览').click());
 expect(button('正在导出…')).toBe(exportButton);expect(button('官网预览').disabled).toBe(false);
 await act(async()=>finish({directory:'/exports/云端定稿',images:1,version:1}));
 expect(button('导出').disabled).toBe(false);
 expect(invoke.mock.calls.some(([,args])=>['pull','cloud_action','prepare','publish','save_cloud'].includes(args?.method))).toBe(false);
 await switchList('local');
 expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);
});
it('cancelling a cloud export is silent and a failed export uses a retryable modal',async()=>{
 const original=invoke.getMockImplementation()!;let fail=false;
 invoke.mockImplementation((command,args)=>command==='editorial_export_cloud'?(fail?Promise.reject(Error('云端连接暂时不可用')):Promise.resolve(null)):original(command,args));
 await start();await switchList('cloud');await selectWork('仅云端稿件');
 await act(async()=>button('导出').click());
 expect(document.querySelector('[role=alertdialog]')).toBeNull();expect(button('导出').disabled).toBe(false);
 fail=true;await act(async()=>button('导出').click());
 expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('云端连接暂时不可用');
 expect(host.querySelector('.work-viewer [role=alert]')).toBeNull();
 await act(async()=>(document.querySelector('.modal-actions button') as HTMLButtonElement).click());
 expect(document.querySelector('[role=alertdialog]')).toBeNull();expect(button('导出').disabled).toBe(false);
});
it('a dirty editor remains mounted across task switches and cannot be deleted',async()=>{
  await start();await selectWork('本地稿件');await act(async()=>button('编辑').click());
  const text=host.querySelector<HTMLTextAreaElement>('[aria-label="Markdown 正文"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(text,'# unsaved');text.dispatchEvent(new Event('input',{bubbles:true}));});
  await start(false);await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.task-history-item')].find(b=>b.textContent?.includes('task-two'))!.click());await start(true);expect(host.querySelector('[aria-label="更多作品操作"]')).toBeNull();expect(text.value).toBe('# unsaved');
  expect(button('删除本地').disabled).toBe(true);
  expect(invoke.mock.calls.some(([,x])=>['draft_save','local_action','publish'].includes(x?.method))).toBe(false);
});

it('distinguishes a pending cloud operation from unsaved edits and releases the switch guard after cancellation',async()=>{
 const original=invoke.getMockImplementation()!;let waiting=false,finish!:(value:any)=>void;
 invoke.mockImplementation((command,args)=>waiting&&args?.method==='cloud'?new Promise(resolve=>{finish=resolve;}):original(command,args));
 await start();await switchList('cloud');await selectWork('仅云端稿件');
 const unblocked=vi.fn();window.addEventListener('scholay-space-switch-unblocked',unblocked);
 const switching=()=>{const promises:Promise<unknown>[]=[];window.dispatchEvent(new CustomEvent('scholay-space-will-switch',{detail:{promises}}));return Promise.all(promises);};
 try{
  waiting=true;await act(async()=>host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.click());
  await expect(switching()).rejects.toThrow('官网操作');
  expect(invoke.mock.calls.some(([,args])=>args?.method==='task_shutdown')).toBe(false);
  await act(async()=>finish({id:'cloud-one',version:1,publishedVersion:null,html:'',metadata:{date:'2026-10-02'}}));
  await expect(switching()).rejects.toThrow('待确认事项');
  await act(async()=>button('取消').click());
  expect(unblocked).toHaveBeenCalled();await expect(switching()).resolves.toBeDefined();
 }finally{window.removeEventListener('scholay-space-switch-unblocked',unblocked);}
});

it('publishes and withdraws through explicit confirmed actions and refreshes the list',async()=>{
  await start();await switchList('cloud');await selectWork('仅云端稿件');
  expect(host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.getAttribute('aria-checked')).toBe('false');expect(host.textContent).not.toContain('非公开');
  await act(async()=>host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.click());expect(host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.disabled).toBe(true);
  await act(async()=>button('取消').click());expect(cloudVisibility).toBeNull();
  await act(async()=>host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.click());await act(async()=>button('确认操作').click());
  expect(button('编辑').disabled).toBe(false);expect(host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.getAttribute('aria-checked')).toBe('true');expect(host.querySelector('[data-active=true] .manager-card')?.getAttribute('aria-label')).toContain('已公开');
  expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'cloud_action',params:{id:'cloud-one',action:'publish',confirmed:true,expectedVersion:1,expectedPublishedVersion:null}});
  await act(async()=>host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.click());expect(host.querySelector('[role=alertdialog]')?.textContent).toContain('状态变为未公开');
  await act(async()=>button('确认操作').click());expect(cloudVisibility).toBeNull();expect(host.querySelector('.work-cloud-meta')?.textContent).toContain('未公开');
  expect(host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.getAttribute('aria-checked')).toBe('false');
});

it('filters immediately while a local read is unresolved and resets the old scroll position',async()=>{
  const original=invoke.getMockImplementation()!;
  let finish:(value:any)=>void=()=>{};
  invoke.mockImplementation((command,args)=>args?.method==='draft_read'?new Promise(resolve=>{finish=resolve;}):original(command,args));
  await start();await switchList('local');
  expect(host.querySelector('.creation-tabs')).toBeNull();
  const scroll=host.querySelector<HTMLDivElement>('[data-active=true] .manager-card-scroll')!;scroll.scrollTop=340;
  await switchList('local');await switchList('cloud');
  expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);
  expect(host.querySelector('[data-active=true] .manager-card strong')?.textContent).toBe('仅云端稿件');
  await act(async()=>finish(local));
  await selectWork('仅云端稿件');expect(host.querySelector('.work-detail-heading h2')?.textContent).toBe('仅云端稿件');
});
it('combines sidebar tags with search and renders locations as labeled icons in the list',async()=>{
  await start();await switchList('cloud');expect(host.querySelector('[aria-label=公开性筛选]')).toBeNull();
  expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);
  expect(host.querySelector('.manager-card [aria-label="today.scholay.com"] svg')).not.toBeNull();
  expect(host.querySelector('.manager-card [aria-label="today.scholay.com"]')?.textContent).toBe('');
  await act(async()=>check('学者观察').click());expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);
  expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);
  const search=host.querySelector<HTMLInputElement>('[aria-label="搜索作品"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'不存在的标题');search.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(0);
});

it('keeps cloud category and search without a visibility selector',async()=>{
  await start();await switchList('cloud');
  expect(host.querySelector('.manager-search [aria-label="公开性筛选"]')).toBeNull();
  expect(host.querySelector('[data-active=true] .manager-card time')?.textContent).toBe('2026-10-02');
  await act(async()=>check('学者观察').click());
  expect(check('学者观察').getAttribute('aria-pressed')).toBe('true');expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);
});

it('keeps a structured-task editor and its unsaved text when switching away and back',async()=>{
 tasks[0]={...tasks[0],mode:'xiwen',articleId:'local-one',workIds:['local-one'],ui:{tabs:[],flowStep:'review'},workflow:{sources:'combined',authorized:true}};
 const original=invoke.getMockImplementation()!;invoke.mockImplementation((command,args)=>args?.method==='task_check'?{ready:false,reviewed:false,images:0,checks:[]}:original(command,args));
 await start(false);
 const text=host.querySelector<HTMLTextAreaElement>('[aria-label="内容行 1"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(text,'# structured unsaved');text.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(host.querySelector('.flow-progress')).toBeNull();expect(host.querySelector('.flow-progress button')).toBeNull();
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.task-history-item')].find(b=>b.textContent?.includes('task-two'))!.click());
 expect(text.isConnected).toBe(true);expect(text.value).toBe('# structured unsaved');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.task-history-item')].find(b=>b.textContent?.includes('task-one'))!.click());expect(text.value).toBe('# structured unsaved');
 expect(host.querySelectorAll('[aria-label="内容行 1"]')).toHaveLength(2);
});

it('opens the library without a task, deduplicates work tabs and keeps pending edits across tabs',async()=>{
 tasks=[];await start();await selectWork('本地稿件');await act(async()=>button('编辑').click());
 const text=host.querySelector<HTMLTextAreaElement>('[aria-label="Markdown 正文"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(text,'# preserved library edit');text.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'task_lease',params:{editorId:'library',articleId:'local-one',release:false}});
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="关闭 本地稿件"]')!.click());
 expect(toastHost.querySelector('[role=alert]')?.textContent).toContain('请先保存');
 await switchList('cloud');await selectWork('仅云端稿件');
 expect(text.value).toBe('# preserved library edit');expect(text.isConnected).toBe(true);
 await switchList('local');await selectWork('本地稿件');
 expect(host.querySelectorAll('[data-active=true] .manager-tabstrip>div')).toHaveLength(1);
 expect(host.querySelectorAll('[aria-label="Markdown 正文"]')).toHaveLength(1);
 expect(invoke.mock.calls.some(([,x])=>x?.method==='draft_save')).toBe(false);
});
it('separates creation from library and blocks a second editor for a dirty workflow article',async()=>{
 tasks[0]={...tasks[0],mode:'xiwen',articleId:'local-one',workIds:['local-one'],ui:{tabs:[],flowStep:'review'},workflow:{sources:'combined',authorized:true}};
 const original=invoke.getMockImplementation()!;invoke.mockImplementation((command,args)=>args?.method==='task_check'?{ready:false,reviewed:false,images:0,checks:[]}:original(command,args));
 await start(false);expect(host.querySelector('.task-library')).toBeNull();expect(host.querySelector('.library-manager[data-active=true]')).toBeNull();
 const text=host.querySelector<HTMLTextAreaElement>('[aria-label="内容行 1"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(text,'# unsaved workflow');text.dispatchEvent(new Event('input',{bubbles:true}));});
 await start(true);await selectWork('本地稿件');
 expect(host.querySelector('[data-active=true] .manager-work')?.textContent).toContain('正在创作页编辑');expect(host.querySelectorAll('[aria-label="Markdown 正文"]')).toHaveLength(0);
 await start(false);expect(text.value).toBe('# unsaved workflow');
});
it('opens cloud content first when the same work also exists locally',async()=>{
 const original=invoke.getMockImplementation()!;invoke.mockImplementation(async(command,args)=>{const result=await original(command,args);if(command==='publications_call'&&args.method==='snapshot')result.website.items=[{...cloud,articleId:'local-one',title:'本地稿件'}];return result;});
 await start();await switchList('cloud');await selectWork('本地稿件');
 expect(host.querySelector('[aria-label="正文来源"]')).toBeNull();
 expect(host.querySelector('[aria-label="云端显示模式"]')).not.toBeNull();
 expect(host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!).not.toBeNull();expect(button('编辑')).not.toBeNull();
});
it('cloud retrieval waits for the local record and opens the unified editor and preview',async()=>{
 let pulled=false;const original=invoke.getMockImplementation()!;
 const pulledDraft={...local,id:'cloud-one',shortTitle:'仅云端稿件',canonicalPath:'articles/pulled/正文.md'};
 invoke.mockImplementation(async(command,args)=>{
  if(command==='website_publish_call'&&args.method==='pull'){pulled=true;return {id:'cloud-one',conflict:false};}
  if(command==='website_publish_call'&&args.method==='snapshot')return {connection:{configured:true},articles:pulled?[local,pulledDraft]:[local]};
  if(command==='editorial_call'&&args.method==='draft_list')return {articles:pulled?[local,pulledDraft]:[local]};
  if(command==='editorial_call'&&args.method==='draft_read'&&args.params.id==='cloud-one')return pulledDraft;
  if(command==='website_publish_call'&&args.method==='inspect'&&args.params.id==='cloud-one')return {...await original(command,args),id:'cloud-one'};
  return original(command,args);
 });
 await start();await switchList('cloud');await selectWork('仅云端稿件');
 await act(async()=>button('编辑').click());expect(host.querySelector('[role=alertdialog]')).toBeNull();
 const order=invoke.mock.calls.map(([,x])=>x?.method==='cloud_action'?'cloud_action:'+x.params.action:x?.method).filter(m=>m==='pull'||String(m).startsWith('cloud_action:'));expect(order).toEqual(['pull']);
 expect(host.querySelector('.publisher-editable')).not.toBeNull();
 expect(host.querySelector('[aria-label="Markdown 正文"]')).not.toBeNull();
 expect(host.querySelector('[aria-label="更多作品操作"]')).toBeNull();
});

it('uses compact task rows and permanently deletes only the confirmed task',async()=>{
 await start(false);
 expect(host.querySelector('.task-collections')).toBeNull();expect(host.querySelector('.task-sidebar footer')).toBeNull();
 expect(host.querySelector('[aria-label="并行任务上限"]')).toBeNull();
 expect(host.querySelector('.task-history-item')?.textContent).toBe('task-one');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="任务操作：task-one"]')!.click());
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(b=>b.textContent==='删除')!.click());expect(host.querySelector('[role=dialog]')?.textContent).toContain('关联稿件和图片会保留');
 expect(invoke.mock.calls.some(([,p])=>p?.method==='task_delete')).toBe(false);
 await act(async()=>button('确认删除').click());
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'task_delete',params:{taskId:'task-one'}});
 expect(host.querySelectorAll('.task-history-item')).toHaveLength(1);expect(host.querySelector('.task-history-item')?.textContent).toBe('task-two');
 expect(invoke.mock.calls.some(([,p])=>['local_action','cloud_action'].includes(p?.method))).toBe(false);
});

it('opens a blank conversation with section starters and templates in the mount picker',async()=>{
 tasks[0].ui.composer='保留历史输入';await start(false);
 await act(async()=>button('新建对话').click());
 expect(host.querySelector('[role=dialog]')).toBeNull();expect(host.querySelectorAll('.task-start-card')).toHaveLength(0);
 expect(invoke.mock.calls.filter(([,p])=>p?.method==='task_create')).toHaveLength(1);
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'task_create',params:{mode:'observation',skill:'unskilled',title:'新的创作',brief:''}});
 const current=host.querySelector('.flow-main-host:not([style*="display: none"])')!;
 expect(current.querySelectorAll('.notebook-start-sections button')).toHaveLength(4);
 await act(async()=>current.querySelector<HTMLButtonElement>('[aria-label="添加挂载"]')!.click());
 expect([...current.querySelectorAll('.notebook-mount-sections h3')].map(h=>h.textContent)).toEqual(['Attach','Plugin Skills','App','MCP']);
 expect(current.querySelectorAll('.notebook-mount-row[title^="文章模板"]')).toHaveLength(9);
 expect(current.querySelector('.notebook-picker-option')).toBeNull();
 const template=current.querySelector<HTMLButtonElement>('.notebook-mount-row[title^="文章模板"]')!;
 const templateName=template.getAttribute('aria-label');
 await act(async()=>template.click());expect(template.isConnected).toBe(false);
 expect(current.querySelector(`[aria-label="取消挂载：${templateName}"]`)).not.toBeNull();
 expect(current.querySelector('[aria-label="写作要求"]')).not.toBeNull();
 expect(tasks[0].ui.composer).toBe('保留历史输入');expect(invoke.mock.calls.some(([,p])=>p?.method==='notebook_prompt'||p?.method==='prompt')).toBe(false);
});
function mockFirstMessageFlow(failPrompt=false){
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='cursor_agent_call'&&args.method==='task_get')return structuredClone(tasks.find(t=>t.id===args.params.taskId));
  if(command==='cursor_agent_call'&&args.method==='notebook_prompt'){if(failPrompt)throw Error('暂时无法连接');return {started:true};}
  return original(command,args);
 });
}
async function enterWritingMessage(text:string){
 const input=host.querySelector<HTMLTextAreaElement>('.flow-main-host:not([style*="display: none"]) [aria-label="写作要求"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));});return input;
}
it('allows free writing without selecting a template and suppresses duplicate or composing sends',async()=>{
 mockFirstMessageFlow();await start(false);await act(async()=>button('新建对话').click());
 const input=await enterWritingMessage('写一篇关于读书习惯的随笔'),send=host.querySelector<HTMLButtonElement>('.flow-main-host:not([style*="display: none"]) [aria-label="发送"]')!;
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true,isComposing:true,bubbles:true})));
 expect(invoke.mock.calls.some(([,p])=>p?.method==='notebook_prompt')).toBe(false);
 await act(async()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true,bubbles:true}));send.click();});
 expect(invoke.mock.calls.filter(([,p])=>p?.method==='task_create')).toHaveLength(1);expect(invoke.mock.calls.filter(([,p])=>p?.method==='notebook_prompt')).toHaveLength(1);
 expect(tasks.find(t=>t.id==='task-new').notebook.templateSelection).toBeUndefined();expect(input.value).toBe('');
});
it('offers a retry when blank-task creation fails without touching existing conversations',async()=>{
 await start(false);const original=invoke.getMockImplementation()!;invoke.mockImplementation(async(c,p)=>{if(p?.method==='task_create')throw Error('磁盘写入失败');return original(c,p);});
 await act(async()=>button('新建对话').click());expect(tasks).toHaveLength(2);expect(toastHost.textContent).toContain('磁盘写入失败');expect(button('打开写作助手').disabled).toBe(false);
 invoke.mockImplementation(original);await act(async()=>button('打开写作助手').click());expect(tasks).toHaveLength(3);expect(host.querySelector('.task-start-card')).toBeNull();
});
it('retains the writing request in the same blank conversation when the agent fails',async()=>{
 mockFirstMessageFlow(true);await start(false);await act(async()=>button('新建对话').click());const input=await enterWritingMessage('继续整理我的笔记');
 await act(async()=>host.querySelector<HTMLButtonElement>('.flow-main-host:not([style*="display: none"]) [aria-label="发送"]')!.click());
 expect(input.value).toBe('继续整理我的笔记');expect(host.textContent).toContain('暂时无法连接');expect(invoke.mock.calls.filter(([,p])=>p?.method==='task_create')).toHaveLength(1);
});
it('completed and legacy conversations remain read-only without the removed launcher',async()=>{
 tasks[0].completedAt='2026-10-04T10:00:00Z';tasks[1].mode='legacy';await start(false);expect(host.querySelector('.completed-creation-history')?.textContent).toContain('已完成 · 创作记录');
 await act(async()=>host.querySelectorAll<HTMLButtonElement>('.task-history-item')[1].click());expect(host.querySelectorAll('.task-start-card')).toHaveLength(0);expect(host.querySelector('.agent-composer')).toBeNull();expect(button('打开写作助手')).toBeTruthy();
});
it('keeps the complete online section list in both local and cloud locations',async()=>{
 await start();
 expect(host.querySelector('[data-active=true] .manager-filters .manager-source')).not.toBeNull();
 expect(host.querySelector('[data-active=true] .manager-filters .manager-categories')).not.toBeNull();
 await act(async()=>check('学界犀闻').click());
 await switchList('cloud');
 expect(check('学界犀闻').querySelector('small')?.textContent).toBe('0');
 expect(check('学者观察')).toBeDefined();
 expect(check('全部栏目').getAttribute('aria-pressed')).toBe('true');
 expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);
 await switchList('local');
 expect(check('学者观察').querySelector('small')?.textContent).toBe('0');
 expect(check('学界犀闻')).toBeDefined();
 expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);
 expect(check('全部作品')).toBeUndefined();
 expect(host.querySelector('.library-manager[data-active=true]')?.getAttribute('data-scope')).toBe('local');
});

it('shows actual source names and clears filters within the selected source',async()=>{
 await start();
 expect(host.querySelector('.manager-locations')).toBeNull();
 expect(source('local').getAttribute('title')).toBe('Isaac 的 Mac Studio');
 expect(host.querySelector('.library-manager[data-active=true]')?.getAttribute('data-scope')).toBe('local');
 expect(host.querySelector('[data-active=true] .manager-card strong')?.textContent).toBe('本地稿件');
 await switchList('cloud');
 const search=host.querySelector<HTMLInputElement>('[aria-label="搜索作品"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'无匹配');search.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>button('清除筛选').click());
 expect(host.querySelector('.library-manager[data-active=true]')?.getAttribute('data-scope')).toBe('cloud');expect(search.value).toBe('');
 expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(1);expect(host.querySelector('[data-active=true] .manager-card strong')?.textContent).toBe('仅云端稿件');
 expect(host.querySelector('[data-location="external"]')).toBeNull();expect(host.querySelectorAll('[data-active=true] .manager-locations button')).toHaveLength(0);
});
it('keeps cached source filters usable when device metadata is unavailable',async()=>{
 const implementation=invoke.getMockImplementation()!;invoke.mockImplementation(async(command,args)=>command==='workbench_device_name'?Promise.reject(Error('不可用')):command==='website_publish_call'&&args.method==='snapshot'?{connection:{configured:false,origin:''},articles:[local]}:implementation(command,args));
 await start();expect(source('local').textContent).toContain('本机');await switchList('cloud');expect(source('cloud').title).toBe('未连接云端');
 await switchList('cloud');expect(host.querySelector('[data-active=true] .manager-card strong')?.textContent).toBe('仅云端稿件');
 expect(toastHost.querySelector('[role=alert]')).toBeNull();
});

it('shows cloud refresh errors in the global toast without adding a row to the workbench',async()=>{
 await start();await switchList('cloud');
 const implementation=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{if(command==='publications_call'&&args.method==='refresh_website')throw Error('官网内容在读取期间发生变化，请重新刷新');return implementation(command,args);});
 const refresh=host.querySelector<HTMLButtonElement>('[aria-label="刷新today.scholay.com作品"]')!;
 await act(async()=>refresh.click());
 expect(toastHost.querySelector('.toast-viewport [role=alert]')?.textContent).toContain('官网内容在读取期间发生变化，请重新刷新');
 expect(host.querySelector('.task-error,.manager-content > .work-notice[role=alert]')).toBeNull();
 expect(host.querySelector('[data-active=true] .manager-card strong')?.textContent).toBe('仅云端稿件');
 await act(async()=>toastHost.querySelector<HTMLButtonElement>('.toast-dismiss')!.click());
 expect(toastHost.querySelector('[role=alert]')).toBeNull();
});


it('keeps the list beside the expansion area: opening a work adds a tab on the right and filters never close it',async()=>{
 await start();expect(host.querySelector('.reader-home-tab')).toBeNull();expect(host.querySelector('[data-active=true] .manager-expansion')).toBeNull();
 expect(host.querySelector('.library-manager[data-active=true]')?.getAttribute('data-view')).toBe('list');
 await selectWork('本地稿件');
 expect(host.querySelector('.library-manager[data-active=true]')?.getAttribute('data-view')).toBe('split');expect(host.querySelector('[data-active=true] .manager-expansion .manager-work')).not.toBeNull();
 expect((host.querySelector('[data-active=true] .manager-collection') as HTMLElement).style.display).toBe('');expect(host.querySelectorAll('[data-active=true] .manager-card').length).toBeGreaterThan(0);
 expect(host.querySelector('[data-active=true] .manager-card[aria-current=true]')?.textContent).toContain('本地稿件');
 expect(host.querySelectorAll('[data-active=true] .manager-tabstrip>div')).toHaveLength(1);
 await switchList('cloud');expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')).toBeNull();
 await selectWork('仅云端稿件');await switchList('local');
 expect(host.querySelectorAll('[data-active=true] .manager-tabstrip>div')).toHaveLength(1);expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('本地稿件');
 expect(invoke.mock.calls.some(([,args])=>['local_action','cloud_action','task_run'].includes(args?.method))).toBe(false);
});
it('a cloud work has a website preview with the cloud controls and a WeChat preview with styles and copy',async()=>{
 await start();await switchList('cloud');await selectWork('仅云端稿件');
 const detail=()=>host.querySelector('.manager-work:not([style*="none"])')!;
 expect(detail().querySelector('[aria-label="云端显示模式"] [aria-pressed=true]')?.textContent).toBe('官网预览');
 expect(detail().querySelector('.work-action-controls [role=switch]')).not.toBeNull();expect(button('编辑')).toBeDefined();expect(detail().querySelector('.wechat-preview')).toBeNull();
 await act(async()=>[...detail().querySelectorAll<HTMLButtonElement>('[aria-label="云端显示模式"] button')].find(b=>b.textContent==='公众号预览')!.click());
 expect(detail().querySelector('.work-action-controls [role=switch]')).toBeNull();expect([...detail().querySelectorAll('button')].some(b=>b.textContent==='编辑')).toBe(false);
 expect(detail().querySelector('.wechat-copy')?.textContent).toBe('复制公众号图文');expect(detail().querySelectorAll('[aria-label="排版风格"] button')).toHaveLength(4);
 expect(detail().querySelector('.wechat-paper')?.getAttribute('data-style')).toBe('academic');
 await act(async()=>[...detail().querySelectorAll<HTMLButtonElement>('[aria-label="排版风格"] button')].find(b=>b.textContent==='简报')!.click());
 expect(detail().querySelector('.wechat-paper')?.getAttribute('data-style')).toBe('briefing');expect(invoke.mock.calls.some(([,x])=>x?.method==='pull'||x?.method==='cloud_action')).toBe(false);
});
it('list rows show public state as a label and never publish from the list',async()=>{
 await start();await switchList('cloud');
 const status=()=>host.querySelector<HTMLElement>('[data-active=true] .manager-row .manager-row-status')!;
 expect(status().textContent).toBe('未公开');expect(status().tagName).toBe('SPAN');
 expect(host.querySelector('[data-active=true] .manager-row [role=switch]')).toBeNull();
 await act(async()=>status().click());
 expect(host.querySelector('[data-active=true] .manager-confirm')).toBeNull();expect(invoke.mock.calls.some(([,x])=>x?.method==='cloud_action')).toBe(false);
});

it('works without an English page carry a label and a filter that counts them',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{const result=await original(command,args);if(command==='publications_call'&&args.method==='snapshot')return {...result,website:{...result.website,items:[{...cloud,publishedVersion:1,publicationState:'published',english:'missing'},{...cloud,key:'news:has-english',articleId:'has-english',title:'已有英文',publishedVersion:1,publicationState:'published',english:'live'}]}};return result;});
 await switchList('cloud');
 const titles=()=>[...host.querySelectorAll('[data-active=true] .manager-card strong')].map(x=>x.textContent);
 expect(titles()).toEqual(expect.arrayContaining(['无英文仅云端稿件','已有英文']));
 const filter=host.querySelector<HTMLButtonElement>('[data-active=true] .manager-english-filter')!;
 expect(filter.textContent).toContain('缺少英文版');expect(filter.querySelector('small')?.textContent).toBe('1');
 await act(async()=>filter.click());
 expect(titles()).toEqual(['无英文仅云端稿件']);expect(filter.getAttribute('aria-pressed')).toBe('true');
 await act(async()=>filter.click());
 expect(titles()).toHaveLength(2);
});

it('reopens a collapsed task extension from the main pane without starting an agent',async()=>{
 tasks[0].ui={tabs:[{id:'web:source',kind:'web',title:'来源页面',url:'https://example.invalid/source'}],activeTab:'web:source',expansionOpen:true};
 await start(false);const extension=host.querySelector<HTMLElement>('#workbench-extension-pane')!;
 expect([...host.querySelectorAll('.task-tabs [role=tab]')].map(t=>t.textContent)).toEqual(['子弹笔记','来源页面']);expect(host.querySelector('[aria-label="关闭 子弹笔记"]')).toBeNull();
 const toggle=()=>host.querySelector<HTMLButtonElement>('.task-extension-toggle button')!;
 expect(toggle().getAttribute('aria-expanded')).toBe('true');await act(async()=>toggle().click());
 expect(extension.style.display).toBe('none');expect(toggle().getAttribute('aria-label')).toBe('展开拓展区');
 await act(async()=>toggle().click());expect(extension.style.display).toBe('');expect(toggle().getAttribute('aria-expanded')).toBe('true');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="关闭 来源页面"]')!.click());
 expect(host.querySelector('.task-extension-toggle')).not.toBeNull();expect(host.querySelector('.task-tabs [aria-selected=true]')?.textContent).toBe('子弹笔记');
 expect(invoke.mock.calls.some(([,args])=>['connect','task_run','prompt'].includes(args?.method))).toBe(false);
});


const shortcut=async(action:string)=>act(async()=>{for(const [name,handler] of listen.mock.calls)if(name==='reader-tab-shortcut')handler({payload:action});});
const tabKey=async(key:string,options:KeyboardEventInit)=>act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options})));
it('cycles work tabs with native commands and restores only a successfully closed work tab',async()=>{
 await start();await selectWork('本地稿件');await switchList('cloud');await selectWork('仅云端稿件');
 await shortcut('next');expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('仅云端稿件');
 await tabKey('Tab',{ctrlKey:true,shiftKey:true});expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('仅云端稿件');
 await shortcut('close');expect(host.querySelectorAll('[data-active=true] .manager-tabstrip>div')).toHaveLength(0);
 await shortcut('reopen');expect(host.querySelectorAll('[data-active=true] .manager-tabstrip>div')).toHaveLength(1);expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('仅云端稿件');
 await switchList('local');await selectWork('本地稿件');await act(async()=>button('编辑').click());
 const text=host.querySelector<HTMLTextAreaElement>('[aria-label="Markdown 正文"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(text,'# dirty keyboard close');text.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(host.querySelector('[data-active=true] .manager-tabstrip [aria-selected=true]')?.textContent).toBe('● 本地稿件');
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'task_lease',params:{editorId:'library',articleId:'local-one',release:false}});
 await shortcut('close');expect(host.querySelectorAll('[data-active=true] .manager-tabstrip>div')).toHaveLength(1);expect(text.isConnected).toBe(true);expect(text.value).toBe('# dirty keyboard close');
 expect(toastHost.querySelector('[role=alert]')?.textContent).toContain('请先保存');
});
it('cycles, closes and reopens task extension pages without borrowing another task history',async()=>{
 tasks[0].ui={tabs:[{id:'web:one',kind:'web',title:'来源一',url:'https://example.invalid/one'},{id:'web:two',kind:'web',title:'来源二',url:'https://example.invalid/two'}],activeTab:'web:one',expansionOpen:true};
 await start(false);await shortcut('next');expect(host.querySelector('.task-tabs [aria-selected=true]')?.textContent).toBe('来源二');
 await tabKey('w',{metaKey:true});expect(host.querySelectorAll('.task-tabs [role=tab]')).toHaveLength(2);
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.task-history-item')].find(b=>b.textContent==='task-two')!.click());
 await shortcut('reopen');expect(host.querySelectorAll('.task-tabs [role=tab]')).toHaveLength(1);
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.task-history-item')].find(b=>b.textContent==='task-one')!.click());
 await tabKey('t',{metaKey:true,shiftKey:true});expect(host.querySelectorAll('.task-tabs [role=tab]')).toHaveLength(3);expect(host.querySelector('.task-tabs [aria-selected=true]')?.textContent).toBe('来源二');
 expect(invoke.mock.calls.some(([,args])=>['task_run','prompt','connect'].includes(args?.method))).toBe(false);
});


it('only collapses a narrow task sidebar while the content workbench is active',async()=>{
 const toggle=vi.fn();vi.stubGlobal('ResizeObserver',class{callback:()=>void;constructor(cb:()=>void){this.callback=cb;}observe(el:HTMLElement){Object.defineProperty(el,'clientWidth',{configurable:true,value:600});this.callback();}disconnect(){}});
 const render=(active:boolean,management:boolean)=>act(async()=>root.render(createElement(WindowChromeContext.Provider,{value:{host:null,workspace:management?'library':'editorial',collapsed:false,toggle}},createElement(ContentWorkspace,{active,view:management?'works':'conversations'}))));
 await render(false,false);expect(toggle).not.toHaveBeenCalled();
 await render(true,true);expect(toggle).not.toHaveBeenCalled();
 await render(true,false);expect(toggle).toHaveBeenCalledOnce();
});
it('leaves saved task-sidebar state untouched in inactive and library views',async()=>{
 const toggle=vi.fn(),write=vi.spyOn(Storage.prototype,'setItem');
 const render=(active:boolean,management:boolean)=>act(async()=>root.render(createElement(WindowChromeContext.Provider,{value:{host:null,workspace:management?'library':'editorial',collapsed:false,toggle}},createElement(ContentWorkspace,{active,view:management?'works':'conversations'}))));
 try{await render(false,false);await render(true,true);
  expect(write.mock.calls.filter(([key])=>key==='scholay.workbench.sidebar')).toHaveLength(0);
  await render(true,false);expect(write.mock.calls.some(([key,value])=>key==='scholay.workbench.sidebar'&&value==='open')).toBe(true);
  expect(toggle).not.toHaveBeenCalled();
 }finally{write.mockRestore();}
});

it('reconciles publication on focus while inactive and refreshes cloud and local snapshots together',async()=>{
 let released=false;const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='website_publish_call'&&args.method==='reconcile')return {changed:released,results:released?[{id:'local-one',stage:'published',localReleased:true}]:[]};
  if(command==='website_publish_call'&&args.method==='snapshot')return {connection:{configured:true},articles:released?[]:[local]};
  return original(command,args);
 });
 await start();expect(source('local').querySelector('small')?.textContent).toBe('1');
 await act(async()=>root.render(createElement(ContentWorkspace,{active:false,view:'works'})));
 released=true;await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(invoke.mock.calls.some(([command,args])=>command==='publications_call'&&args.method==='refresh_website')).toBe(true);
 expect(source('local').querySelector('small')?.textContent).toBe('0');expect(host.querySelectorAll('[data-active=true] .manager-card')).toHaveLength(0);
});

it('does not reinsert a retired local work when an older snapshot resolves late',async()=>{
 await start();const original=invoke.getMockImplementation()!;let resolveOld!:(value:any)=>void,hold=true;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='website_publish_call'&&args.method==='reconcile')return {changed:true,results:[{id:'local-one',stage:'published',localReleased:true}]};
  if(command==='website_publish_call'&&args.method==='snapshot'){if(hold){hold=false;return new Promise(resolve=>{resolveOld=resolve;});}return {connection:{configured:true},articles:[]};}
  return original(command,args);
 });
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-active=true] .manager-refresh')!.click());
 await act(async()=>window.dispatchEvent(new Event('focus')));expect(source('local').querySelector('small')?.textContent).toBe('0');
 await act(async()=>resolveOld({connection:{configured:true},articles:[local]}));expect(source('local').querySelector('small')?.textContent).toBe('0');
});

it('keeps a cloud action under observation after its work tab becomes inactive',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='website_publish_call'&&args.method==='cloud_action')return actionReceipt={action:'publish',status:'queued',requestKey:'pending-action'};
  if(command==='website_publish_call'&&args.method==='cloud_action_status'){cloudVisibility=1;return actionReceipt={action:'publish',status:'success',requestKey:'pending-action',publicReadback:true,localReleased:true};}
  return original(command,args);
 });
 vi.useFakeTimers();try{
 await start();await switchList('cloud');await selectWork('仅云端稿件');
 await act(async()=>host.querySelector<HTMLButtonElement>('.work-action-controls [role=switch]')!.click());await act(async()=>button('确认操作').click());
 await switchList('local');await selectWork('本地稿件');
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(invoke.mock.calls.some(([,args])=>args?.method==='cloud_action_status')).toBe(true);expect(cloudVisibility).toBe(1);
 }finally{vi.useRealTimers();}
});

it('keeps cleanup and readback failures visible instead of declaring a cloud action complete',async()=>{
 actionReceipt={action:'publish',status:'success',requestKey:'cleanup-blocked',publicReadback:true,cleanupError:'本地修改已保留'};
 await start();await switchList('cloud');await selectWork('仅云端稿件');
 expect(host.querySelector('.work-detail [role=status]')?.textContent).toContain('本地清理未完成');expect(host.querySelector('.work-info')?.textContent).not.toContain('已完成');
});

it('removes retired local rows even if cloud catalog refresh fails and retries the catalog on the next observation',async()=>{
 let released=false,first=true,catalogAttempts=0;const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='website_publish_call'&&args.method==='reconcile'){const changed=first&&released;if(released)first=false;return {changed,results:released?[{id:'local-one',stage:'published',localReleased:true}]:[]};}
  if(command==='website_publish_call'&&args.method==='snapshot')return {connection:{configured:true},articles:released?[]:[local]};
  if(command==='publications_call'&&args.method==='refresh_website'){catalogAttempts++;if(catalogAttempts===1)throw Error('catalog unavailable');}
  return original(command,args);
 });
 await start();released=true;await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(source('local').querySelector('small')?.textContent).toBe('0');expect(catalogAttempts).toBe(1);
 await act(async()=>window.dispatchEvent(new Event('focus')));expect(catalogAttempts).toBe(2);
});

it('local editing copies do not display cloud visibility status or a redundant more menu',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='publications_call')return {drafts:[],website:{scope:'all',items:[{...cloud,id:local.id,articleId:local.id,title:local.shortTitle,publishedVersion:1}]},feishu:{records:[]}};
  return original(command,args);
 });
 await start();await selectWork('本地稿件');
 expect(host.querySelectorAll('[data-active=true] .manager-row-status')).toHaveLength(0);
 expect(host.querySelector('[data-active=true] .manager-card')?.getAttribute('aria-label')).not.toContain('已公开');
 expect(host.querySelector('[aria-label="更多作品操作"]')).toBeNull();
});
