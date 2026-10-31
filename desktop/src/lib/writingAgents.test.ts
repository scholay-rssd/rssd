// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import AgentSelector,{DraftAgentSelector} from '../agents/AgentSelector';
import WritingAgentSettings from '../agents/WritingAgentSettings';
const {invoke,listen}=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
let host:HTMLDivElement,root:Root,state:any,data:any;
const choice=(label:string)=>host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
const select=(label:string,value:string)=>act(async()=>{const el=choice(label);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);
 state={agentId:'codex',connected:true,history:[],configuration:{configOptions:[{id:'model',category:'model',currentValue:'alpha',options:[{value:'alpha',name:'Alpha'},{value:'beta',name:'Beta'}]}]}};
 data={defaultAgentId:'cursor',agents:[{id:'cursor',name:'Cursor',enabled:true,available:true},{id:'codex',name:'Codex',adapter:'acp',enabled:true,available:true},{id:'hermes',name:'Hermes',enabled:true,available:false}]};
 listen.mockReset().mockResolvedValue(()=>{});invoke.mockReset().mockImplementation(async(_c,{method,params})=>{
  if(method==='agent_list')return data;if(method==='status')return structuredClone(state);
  if(method==='agent_select')state={...state,agentId:params.agentId,connected:false,configuration:{}};
  if(method==='connect')state.connected=true;
  if(method==='configure')state.configuration.configOptions[0].currentValue=params.value;
  if(method==='agent_default')data.defaultAgentId=params.agentId;
  if(method==='agent_check')return {status:'ACP 协议就绪'};
  return {};
 });
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('selects an available provider and provider-supplied model without changing defaults or sending a prompt',async()=>{
 await act(async()=>root.render(createElement(AgentSelector,{taskId:'one'})));
 expect(choice('会话智能体').value).toBe('codex');expect(choice('会话智能体').querySelector<HTMLOptionElement>('[value=hermes]')?.disabled).toBe(true);
 await select('会话模型','beta');expect(state.configuration.configOptions[0].currentValue).toBe('beta');
 await select('会话智能体','cursor');expect(choice('会话智能体').value).toBe('cursor');expect(choice('会话模型')).toBeNull();
 expect(invoke.mock.calls.some(([,a])=>['prompt','task_create','agent_default'].includes(a.method))).toBe(false);
});
it('locks the provider after a user message and ignores other task events',async()=>{
 state.history=[{role:'user'}];await act(async()=>root.render(createElement(AgentSelector,{taskId:'one'})));
 expect(choice('会话智能体').disabled).toBe(true);expect(choice('会话模型').disabled).toBe(false);
 await act(async()=>window.dispatchEvent(new CustomEvent('today:agent-event',{detail:{taskId:'other',type:'state',agentId:'cursor'}})));
 expect(choice('会话智能体').value).toBe('codex');
 await act(async()=>window.dispatchEvent(new CustomEvent('today:agent-event',{detail:{...state,taskId:'one',type:'state',busy:true}})));
 expect(choice('会话模型').disabled).toBe(true);
});
it('offers reconnect for a restored session with saved model options',async()=>{
 state.connected=false;state.history=[{role:'user'}];
 await act(async()=>root.render(createElement(AgentSelector,{taskId:'one'})));
 expect(choice('会话模型')).toBeNull();expect(choice('会话智能体').disabled).toBe(true);
 const reconnect=host.querySelector<HTMLButtonElement>('button[title="连接智能体并读取可用模型"]')!;
 expect(reconnect.disabled).toBe(false);await act(async()=>reconnect.click());
 expect(choice('会话模型').value).toBe('alpha');expect(choice('会话模型').disabled).toBe(false);
 expect(invoke.mock.calls.some(([,a])=>a.method==='prompt')).toBe(false);
});
it('does not let a late operation from the previous task change the next task selector',async()=>{
 const original=invoke.getMockImplementation()!;let finish!:()=>void;
 invoke.mockImplementation((c,a)=>a.method==='configure'?new Promise<void>(r=>finish=r):original(c,a));
 await act(async()=>root.render(createElement(AgentSelector,{taskId:'one'})));await select('会话模型','beta');
 state={agentId:'cursor',history:[]};await act(async()=>root.render(createElement(AgentSelector,{taskId:'two'})));
 await act(async()=>finish());expect(choice('会话智能体').value).toBe('cursor');expect(choice('会话智能体').disabled).toBe(false);
});
it('gallery draft selection stays local until first send',async()=>{
 const changed=vi.fn();await act(async()=>root.render(createElement(DraftAgentSelector,{onChange:changed})));
 await select('会话智能体','codex');expect(changed).toHaveBeenCalledWith('codex');expect(invoke.mock.calls.map(([,a])=>a.method)).toEqual(['agent_list']);
});
it('manages workspace defaults without creating a manuscript or claiming authentication',async()=>{
 await act(async()=>root.render(createElement(WritingAgentSettings)));
 expect(host.textContent).toContain('授权按需检查');await select('当前空间默认智能体','codex');expect(data.defaultAgentId).toBe('codex');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='检查')!.click());
 expect(host.textContent).toContain('账号可用性在连接会话时确认');expect(invoke.mock.calls.some(([,a])=>['task_create','connect','prompt'].includes(a.method))).toBe(false);
});
