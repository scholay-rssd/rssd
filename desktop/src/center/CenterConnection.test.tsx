// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {CenterConnection} from './CenterConnection';
import {invoke} from '../lib/nativeCore';
vi.mock('../lib/nativeCore',()=>({invoke:vi.fn()}));
vi.mock('../uiText',()=>({tr:(s:string)=>s}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.mocked(invoke).mockReset().mockResolvedValue({state:'idle'});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('saves the current draft before starting browser authorization and never starts a worker',async()=>{
 const sequence:string[]=[];vi.mocked(invoke).mockImplementation(async(_command,args:any)=>{sequence.push(args.method);return {state:args.method==='login'?'waiting':'idle'};});
 await act(async()=>root.render(createElement(CenterConnection,{status:{origin:'https://center.example'},disabled:false,onChanged:async()=>{},beforeChange:async()=>{sequence.push('save');}})));
 await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(sequence.slice(-2)).toEqual(['save','login']);expect(sequence).not.toContain('start');
 const login=vi.mocked(invoke).mock.calls.find(([,args])=>(args as any).method==='login')!;expect((login[1] as any).params.origin).toBe('https://center.example');expect(host.textContent).toContain('取消授权');
});
it('a refused disconnect leaves the existing connection and editor in place',async()=>{
 const changed=vi.fn();vi.mocked(invoke).mockImplementation(async(_command,args:any)=>{if(args.method==='disconnect')throw Error('Unresolved claim');return {state:'idle'};});
 await act(async()=>root.render(createElement(CenterConnection,{status:{configured:true,origin:'https://center.example'},disabled:false,onChanged:changed,beforeChange:async()=>{}})));
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='退出中心连接')!.click());
 expect(host.textContent).toContain('Unresolved claim');expect(changed).not.toHaveBeenCalled();expect(host.textContent).toContain('https://center.example');
});
