// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import CenterWorkspace from './CenterWorkspace';
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
const mount=async()=>{await act(async()=>root.render(createElement(CenterWorkspace,{active:true})));};
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

it('enters the live scheduling view only after saving the current local draft',async()=>{
 await mount();await click('作品库');await click('原稿');
 const saved=deferred(),fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation((command,args:any)=>args.method==='save_local'?saved.promise:fallback(command,args));
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.startsWith('打开新版调度中心'))!.click());
 expect(host.querySelector('.center-preview')).toBeNull();
 await act(async()=>saved.resolve({}));
 expect(host.querySelector('.center-preview')).not.toBeNull();
 expect(calls('submit')).toHaveLength(0);expect(calls('start')).toHaveLength(0);
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.startsWith('返回当前中心'))!.click());
 expect(host.querySelector('textarea')?.value).toBe('原正文');
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

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
