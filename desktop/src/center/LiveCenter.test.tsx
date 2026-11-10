// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import LiveCenter,{mapLiveCenter} from './LiveCenter';
import {invoke} from '../lib/nativeCore';
vi.mock('../lib/nativeCore',()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn(async()=>{})}));
vi.mock('../uiText',()=>({tr:(s:string)=>s}));
let host:HTMLDivElement,root:Root;
const overview={workspaces:[{id:'research',name:'实际工作空间',sections:[{id:'methods',name:'研究方法'}]}],goals:[],counts:[{workspaceId:'research',state:'queued',count:351}],works:[]};
const demand={id:'actual-demand',workspaceId:'research',sectionId:'methods',title:'中心真实需求',kind:'write',state:'queued',priority:7,generation:4,payload:{brief:'保留原要求',requiredLocales:['en']}};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.mocked(invoke).mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('maps real identities and distinguishes ready work from a scheduled native post',()=>{
 const calendar={items:[{id:'rssd:one',source:'rssd',publicationId:'one',workId:'original-work',workspaceId:'research',title:'Ready',locale:'en',state:'queued',hasSchedule:false,scheduledAt:'2026-11-01T10:00:00Z'},{id:'postiz:original',source:'postiz',publicationId:'original',title:'Native',state:'QUEUE',hasSchedule:true,scheduledAt:'2026-11-01T12:00:00Z'}]};
 const mapped=mapLiveCenter(overview,[demand],calendar,{destinations:[],channels:[]});
 expect(mapped.demands[0].id).toBe('actual-demand');expect(mapped.demandCounts?.[0].count).toBe(351);
 expect(mapped.publications[0].state).toBe('ready');expect(mapped.publications[0].workId).toBe('original-work');expect(mapped.publications[1].workId).toBe('original');expect(mapped.spaces.some(s=>s.id==='__postiz__')).toBe(true);
});
it('shows an actual read failure without falling back to demo tasks or sending mutations',async()=>{
 vi.mocked(invoke).mockImplementation(async(_command,args:any)=>{if(args.method==='status')return {configured:true,origin:'https://center.example',agents:[]};throw Error('Center unavailable');});
 await act(async()=>root.render(createElement(LiveCenter)));
 expect(host.textContent).toContain('Center unavailable');expect(host.textContent).not.toContain('示例数据');expect(host.textContent).not.toContain('模拟认领');
 expect(vi.mocked(invoke).mock.calls.some(([,a]:any)=>['start','edit_demand','submit'].includes(a.method))).toBe(false);
});
it('reads real data and forwards a retained demand generation rather than changing the local preview',async()=>{
 vi.mocked(invoke).mockImplementation(async(_command,args:any)=>{
  if(args.method==='status')return {configured:true,origin:'https://center.example',agents:[]};
  if(args.method==='overview')return overview;if(args.method==='demands')return [demand];if(args.method==='calendar')return {items:[],hasNext:false};if(args.method==='channels')return {destinations:[],channels:[]};return {};
 });
 await act(async()=>root.render(createElement(LiveCenter)));
 expect(host.textContent).toContain('真实数据');expect(host.querySelector('.cp-metrics')?.textContent).toContain('待领取351');expect(host.textContent).toContain('实际工作空间');
 expect(host.textContent).not.toContain('本机 · 模拟认领');
 expect(host.textContent).not.toContain('演示周期');expect(host.textContent).not.toContain('实际服务由中心接入');
 expect(host.textContent).toContain('各目标当前周期汇总');
 const calendar=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='发布日历')!;
 await act(async()=>calendar.click());
 expect(host.textContent).toContain('本周');expect(host.textContent).toContain('中心真实数据');
 expect(host.querySelector('.cp-counts')?.textContent).toBe('待领取351进行中0待处理0已交稿0全部任务351');
 expect(host.textContent).not.toContain('演示');expect(host.textContent).not.toContain('数据为示例');
});
it('offers the connection form to a signed-out device instead of an error or a Center read',async()=>{
 vi.mocked(invoke).mockImplementation(async(_command,args:any)=>args.method==='status'?{configured:false,agents:[]}:args.method==='auth_status'?{state:'idle'}:{});
 await act(async()=>root.render(createElement(LiveCenter)));
 expect(host.querySelector('[role=alert]')).toBeNull();expect(host.querySelector('.cp-tabs')).toBeNull();
 expect(Array.from(host.querySelectorAll('button')).some(button=>button.textContent==='登录 RSSD 中心')).toBe(true);
 expect(vi.mocked(invoke).mock.calls.some(([,a]:any)=>['overview','demands','calendar','channels'].includes(a.method))).toBe(false);
});
it('reads nothing while its workspace is not the one on screen',async()=>{
 vi.mocked(invoke).mockImplementation(async()=>({}));
 await act(async()=>root.render(createElement(LiveCenter,{active:false})));
 expect(vi.mocked(invoke)).not.toHaveBeenCalled();
});
