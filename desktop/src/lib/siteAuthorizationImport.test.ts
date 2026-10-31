// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import SiteAuthorizationImport from '../components/SiteAuthorizationImport';
vi.mock('./nativeCore',()=>({invoke:vi.fn()}));
vi.mock('../components/SpaceEntrances',()=>({openCreativeSpace:vi.fn()}));
import {invoke} from './nativeCore';
import {openCreativeSpace} from '../components/SpaceEntrances';
let host:HTMLDivElement,root:Root;
const imported=vi.fn(),busy=vi.fn();
const result={connected:true,spaceId:'legis',siteId:'legis',name:'智能法案',origin:'https://legis.wiki',existing:false,message:'空间已创建并连接'};
const file=(name='legis.scholay-site.json',content='private-file-contents')=>Object.assign(new File([content],name),{text:()=>Promise.resolve(content)});
async function drop(files:File[]){const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files}});await act(async()=>host.querySelector('[role="region"]')!.dispatchEvent(event));}
async function render(){await act(async()=>root.render(createElement(SiteAuthorizationImport,{disabled:false,currentSpace:"academic",onImported:imported,onBusyChange:busy})));}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.mocked(invoke).mockReset().mockResolvedValue(result);vi.mocked(openCreativeSpace).mockReset().mockResolvedValue();imported.mockReset().mockResolvedValue(undefined);busy.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('accepts one dropped file, refreshes the registry and only enters the space on request',async()=>{
 await render();await drop([file()]);
 expect(invoke).toHaveBeenCalledExactlyOnceWith('space_authorization',{content:'private-file-contents'});expect(imported).toHaveBeenCalledWith(result);
 expect(host.textContent).toContain('智能法案');expect(host.textContent).not.toContain('private-file-contents');expect(openCreativeSpace).not.toHaveBeenCalled();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='进入此空间')!.click());expect(openCreativeSpace).toHaveBeenCalledWith('legis');
});
it('keeps file selection available for keyboard users and handles cancellation without creating a space',async()=>{
 vi.mocked(invoke).mockResolvedValue({cancelled:true});await render();await act(async()=>host.querySelector('button')!.click());
 expect(invoke).toHaveBeenCalledWith('space_authorization',{content:null});expect(imported).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('rejects multiple, unsupported and oversized files before invoking native operations',async()=>{
 await render();await drop([file(),file()]);await drop([file('old-token.txt')]);await drop([file('huge.json','x'.repeat(65537))]);
 expect(invoke).not.toHaveBeenCalled();expect(imported).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it('serializes repeated drops and retains errors for a deliberate retry',async()=>{
 let reject!:(e:Error)=>void;vi.mocked(invoke).mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));
 await render();await drop([file()]);await drop([file()]);expect(invoke).toHaveBeenCalledTimes(1);
 await act(async()=>reject(Error('授权已撤销')));expect(host.textContent).toContain('授权已撤销');expect(imported).not.toHaveBeenCalled();
 await drop([file()]);expect(invoke).toHaveBeenCalledTimes(2);expect(imported).toHaveBeenCalledOnce();
});
