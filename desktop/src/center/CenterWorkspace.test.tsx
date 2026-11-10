// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import CenterWorkspace,{LegacyCenter} from './CenterWorkspace';
import {invoke} from '../lib/nativeCore';
import {openUrl} from '@tauri-apps/plugin-opener';
vi.mock('../lib/nativeCore',()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn(async()=>{})}));
vi.mock('../uiText',()=>({tr:(s:string)=>s}));
let host:HTMLDivElement,root:Root;
const edition={locale:'zh-CN',revision:2,payload:{locale:'zh-CN',title:'原稿',bodyMarkdown:'原正文'}};
const work={id:'work-one',workspaceId:'first',sectionId:'news',editions:[edition]};
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(done=>{resolve=done;});return {promise,resolve};};
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;
const click=async(text:string)=>{await act(async()=>button(text).click());};
const mount=async()=>{await act(async()=>root.render(createElement(LegacyCenter,{active:true})));};
const calls=(method:string)=>vi.mocked(invoke).mock.calls.filter(([,args])=>(args as any)?.method===method);
beforeEach(()=>{
 vi.mocked(openUrl).mockClear();
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.mocked(invoke).mockReset().mockImplementation(async(_command,args:any)=>{
  switch(args.method){
   case 'status':return {configured:true,origin:'https://center.example.org',agents:[],outbox:[],drafts:[]};
   case 'registry':return {workspaces:[{id:'first',name:'第一站',sections:[{id:'news',name:'新闻'}]},{id:'second',name:'第二站',sections:[]}]};
   case 'demands':return [{id:'demand',title:'旧需求',state:'queued',payload:{brief:'需求描述'}}];
   case 'works':return [{...work,editions:[{locale:'zh-CN',title:'原稿',revision:2}]}];
   case 'work':return work;
   case 'local_draft':return null;
   default:return {};
  }
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});

it('opens scoped management in the browser without using worker credentials for management',async()=>{
 await mount();await click('作品库');await click('原稿');
 const textarea=host.querySelector<HTMLTextAreaElement>('textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'待保存的修改');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
 const management=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.startsWith('发布渠道'))!;
 await act(async()=>management.click());
 expect(openUrl).toHaveBeenCalledWith('https://center.example.org/rssd?tab=destinations&workspaceId=first');
 expect((calls('save_local').at(-1)?.[1] as any).params.body).toBe('待保存的修改');
 expect(calls('destinations')).toHaveLength(0);expect(calls('start')).toHaveLength(0);
 expect(host.querySelector('textarea')?.value).toBe('待保存的修改');
});

it('opens on the scheduling shell with task counts and keeps an open manuscript across its tabs',async()=>{
 const fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation(async(command,args:any)=>{
  if(args.method==='overview')return {workspaces:[{id:'first',name:'第一站',sections:[{id:'news',name:'新闻'}]}],goals:[],counts:[{workspaceId:'first',state:'queued',count:12},{workspaceId:'first',state:'claimed',count:3},{workspaceId:'first',state:'cancelled',count:9}]};
  if(args.method==='calendar')return {items:[],hasNext:false};
  if(args.method==='channels')return {destinations:[],channels:[]};
  return fallback(command,args);
 });
 await act(async()=>root.render(createElement(CenterWorkspace,{active:true})));
 expect(host.querySelector('.center-preview')).not.toBeNull();
 expect(host.querySelector('.cp-counts')?.textContent).toBe('待领取12进行中3待处理0已交稿0全部任务15');
 expect(calls('registry')).toHaveLength(0);
 await click('作品与本机执行');await click('作品库');await click('原稿');
 const textarea=host.querySelector<HTMLTextAreaElement>('textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'待保存的修改');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('发布日历');
 expect((calls('save_local').at(-1)?.[1] as any).params.body).toBe('待保存的修改');
 expect(calls('submit')).toHaveLength(0);expect(calls('start')).toHaveLength(0);
 await click('作品与本机执行');
 expect(host.querySelector('textarea')?.value).toBe('待保存的修改');
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

it('enables automatic topics only when the user opts into the methods pilot',async()=>{
 const fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation(async(command,args:any)=>{
  if(args.method==='registry')return {workspaces:[{id:'metho',name:'研究方法',sections:[{id:'methods',name:'方法百科'},{id:'statistics',name:'统计'}]}]};
  if(args.method==='status')return {configured:true,origin:'https://center.example.org',agents:[{id:'codex',name:'Codex',enabled:true,available:true}],outbox:[],drafts:[]};
  return fallback(command,args);
 });
 await mount();
 const checkbox=host.querySelector<HTMLInputElement>('.rssd-center-controls input[type=checkbox]')!;
 expect(checkbox.checked).toBe(false);expect(checkbox.disabled).toBe(true);
 const section=host.querySelector<HTMLSelectElement>('.rssd-center-controls select')!;
 await act(async()=>{section.value='methods';section.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(checkbox.disabled).toBe(false);
 await act(async()=>checkbox.click());
 expect(host.textContent).toContain('完成的文章会按该栏目已绑定的目标自动发布');
 await click('开启工作模式');
 expect((calls('start').at(-1)?.[1] as any).params).toMatchObject({agentId:'codex',workspaceIds:['metho'],sectionIds:['methods'],autoTopics:true});
});

it('shows a running worker’s actual automatic-topic setting after reopening the view',async()=>{
 const fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation(async(command,args:any)=>args.method==='status'?{configured:true,origin:'https://center.example.org',agents:[],outbox:[],drafts:[],worker:{state:'idle',autoTopics:true}}:fallback(command,args));
 await mount();
 const checkbox=host.querySelector<HTMLInputElement>('.rssd-center-controls input[type=checkbox]')!;
 expect(checkbox.disabled).toBe(true);expect(checkbox.checked).toBe(true);
 expect(host.textContent).toContain('完成的文章会按该栏目已绑定的目标自动发布');
});

it('starts the multi-site scheduler only when its private configuration is enabled',async()=>{
 const fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation(async(command,args:any)=>args.method==='status'?{configured:true,multisiteConfigured:true,origin:'https://center.example.org',agents:[],outbox:[],drafts:[]}:fallback(command,args));
 await mount();await click('开启多站排程');
 expect(calls('start_multisite')).toHaveLength(1);
 expect((calls('start_multisite')[0][1] as any).params).toEqual({});
});

it('shows the prepared reference revision and submits through the native bridge',async()=>{
 const fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation(async(command,args:any)=>args.method==='status'?{configured:true,origin:'https://center.example.org',agents:[],outbox:[],drafts:[],preparedReference:{workId:'work-one',workspaceId:'first',title:'测试稿',locale:'zh-CN',baseRevision:1}}:args.method==='submit_prepared_revision'?{state:'accepted'}:fallback(command,args));
 await mount();expect(host.textContent).toContain('待提交的本机参考文献修订：');expect(host.textContent).toContain('测试稿');
 await click('提交参考文献修订');expect(calls('submit_prepared_revision')).toHaveLength(1);expect(host.textContent).toContain('中心已接收，发布结果请查看发布记录。');
});

it('never renders demand rows as works and ignores a late response from the prior tab',async()=>{
 const demand=deferred(),works=deferred(),fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation((command,args:any)=>args.method==='demands'?demand.promise:args.method==='works'?works.promise:fallback(command,args));
 await mount();await click('作品库');
 expect(host.textContent).toContain('正在读取');
 await act(async()=>works.resolve([{...work,editions:[{locale:'zh-CN',revision:2,title:'正确作品'}]}]));
 expect(host.textContent).toContain('正确作品');
 await act(async()=>demand.resolve([{id:'late-demand',title:'迟到的需求',state:'queued'}]));
 expect(host.textContent).not.toContain('迟到的需求');expect(host.textContent).toContain('正确作品');
});

it('hides the previous workspace while the new workspace list is loading',async()=>{
 const second=deferred(),fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation((command,args:any)=>args.method==='demands'&&args.params.workspaceId==='second'?second.promise:fallback(command,args));
 await mount();expect(host.textContent).toContain('旧需求');
 const select=host.querySelector<HTMLSelectElement>('select')!;
 await act(async()=>{select.value='second';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(host.textContent).not.toContain('旧需求');expect(host.textContent).toContain('正在读取');
 await act(async()=>second.resolve([]));expect(host.textContent).toContain('需求池里还没有任务');
});

it('holds editor context during submission and persists the accepted base without a second network read',async()=>{
 const submission=deferred(),fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation((command,args:any)=>args.method==='submit'?submission.promise:fallback(command,args));
 await mount();await click('作品库');await click('原稿');await click('提交中心');
 expect(button('返回作品库').disabled).toBe(true);expect(button('需求池').disabled).toBe(true);
 expect(host.querySelector<HTMLSelectElement>('.rssd-center-editor select')!.disabled).toBe(true);
 expect(host.querySelector<HTMLInputElement>('.rssd-center-editor input')!.disabled).toBe(true);
 expect(calls('save_local').length).toBeGreaterThan(0);
 await act(async()=>submission.resolve({state:'accepted',receipt:{editions:[{locale:'zh-CN',revision:3}]}}));
 const saved=calls('save_local').at(-1)?.[1] as any;
 expect(saved.params.work.editions[0].revision).toBe(3);
 expect(saved.params.body).toBe('原正文');expect(calls('work')).toHaveLength(1);
 expect(host.textContent).toContain('基于版本3');expect(button('返回作品库').disabled).toBe(false);
});

it('pages beyond the first batch and starts a search at the first page',async()=>{
 const fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation((command,args:any)=>{
  if(args.method!=='works')return fallback(command,args);
  const {offset,search}=args.params;
  return Promise.resolve(search?[{id:'search-match',editions:[{title:'检索结果',locale:'en',revision:1}]}]:Array.from({length:offset===0?51:1},(_,i)=>({id:'work-'+(offset+i),editions:[{title:'作品编号 '+(offset+i),locale:'zh-CN',revision:1}]})));
 });
 await mount();await click('作品库');
 expect(host.querySelectorAll('.rssd-center-list article')).toHaveLength(50);
 expect(host.textContent).not.toContain('作品编号 50');expect(button('上一页').disabled).toBe(true);
 await click('下一页');
 expect(host.querySelectorAll('.rssd-center-list article')).toHaveLength(1);
 expect(host.textContent).toContain('作品编号 50');expect(button('下一页').disabled).toBe(true);
 const last=calls('works').at(-1)?.[1] as any;expect(last.params).toMatchObject({limit:51,offset:50});
 const input=host.querySelector<HTMLInputElement>('input[type=search]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'检索词');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>input.form!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect((calls('works').at(-1)?.[1] as any).params).toMatchObject({search:'检索词',offset:0});
 expect(host.textContent).toContain('检索结果');expect(button('上一页').disabled).toBe(true);
});

it('ignores the previous page after switching tabs and resets pagination',async()=>{
 const second=deferred(),fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation((command,args:any)=>args.method==='works'?(args.params.offset?second.promise:Promise.resolve(Array.from({length:51},(_,i)=>({id:'item-'+i,editions:[{title:'作品 '+i,locale:'zh-CN',revision:1}]})))):fallback(command,args));
 await mount();await click('作品库');await click('下一页');
 expect(host.textContent).toContain('正在读取');expect(host.textContent).not.toContain('作品 0');
 await click('需求池');await act(async()=>second.resolve([{id:'late',editions:[{title:'过期分页',locale:'zh-CN',revision:1}]}]));
 expect(host.textContent).toContain('旧需求');expect(host.textContent).not.toContain('过期分页');
 expect((calls('demands').at(-1)?.[1] as any).params.offset).toBe(0);
});

it('keeps staged workspaces read-only at center while retaining local edits',async()=>{
 const fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation(async(command,args:any)=>{
  const result:any=await fallback(command,args);
  if(args.method==='registry')result.workspaces[0]={...result.workspaces[0],writable:false,migrationState:'staged'};
  if(args.method==='status')result.agents=[{id:'agent',name:'Available agent',available:true,enabled:true}];
  return result;
 });
 await mount();expect(host.textContent).toContain('此工作空间正在迁移');
 expect(button('开启工作模式').disabled).toBe(true);expect(button('处理这条').disabled).toBe(true);
 await click('作品库');await click('原稿');expect(button('提交中心').disabled).toBe(true);
 const textarea=host.querySelector<HTMLTextAreaElement>('textarea')!;expect(textarea.disabled).toBe(false);
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'本机继续编辑');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('返回作品库');
 expect((calls('save_local').at(-1)?.[1] as any).params.body).toBe('本机继续编辑');
 expect(calls('submit')).toHaveLength(0);expect(calls('start')).toHaveLength(0);
});
