// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const {invoke,events}=vi.hoisted(()=>({invoke:vi.fn(),events:{emit:(_:unknown)=>{}}}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async(_:string,handler:(e:{payload:unknown})=>void)=>{events.emit=payload=>handler({payload});return()=>{};})}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
import AiFeedSearch,{discoveryBoard,MAX_DIRECTIONS} from '../components/AiFeedSearch';
import {validateTopicSlots} from '../../scripts/agent/topic-slots.mjs';

const feed=(feedUrl:string)=>({id:1,feedUrl,title:'已有'}) as any;
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,tasks:any[],toast:ReturnType<typeof vi.fn>;
const button=(text:string)=>[...host.querySelectorAll('button')].find(x=>x.textContent===text) as HTMLButtonElement;
const calls=(method:string)=>invoke.mock.calls.filter(([name,p])=>name==='cursor_agent_call'&&p.method===method).map(([,p])=>p.params);
async function mount(feeds:any[]=[]){await act(async()=>root.render(createElement(QueryClientProvider,{client:new QueryClient()},createElement(AiFeedSearch,{feeds,onToast:toast}))));}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;tasks=[];toast=vi.fn();
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 invoke.mockReset();invoke.mockImplementation(async(name:string,p:any)=>{
  if(name==='add_feed'){if(p.url.includes('broken'))throw Error('不是有效的订阅源');return feed(p.url);}
  const {method,params}=p;
  if(method==='task_list')return tasks;
  if(method==='task_states')return {};
  if(method==='task_create'){const t={id:'new',mode:params.mode,title:params.title,brief:params.brief,revision:1,updatedAt:'2026-10-09T00:00:00Z',board:{titles:[],sections:[]},ui:{tabs:[]}};tasks=[t,...tasks];return t;}
  const t=tasks.find(x=>x.id===params.taskId);
  if(method==='task_update'){Object.assign(t,params.patch,{revision:t.revision+1});return {...t};}
  if(method==='task_workflow'){t.workflow={authorized:params.authorized,sources:params.sources};t.revision++;return {...t};}
  if(method==='task_get')return {...t};
  return {runId:'r1'};
 });
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

it('builds a board the engine accepts and caps the directions',()=>{
 const board=discoveryBoard(Array.from({length:8},(_,i)=>({name:'方向'+i,prompt:'寻找订阅源'+i})));
 expect(board.sections).toHaveLength(1);expect(board.sections[0].slots).toHaveLength(MAX_DIRECTIONS);expect(board.sections[0].slotCount).toBe(MAX_DIRECTIONS);
 expect(board.sections[0].slots!.every(s=>s.mode==='smart'&&s.prompt!.includes('订阅源'))).toBe(true);
 expect(()=>validateTopicSlots({titles:[],sections:[]},board,{agent:false})).not.toThrow();
});

it('starts one discovery run from the chosen directions without subscribing anything',async()=>{
 await mount();
 expect(button('开始搜索').disabled).toBe(true);
 await act(async()=>button('机构订阅').click());
 const input=host.querySelector<HTMLInputElement>('input[aria-label="自定义搜索方向"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'计算语言学期刊');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>button('开始搜索').click());
 expect(calls('task_create')[0]).toMatchObject({mode:'rss',brief:'计算语言学期刊'});
 const board=calls('task_update')[0].patch.board;
 expect(board.sections[0].slots.map((s:any)=>s.templateName)).toEqual(['机构订阅','计算语言学期刊']);
 expect(calls('task_workflow')[0]).toMatchObject({action:'configure',authorized:true});
 expect(calls('task_run')).toEqual([{taskId:'new',action:'topic'}]);
 expect(invoke.mock.calls.some(([name])=>name==='add_feed')).toBe(false);
 expect(host.querySelectorAll('.ai-feed-row.is-waiting')).toHaveLength(2);
});

it('lists verified feeds, subscribes only on request and reports a failed address on its row',async()=>{
 const item=(id:string,url:string)=>({id,title:'源 '+id,summary:'覆盖范围',url,publisher:'原站',date:'2026-10-09'});
 tasks=[{id:'old',mode:'rss',title:'AI 搜索：期刊',revision:3,updatedAt:'2026-10-08T00:00:00Z',ui:{tabs:[]},board:{titles:[],sections:[{id:'s',title:'订阅源',slotCount:3,slots:[{id:'a',mode:'smart'},{id:'b',mode:'smart'},{id:'c',mode:'smart'}],items:[item('a','https://example.org/feed.xml'),item('b','https://example.org/broken'),item('c','https://have.example/rss/')]}]}},
  {id:'draft',mode:'observation',title:'不是搜索',revision:1,updatedAt:'2026-10-09T00:00:00Z',ui:{tabs:[]},board:{titles:[],sections:[]}}];
 await mount([feed('https://have.example/rss')]);
 const rows=[...host.querySelectorAll('.ai-feed-row')];expect(rows).toHaveLength(3);
 expect(host.textContent).not.toContain('不是搜索');
 const action=(i:number)=>rows[i].querySelector<HTMLButtonElement>('.s-btn')!;
 expect(action(2).textContent).toBe('已订阅');expect(action(2).disabled).toBe(true);
 await act(async()=>action(0).click());
 expect(invoke).toHaveBeenCalledWith('add_feed',{url:'https://example.org/feed.xml',folderId:null});expect(toast).toHaveBeenCalledWith('已订阅：源 a');
 await act(async()=>action(1).click());
 expect(rows[1].querySelector('[role=alert]')?.textContent).toContain('不是有效的订阅源');expect(toast).toHaveBeenCalledTimes(1);
});

it('follows the running task: shows slot progress and offers stop instead of a second search',async()=>{
 tasks=[{id:'run',mode:'rss',title:'AI 搜索：机构',revision:2,updatedAt:'2026-10-09T00:00:00Z',ui:{tabs:[]},board:{titles:[],sections:[{id:'s',title:'订阅源',slotCount:1,slots:[{id:'a',mode:'smart',templateName:'机构订阅'}],items:[]}]}}];
 await mount();
 await act(async()=>events.emit({type:'task_state',taskId:'run',state:{busy:true,status:'正在检索',collection:{a:{status:'searching',detail:'核验地址'}}}}));
 expect(host.querySelector('.ai-feed-row.is-waiting')?.textContent).toContain('正在检索 · 核验地址');
 expect(button('开始搜索')).toBeUndefined();
 await act(async()=>button('停止').click());
 expect(calls('cancel')).toEqual([{taskId:'run'}]);
});
