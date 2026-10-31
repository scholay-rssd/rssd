// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn(async()=>{})}));
import ConnectionCenter from '../connections/ConnectionCenter';
import {filterProviders,providers,safeResourceUrl,type Connection,type ConnectionService,type CenterState} from '../connections/client';

let host:HTMLDivElement,root:Root,service:ConnectionService,state:CenterState;
const initial=():CenterState=>({spaceId:'design',spaceName:'设计',vault:'测试凭证库',connections:providers.map(p=>({provider:p.id,configured:false,status:'unconfigured',target:''}))});
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;
async function input(selector:string,value:string){await act(async()=>{const el=host.querySelector<HTMLInputElement>(selector)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
async function click(text:string){await act(async()=>button(text).click());}
async function open(id:string){await act(async()=>host.querySelector<HTMLButtonElement>(`#connection-${id}`)!.click());}
beforeEach(async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 state=initial();
 service={list:vi.fn(async()=>structuredClone(state)),save:vi.fn(async(provider,secret,target)=>{if(secret==='bad-token')throw Error('授权无效');const v:Connection={provider,configured:true,status:'verified',target};state.connections=state.connections.map(c=>c.provider===provider?v:c);return v;}),verify:vi.fn(async provider=>state.connections.find(c=>c.provider===provider)!),disconnect:vi.fn(async provider=>{const v:Connection={provider,configured:false,status:'unconfigured',target:''};state.connections=state.connections.map(c=>c.provider===provider?v:c);return v;}),browse:vi.fn(async()=>({items:[]})),setEnabled:vi.fn(async(provider,enabled,spaceId)=>{if(spaceId!==state.spaceId)throw Error('工作空间已切换');const v={...state.connections.find(c=>c.provider===provider)!,enabled};state.connections=state.connections.map(c=>c.provider===provider?v:c);return v;})};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(createElement(ConnectionCenter,{service})));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
describe('connection directory',()=>{
 it('filters by category, search and actual saved connections',async()=>{
  expect(host.querySelectorAll('.connection-row')).toHaveLength(5);
  await click('阅读与资讯');expect(host.querySelectorAll('.connection-row')).toHaveLength(2);
  await input('[aria-label="搜索连接来源"]','Inoreader');expect(host.querySelectorAll('.connection-row')).toHaveLength(1);
  await act(async()=>host.querySelector<HTMLButtonElement>('.connection-count')!.click());expect(host.querySelectorAll('.connection-row')).toHaveLength(0);
  expect(host.textContent).toContain('没有符合条件');
 });
 it('only marks connected after successful verification and clears entered credentials',async()=>{
  await open('github');expect(host.querySelector<HTMLInputElement>('#connection-secret')!.type).toBe('password');
  await input('#connection-secret','bad-token');await click('验证并连接');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('授权无效');expect(host.querySelector('.connection-state')!.textContent).toBe('未连接');
  expect(host.querySelector<HTMLInputElement>('#connection-secret')!.value).toBe('');
  await input('#connection-secret','synthetic-good-token');await input('#connection-target','owner/repo');await click('验证并连接');
  expect(service.save).toHaveBeenLastCalledWith('github','synthetic-good-token','owner/repo');expect(host.querySelector('.connection-state')!.textContent).toBe('已验证');expect(host.querySelector<HTMLInputElement>('#connection-secret')!.value).toBe('');
  await click('全部来源');expect(host.querySelector('.connection-count')!.textContent).toContain('已连接 1 个');
 });
 it('keeps the previous connection when replacement fails, and blocks previews of unsaved scope',async()=>{
  await open('github');await input('#connection-secret','synthetic-good-token');await click('验证并连接');
  await input('#connection-target','owner/changed');expect(button('预览资料').disabled).toBe(true);
  await input('#connection-secret','bad-token');await click('验证并保存');
  expect(host.querySelector('.connection-state')!.textContent).toBe('已验证');expect(state.connections.find(c=>c.provider==='github')!.target).toBe('');
  expect(button('预览资料').disabled).toBe(true);
 });
 it('shows expired status and only disconnects after the explicit action',async()=>{
  await open('inoreader');await input('#connection-secret','synthetic-good-token');await click('验证并连接');
  service.verify=vi.fn(async()=>({provider:'inoreader',configured:true,status:'expired',target:'',message:'授权已失效'}));
  await click('检查连接');expect(host.querySelector('.connection-state')!.textContent).toBe('需更新授权');
  await click('解除连接');expect(service.disconnect).not.toHaveBeenCalled();await click('取消');expect(service.disconnect).not.toHaveBeenCalled();
  await click('解除连接');await click('确认解除');expect(service.disconnect).toHaveBeenCalledWith('inoreader');expect(host.querySelector('.connection-state')!.textContent).toBe('未连接');
 });
 it('paginates resource previews, excludes executable links and deduplicates ids',async()=>{
  await open('github');await input('#connection-secret','synthetic-good-token');await click('验证并连接');
  service.browse=vi.fn(async(_id,cursor)=>cursor?{items:[{id:'1',title:'First',detail:'',kind:'仓库'},{id:'2',title:'Second',detail:'',kind:'仓库',url:'javascript:alert(1)'}]}:{items:[{id:'1',title:'First',detail:'',kind:'仓库',url:'https://github.com/test/one'}],nextCursor:'2'});
  await click('预览资料');await click('加载更多');expect(service.browse).toHaveBeenLastCalledWith('github','2');expect(host.querySelectorAll('.connection-resources li')).toHaveLength(2);
  expect(host.querySelector('[aria-label="打开 Second"]')).toBeNull();
 });
 it('does not silently show an empty connected state after loading fails',async()=>{
  service.list=vi.fn(async()=>{throw Error('database unavailable');});
  await act(async()=>root.render(createElement(ConnectionCenter,{service:{...service}})));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('无法读取连接状态');expect(button('重新读取')).toBeTruthy();
 });
 it('toggles only the current space without deleting the connection or contacting the provider',async()=>{
  await open('github');await input('#connection-secret','synthetic-good-token');await input('#connection-target','owner/repo');await click('验证并连接');await click('全部来源');
  const toggle=()=>host.querySelector<HTMLButtonElement>('[role=switch][aria-label="在当前空间启用 GitHub"]')!;
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  await act(async()=>toggle().click());expect(service.setEnabled).toHaveBeenCalledWith('github',false,'design');expect(toggle().getAttribute('aria-checked')).toBe('false');
  expect(state.connections.find(c=>c.provider==='github')).toMatchObject({configured:true,target:'owner/repo',status:'verified'});
  expect(service.disconnect).not.toHaveBeenCalled();expect(service.browse).not.toHaveBeenCalled();expect(service.verify).not.toHaveBeenCalled();
  await open('github');expect(button('预览资料').disabled).toBe(true);await click('全部来源');await act(async()=>toggle().click());expect(toggle().getAttribute('aria-checked')).toBe('true');
 });
 it('keeps enablement unchanged if persistence fails',async()=>{
  await open('github');await input('#connection-secret','synthetic-good-token');await click('验证并连接');await click('全部来源');
  service.setEnabled=vi.fn(async()=>{throw Error('保存失败');});
  await act(async()=>host.querySelector<HTMLButtonElement>('[role=switch]')!.click());
  expect(host.querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('true');expect(host.querySelector('[role=alert]')?.textContent).toContain('保存失败');
 });
});
it('filters independently and rejects credential-bearing and non-web URLs',()=>{
 expect(filterProviders('GitHub','all',false,[]).map(p=>p.id)).toEqual(['github']);
 expect(safeResourceUrl('file:///etc/passwd')).toBeUndefined();expect(safeResourceUrl('https://token@example.com')).toBeUndefined();expect(safeResourceUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
});

describe('simple space connections',()=>{
 const compact=async(active=true)=>act(async()=>root.render(createElement(ConnectionCenter,{service,compact:true,active})));
 const toggle=()=>host.querySelector<HTMLButtonElement>('[role=switch][aria-label="在当前空间启用 GitHub"]')!;
 it('counts enabled connections in this space and shows all available providers',async()=>{
  state.connections[0]={...state.connections[0],configured:true,enabled:false,status:'verified'};
  state.connections=state.connections.map(c=>c.provider==='github'?{...c,configured:true,enabled:true,status:'verified'}:c);
  await compact(false); await compact();
  expect(host.querySelectorAll('.connection-row')).toHaveLength(5);
  expect(host.querySelector('[aria-label="搜索连接来源"]')).toBeNull();
  expect(host.querySelector('.connection-view-switch')?.textContent).toContain('当前空间已开启1');
  await act(async()=>host.querySelectorAll<HTMLButtonElement>('.connection-view-switch button')[1].click());
  expect(host.querySelectorAll('.connection-row')).toHaveLength(1);
  await act(async()=>toggle().click()); expect(service.setEnabled).toHaveBeenCalledWith('github',false,'design');
  expect(host.querySelectorAll('.connection-row')).toHaveLength(0);
  expect(host.textContent).toContain('当前空间尚未开启连接器');
  expect(service.disconnect).not.toHaveBeenCalled(); expect(service.browse).not.toHaveBeenCalled();
 });
 it('takes an unconfigured switch through credential setup then returns to the directory',async()=>{
  await compact(); await act(async()=>toggle().click());
  expect(service.setEnabled).not.toHaveBeenCalled();
  expect(host.querySelector('#connection-secret')).not.toBeNull();
  expect(button('预览资料')).toBeUndefined();
  await input('#connection-secret','synthetic-good-token'); await click('验证并连接');
  expect(host.querySelector('#connection-secret')).toBeNull();
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  expect(service.browse).not.toHaveBeenCalled();
 });
 it('finishes an in-flight toggle after leaving the page without leaving controls busy',async()=>{
  state.connections=state.connections.map(c=>({...c,configured:true,status:'verified'}));
  await compact(false); await compact();
  let finish!:(c:Connection)=>void;
  service.setEnabled=vi.fn(()=>new Promise<Connection>(resolve=>{finish=resolve;}));
  await act(async()=>toggle().click()); await compact(false);
  const next:Connection={provider:'github',configured:true,enabled:false,status:'verified',target:''};
  state.connections=state.connections.map(c=>c.provider==='github'?next:c);
  await act(async()=>finish(next)); await compact();
  expect(toggle().disabled).toBe(false); expect(toggle().getAttribute('aria-checked')).toBe('false');
 });
 it('refreshes enablement when revisiting and displays persistence errors without changing state',async()=>{
  await compact(false);
  state={...state,spaceId:'writing',spaceName:'写作',connections:state.connections.map(c=>({...c,configured:true,enabled:c.provider==='github',status:'verified'}))};
  await compact();
  expect(host.querySelector('.connection-space-name')?.textContent).toBe('写作');
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  service.setEnabled=vi.fn(async()=>{throw Error('工作空间已切换');});
  await act(async()=>toggle().click());
  expect(service.setEnabled).toHaveBeenCalledWith('github',false,'writing');
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('工作空间已切换');
 });
});
