// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import CursorAgentPane from '../editorial/CursorAgentPane';
const {invoke,listen}=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));vi.mock('@tauri-apps/api/event',()=>({listen}));vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
let host:HTMLDivElement,root:Root,receive:(v:any)=>void;
const state={connected:true,busy:false,status:'已连接',history:[],pending:[],sessionId:'qa'};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);listen.mockReset().mockImplementation(async(_event,cb)=>{receive=cb;return ()=>{};});invoke.mockReset().mockResolvedValue(state);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=(collapsed=false,readOnly=false)=>act(async()=>root.render(createElement(CursorAgentPane,{active:true,taskId:'qa',onChanged:vi.fn(),workflowRail:{collapsed,onToggle:vi.fn()},readOnly})));
const event=(payload:object)=>act(()=>receive({payload:{taskId:'qa',...payload}}));
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;
it('has only an execution drawer and no composer, model choice or reconnect surface',async()=>{
 await render();expect(host.querySelector('.flow-runtime')).not.toBeNull();
 expect(host.querySelector('textarea,.agent-composer,[aria-label="选择 Cursor 模型"]')).toBeNull();
 expect(host.textContent).not.toContain('连接 Cursor');expect(host.textContent).toContain('暂无执行记录');
 expect(invoke.mock.calls.map(([,v])=>v.method)).toEqual(['status']);
});
it('isolates task streams and renders streamed updates within an active execution group',async()=>{
 await render();event({type:'state',...state,busy:true});
 event({type:'message',message:{id:'m',role:'assistant',text:''}});
 event({type:'chunk',id:'m',text:'正在核对来源'});
 await act(async()=>{await new Promise(r=>setTimeout(r,40));});expect(host.textContent).toContain('正在核对来源');
 event({taskId:'other',type:'chunk',id:'m',text:'不能串用'});
 await act(async()=>{await new Promise(r=>setTimeout(r,40));});expect(host.textContent).not.toContain('不能串用');
 event({type:'state',...state,history:[{id:'m',role:'assistant',text:'最终内容'}]});
 expect(host.querySelector('.flow-run-summary')?.getAttribute('aria-expanded')).toBe('false');
 await act(async()=>host.querySelector<HTMLButtonElement>('.flow-run-summary')!.click());expect(host.textContent).toContain('最终内容');
});
it('collapsed records still receive permission requests and never auto-approve',async()=>{
 await render(true);event({type:'request',request:{requestId:'r',kind:'permission',title:'读取 RSS',options:[{optionId:'once',kind:'allow_once',name:'Allow'}]}});
 expect(host.querySelector('[aria-label="展开待处理事项"]')).not.toBeNull();expect(host.textContent).toContain('读取 RSS');
 expect(invoke.mock.calls.some(([,v])=>v.method==='respond')).toBe(false);
 await act(async()=>button('允许这一次').click());expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'respond',params:{taskId:'qa',requestId:'r',allow:true,optionId:'once',answers:undefined}});
});
it('stopped runs collapse and stale tools no longer animate',async()=>{
 await render();event({type:'state',...state,busy:true,history:[{id:'u',role:'user',text:'run',stageLabel:'选题'},{id:'t',role:'tool',text:'',tool:{title:'读取来源',status:'in_progress'}}]});
 expect(host.querySelector('.cursor-spinner')).not.toBeNull();
 event({type:'state',...state,busy:false,history:[{id:'u',role:'user',text:'run',stageLabel:'选题'},{id:'t',role:'tool',text:'',tool:{title:'读取来源',status:'in_progress'}},{id:'end',role:'turn',text:'',status:'已停止',finishedAt:2000,startedAt:1000}]});
 expect(host.querySelector('.flow-run-summary')?.getAttribute('aria-expanded')).toBe('false');
 await act(async()=>host.querySelector<HTMLButtonElement>('.flow-run-summary')!.click());
 expect(host.querySelector('.cursor-spinner')).toBeNull();expect(host.textContent).toContain('已停止');
});
it('preserves Markdown and diff inspection while excluding executable content and edit actions',async()=>{
 await render(false,true);event({type:'state',...state,history:[{id:'a',role:'assistant',text:'## 检索结果\n\n<script>alert(1)</script><img src="https://example.org/tracker">'},{id:'d',role:'change',text:'',change:{path:'正文.md',articleId:'a',oldText:'# 原稿',newText:'# 成稿',sha256:'sha'}}]});
 await act(async()=>host.querySelector<HTMLButtonElement>('.flow-run-summary')!.click());
 expect(host.querySelector('h2')?.textContent).toBe('检索结果');expect(host.querySelector('script,img')).toBeNull();expect(host.querySelector('.cursor-diff')).not.toBeNull();
 expect(host.textContent).not.toContain('编辑后再次发送');expect(host.querySelector('textarea')).toBeNull();
});
it('can stop an active run through the drawer',async()=>{
 await render();event({type:'state',...state,busy:true});await act(async()=>button('停止').click());
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'cancel',params:{taskId:'qa'}});
});

