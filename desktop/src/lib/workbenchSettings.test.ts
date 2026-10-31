// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
const call=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({invoke:call}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async()=>()=>{})}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
import WorkbenchSettings from '../components/WorkbenchSettings';
it('initializes via native picker, masks credentials and refreshes workbench only after binding succeeds',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 call.mockImplementation(async(name,p)=>name==='space_context'?{spaceId:'academic',siteId:'scholay-today',spaces:[{id:'academic',name:'Scholay Today',domain:'学术',origin:'https://today.scholay.com'}]}:name==='editorial_location'?{path:'D:\\稿件'}:p.method==='status'?{configured:false,vault:'Windows 凭据管理器'}:{message:'verified'});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),changed=vi.fn();window.addEventListener('scholay-workspace-changed',changed);
 try{
  await act(async()=>root.render(createElement(WorkbenchSettings)));
  const button=(text:string)=>[...host.querySelectorAll('button')].find(x=>x.textContent===text)!;
  await act(async()=>button('选择空文件夹并初始化').click());
  expect(call).toHaveBeenCalledWith('editorial_location',{method:'initialize_pick',path:null});
  expect(changed).toHaveBeenCalledTimes(1);
  expect(host.querySelector('input')?.type).toBe('password');
  await act(async()=>button('导入旧版令牌').click());
  expect(call).toHaveBeenCalledWith('workbench_connection',{method:'import',token:null});
  expect(changed).toHaveBeenCalledTimes(2);
  call.mockImplementation(async(name,p)=>{if(p?.method==='import')throw Error('invalid credential');return{configured:false};});
  await act(async()=>button('导入旧版令牌').click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('invalid credential');
  expect(changed).toHaveBeenCalledTimes(2);
 }finally{await act(async()=>root.unmount());host.remove();window.removeEventListener('scholay-workspace-changed',changed);}
});
