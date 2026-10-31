// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import BackgroundQueue from '../components/BackgroundQueue';
const {invoke,listen,modal}=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),modal:{setModalOpen:vi.fn()}}));
vi.mock('../lib/nativeCore',()=>({invoke,isTauri:()=>true}));
vi.mock('@tauri-apps/api/event',()=>({listen}));
vi.mock('../store',()=>({useUi:{getState:()=>modal}}));
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();modal.setModalOpen.mockReset();
 listen.mockReset().mockResolvedValue(()=>{});
 invoke.mockReset().mockImplementation(async(command,args)=>args.method==='queue_resume_pending'?{started:true,resumed:0,attention:0}:({jobs:command==='cursor_agent_call'?[{id:'a',title:'本地写作',spaceId:'metho',spaceName:'研究方法',status:'running',phase:'正在整理素材',source:'authoring'}]:[{id:'p',title:'云端推送',spaceId:'today',spaceName:'今日学术',status:'waiting',phase:'等待构建回执'}]}));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('shows real local and accepted cloud work, opens details and yields native webviews until Escape',async()=>{
 await act(async()=>root.render(createElement(StrictMode,null,createElement(BackgroundQueue))));
 expect(host.textContent).toContain('1 正在处理');expect(host.textContent).toContain('1 等待');expect(host.querySelector('section')).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('.background-queue-toggle')!.click());
 expect(host.querySelector('[aria-label="后台任务队列"]')).not.toBeNull();expect(host.textContent).toContain('云端推送');expect(host.textContent).not.toContain('已发布');expect(modal.setModalOpen).toHaveBeenLastCalledWith(true);
 await act(async()=>host.querySelector<HTMLButtonElement>('.background-queue-item')!.click());expect(host.querySelector('.background-queue-detail')?.textContent).toContain('正在整理素材');
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(host.querySelector('section')).toBeNull();expect(modal.setModalOpen).toHaveBeenLastCalledWith(false);
 expect(invoke.mock.calls.every(([,args])=>['queue_status','queue_resume_pending'].includes(args.method))).toBe(true);
});
it('retains the last cloud receipt when a later status read fails and stops polling after unmount',async()=>{
 await act(async()=>root.render(createElement(BackgroundQueue)));
 invoke.mockImplementation(async(command)=>{if(command==='website_publish_call')throw Error('offline');return {jobs:[]};});
 await act(async()=>{window.dispatchEvent(new Event('scholay-background-queue-changed'));await vi.advanceTimersByTimeAsync(300);});
 await act(async()=>host.querySelector<HTMLButtonElement>('.background-queue-toggle')!.click());
 expect(host.textContent).toContain('云端推送');expect(host.textContent).toContain('上次记录');
 const calls=invoke.mock.calls.length;act(()=>root.unmount());await vi.advanceTimersByTimeAsync(60_000);expect(invoke).toHaveBeenCalledTimes(calls);
 root=createRoot(host);
});
