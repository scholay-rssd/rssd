// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import CenterWorkspace from './CenterWorkspace';
import {invoke} from '../lib/nativeCore';
vi.mock('../lib/nativeCore',()=>({invoke:vi.fn()}));
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
 await act(async()=>second.resolve([]));expect(host.textContent).toContain('此工作空间暂时没有记录');
});

it('holds editor context during submission and persists the accepted base without a second network read',async()=>{
 const submission=deferred(),fallback=vi.mocked(invoke).getMockImplementation()!;
 vi.mocked(invoke).mockImplementation((command,args:any)=>args.method==='submit'?submission.promise:fallback(command,args));
 await mount();await click('作品库');await click('打开');await click('提交中心');
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