const plan=(entries:{content:string;status:string}[])=>({id:'p',role:'plan',text:'',entries});
const tool=(id:string,title:string,status='completed')=>({id,role:'tool',text:'',tool:{title,status}});
it('shows determinate progress from the agent plan in the status card and in the collapsed rail',async()=>{
 const history=[{id:'u',role:'user',text:'run',stageLabel:'选题'},plan([{content:'检索 RSS',status:'completed'},{content:'核对来源',status:'completed'},{content:'保存选题板',status:'in_progress'},{content:'整理缺口',status:'pending'}])];
 await render();event({type:'state',...state,busy:true,status:'执行中',history});
 const card=host.querySelector('.flow-status-card')!;expect(card.textContent).toContain('执行中');expect(card.textContent).toContain('2/4 步');expect(card.textContent).toContain('保存选题板');
 expect(card.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBe('2');expect((card.querySelector('.flow-status-bar i') as HTMLElement).style.width).toBe('50%');
 await act(async()=>root.render(createElement(CursorAgentPane,{active:true,taskId:'qa',onChanged:vi.fn(),workflowRail:{collapsed:true,onToggle:vi.fn()}})));
 const rail=host.querySelector('.flow-progress-rail')!,bar=rail.querySelector('[role=progressbar]')!;
 expect(rail.textContent).toBe('');expect(rail.className).toContain('is-running');expect(rail.querySelector('.flow-lamp')).not.toBeNull();
 expect([...rail.querySelectorAll('.flow-step-lights i')].map(l=>l.className)).toEqual(['is-done','is-done','is-current','is-idle']);
 expect(bar.getAttribute('aria-valuenow')).toBe('2');expect(bar.getAttribute('aria-valuemax')).toBe('4');expect(rail.getAttribute('title')).toContain('2/4 步');expect(rail.getAttribute('title')).toContain('保存选题板');
});
it('without a plan the rail lights one step per finished tool and never fakes a percentage',async()=>{
 await render(true);event({type:'state',...state,busy:true,status:'执行中',history:[{id:'u',role:'user',text:'run',stageLabel:'选题'},tool('a','读取来源'),tool('b','核对日期'),tool('c','保存','in_progress')]});
 const rail=host.querySelector('.flow-progress-rail')!;expect(rail.textContent).toBe('');
 expect([...rail.querySelectorAll('.flow-step-lights i')].map(l=>l.className)).toEqual(['is-done','is-done','is-current']);expect(rail.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBeNull();expect(rail.getAttribute('title')).toContain('已完成 2 步');
});
it('the rail is a single lamp when idle, and the lamp state follows waiting, error and completion',async()=>{
 await render(true);let rail=host.querySelector('.flow-progress-rail')!;expect(rail.className).toContain('is-idle');expect(rail.querySelectorAll('.flow-step-lights i')).toHaveLength(0);
 event({type:'state',...state,busy:false,status:'已完成',history:[{id:'u',role:'user',text:'run'},tool('a','读取')]});rail=host.querySelector('.flow-progress-rail')!;expect(rail.className).toContain('is-complete');expect([...rail.querySelectorAll('.flow-step-lights i')].map(l=>l.className)).toEqual(['is-done']);
 event({type:'state',...state,busy:false,status:'失败：超时',history:[]});expect(host.querySelector('.flow-progress-rail')!.className).toContain('is-error');
 event({type:'request',request:{requestId:'r',kind:'permission',title:'读取',options:[{optionId:'once',kind:'allow_once',name:'Allow'}]}});expect(host.querySelector('.flow-progress-rail')!.className).toContain('is-waiting');
});
it('merges consecutive tool calls into one row and keeps long replies clamped',async()=>{
 const long='长回复。'.repeat(120);
 await render();event({type:'state',...state,busy:true,status:'执行中',history:[{id:'u',role:'user',text:'run',stageLabel:'选题'},tool('a','读取来源'),tool('b','核对日期'),tool('c','保存选题板','in_progress'),{id:'m',role:'assistant',text:long}]});
 const batches=host.querySelectorAll('.flow-tool-batch');expect(batches).toHaveLength(1);expect(batches[0].textContent).toContain('正在执行：保存选题板');expect(batches[0].textContent).toContain('3 步');expect(host.querySelectorAll('.cursor-tool')).toHaveLength(0);
 await act(async()=>batches[0].querySelector('button')!.click());expect(host.querySelectorAll('.flow-tool-list .cursor-tool')).toHaveLength(3);
 expect(host.querySelector('.agent-message.is-clamped')).not.toBeNull();await act(async()=>host.querySelector<HTMLButtonElement>('.agent-clamp-toggle')!.click());expect(host.querySelector('.agent-message.is-clamped')).toBeNull();
});
it('a finished run stays collapsed but its header says what happened',async()=>{
 await render();event({type:'state',...state,busy:false,history:[{id:'u',role:'user',text:'run',stageLabel:'选题'},tool('a','读取来源'),tool('b','保存'),{id:'m',role:'assistant',text:'## 选题完成\n已保存 3 条素材'},{id:'d',role:'change',text:'',change:{path:'板.json',articleId:'a',oldText:'a',newText:'b',sha256:'s'}},{id:'t',role:'turn',text:'',status:'已完成',startedAt:1000,finishedAt:4000}]});
 const summary=host.querySelector('.flow-run-summary')!;expect(summary.getAttribute('aria-expanded')).toBe('false');
 expect(summary.querySelector('.flow-run-brief')!.textContent).toBe('2 个步骤 · 1 处修改 · 选题完成');expect(host.querySelector('.flow-run-group')!.className).toContain('is-ok');
});

it('keeps article conversation and streamed replies across assistant pages, with shared pending actions',async()=>{
 const show=(view:'config'|'chat')=>act(async()=>root.render(createElement(CursorAgentPane,{active:true,taskId:'qa',onChanged:vi.fn(),workflowRail:{collapsed:false,onToggle:vi.fn()},conversation:{compact:true,view,header:'助手',tools:createElement('input',{defaultValue:'配置保留'}),composer:createElement('textarea',{defaultValue:'输入保留'})}})));
 await show('chat');expect(host.textContent).toContain('从这里开始对话');
 event({type:'message',message:{id:'u',role:'user',text:'我的要求'}});event({type:'message',message:{id:'a',role:'assistant',text:'开始答复'}});
 await show('config');expect(host.querySelector<HTMLElement>('#assistant-panel-chat')!.hidden).toBe(true);
 event({type:'chunk',id:'a',text:'，已补充'});event({type:'request',request:{requestId:'r',kind:'permission',title:'读取资料',options:[{optionId:'once',kind:'allow_once',name:'Allow'}]}});
 await act(async()=>{await new Promise(r=>setTimeout(r,40));});expect(host.querySelector('.notebook-agent-status')!.textContent).toContain('读取资料');
 await show('chat');expect(host.querySelector('#assistant-panel-chat')!.textContent).toContain('我的要求');expect(host.querySelector('#assistant-panel-chat')!.textContent).toContain('开始答复，已补充');expect(host.querySelector('textarea')!.value).toBe('输入保留');expect(invoke.mock.calls.filter(([,v])=>v.method==='status')).toHaveLength(1);
});
