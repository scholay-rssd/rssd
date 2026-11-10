// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import LocalCenterAssistant from './LocalCenterAssistant';
import {invoke} from '../lib/nativeCore';
vi.mock('../lib/nativeCore',()=>({invoke:vi.fn()}));vi.mock('../uiText',()=>({tr:(s:string)=>s}));
let host:HTMLDivElement,root:Root;
const agents=[{id:'codex',name:'Codex',available:true,enabled:true}];
const draw=(ids:string[])=>createElement(LocalCenterAssistant,{agents,workspaceIds:ids,manage:()=>{}});
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.mocked(invoke).mockReset();vi.mocked(invoke).mockResolvedValue({state:'idle',history:[]});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('pins a running turn to its original scope and preserves the typed instruction on failed send',async()=>{
 await act(async()=>root.render(draw(['space-a'])));
 const input=host.querySelector('textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'检查需求');input.dispatchEvent(new Event('input',{bubbles:true}));});
 vi.mocked(invoke).mockImplementation(async(_cmd,args:any)=>{if(args.method==='assistant_send')throw Error('无法连接');return {state:'idle',history:[]};});
 await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(input.value).toBe('检查需求');expect(host.textContent).toContain('无法连接');
 vi.mocked(invoke).mockImplementation(async(_cmd,args:any)=>args.method==='assistant_status'?{state:'running',history:[{role:'assistant',text:'真实流式回复',at:1}]}:{state:'starting'});
 await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 await act(async()=>root.render(draw(['space-b'])));
 await act(async()=>vi.advanceTimersByTimeAsync(1100));
 expect(host.textContent).toContain('真实流式回复');
 const read=vi.mocked(invoke).mock.calls.filter(([,args]:any)=>args.method==='assistant_status').at(-1)![1] as any;
 expect(read.params.workspaceIds).toEqual(['space-a']);
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='停止助手')!.click());
 const cancel=vi.mocked(invoke).mock.calls.find(([,args]:any)=>args.method==='assistant_cancel')![1] as any;expect(cancel.params.workspaceIds).toEqual(['space-a']);
});
it('requires a real workspace and never sends from an unmapped Postiz-only scope',async()=>{
 await act(async()=>root.render(draw(['__postiz__'])));
 expect(vi.mocked(invoke)).not.toHaveBeenCalled();expect(host.textContent).toContain('未选择工作空间');
});

it('retains native Postiz assistant access and forwards production agent selection',async()=>{
 const native=vi.fn(),choose=vi.fn();
 await act(async()=>root.render(createElement(LocalCenterAssistant,{agents:[...agents,{id:'cursor',name:'Cursor',available:true,enabled:true}],workspaceIds:['space-a'],manage:()=>{},openNative:native,onAgentChange:choose})));
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='打开 Postiz 原生助手')!.click());expect(native).toHaveBeenCalledOnce();
 await act(async()=>{const select=host.querySelector('select')!;select.value='cursor';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(choose).toHaveBeenCalledWith('cursor');
});
it('checks an idle assistant every five seconds rather than every second',async()=>{
 const asked=()=>vi.mocked(invoke).mock.calls.filter(([,args]:any)=>args.method==='assistant_status').length;
 await act(async()=>root.render(draw(['space-a'])));
 await act(async()=>vi.advanceTimersByTimeAsync(4000));
 expect(asked()).toBe(1);
 await act(async()=>vi.advanceTimersByTimeAsync(1100));
 expect(asked()).toBe(2);
});
