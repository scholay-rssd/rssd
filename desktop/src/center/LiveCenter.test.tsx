// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import LiveCenter,{mapLiveCenter} from './LiveCenter';
import {invoke} from '../lib/nativeCore';
vi.mock('../lib/nativeCore',()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn(async()=>{})}));
vi.mock('../uiText',()=>({tr:(s:string)=>s,uiLocale:()=>'zh-CN'}));
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
const live=(extra:(args:any)=>any=()=>undefined)=>vi.mocked(invoke).mockImplementation(async(_command,args:any)=>{
 const special=extra(args);if(special!==undefined)return special;
 if(args.method==='status')return {configured:true,origin:'https://center.example',agents:[]};
 if(args.method==='overview')return overview;if(args.method==='demands')return [demand];if(args.method==='calendar')return {items:[],hasNext:false};if(args.method==='channels')return {destinations:[],channels:[]};return {};
});
const count=(method:string)=>vi.mocked(invoke).mock.calls.filter(([,a]:any)=>a.method===method).length;
const press=async(match:(button:HTMLButtonElement)=>boolean)=>{await act(async()=>Array.from(host.querySelectorAll('button')).find(match)!.click());};
it('re-reads only the calendar when the calendar moves',async()=>{
 live();await act(async()=>root.render(createElement(LiveCenter)));
 await press(button=>button.textContent==='发布日历');
 const before={overview:count('overview'),demands:count('demands'),channels:count('channels'),calendar:count('calendar')};
 await press(button=>button.getAttribute('aria-label')==='下一时段');
 expect(count('calendar')).toBe(before.calendar+1);
 expect({overview:count('overview'),demands:count('demands'),channels:count('channels')}).toEqual({overview:before.overview,demands:before.demands,channels:before.channels});
});
it('says when the Center holds more tasks than are listed and loads the next page inside the list',async()=>{
 live(args=>args.method==='demands'?(args.params.offset?[]:Array.from({length:200},(_,i)=>({...demand,id:'demand-'+i}))):undefined);
 await act(async()=>root.render(createElement(LiveCenter)));
 await press(button=>button.textContent?.startsWith('需求池')===true);
 const footer=host.querySelector('main.center-preview .cp-list-footer')!;expect(footer.textContent).toContain('已显示');
 const overviews=count('overview');
 await press(button=>button.textContent==='加载更多');
 expect(vi.mocked(invoke).mock.calls.some(([,a]:any)=>a.method==='demands'&&a.params.offset===200)).toBe(true);
 expect(count('overview')).toBe(overviews);expect(host.querySelector('.cp-list-footer')).toBeNull();
});
it('searches tasks at the Center instead of only among the loaded rows',async()=>{
 live(args=>args.method==='demands'&&args.params.search==='仅写作要求命中'?[{...demand,id:'found',title:'标题里没有这个词'}]:undefined);
 await act(async()=>root.render(createElement(LiveCenter)));
 await press(button=>button.textContent?.startsWith('需求池')===true);
 const input=host.querySelector<HTMLInputElement>('input[type=search]')!,overviews=count('overview');
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'仅写作要求命中');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(host.textContent).not.toContain('标题里没有这个词');
 await act(async()=>{await new Promise(done=>setTimeout(done,350));});
 expect(host.textContent).toContain('标题里没有这个词');expect(count('overview')).toBe(overviews);
});
it('shows what this machine is doing and what it is still holding',async()=>{
 live(args=>args.method==='status'?{configured:true,origin:'https://center.example',agents:[],worker:{state:'working'},outbox:[{requestId:'r',state:'pending'},{requestId:'done',state:'accepted'}]}:undefined);
 await act(async()=>root.render(createElement(LiveCenter,{legacy:()=>null})));
 expect(host.querySelector('.cp-execution')?.textContent).toBe('本机执行 · 工作中1');
 expect(host.querySelector('.cp-held')?.textContent).toContain('本机待处理稿件 · 1');
});
