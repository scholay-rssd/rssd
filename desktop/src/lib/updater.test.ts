// @vitest-environment jsdom
import {beforeEach,afterEach,test,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({check:vi.fn(),ask:vi.fn(),relaunch:vi.fn(),show:vi.fn(),error:vi.fn(),push:vi.fn()}));
vi.mock('@tauri-apps/plugin-updater',()=>({check:mock.check}));
vi.mock('@tauri-apps/plugin-dialog',()=>({ask:mock.ask}));
vi.mock('@tauri-apps/plugin-process',()=>({relaunch:mock.relaunch}));
vi.mock('../toast',()=>({toast:{show:mock.show,error:mock.error},useToasts:{getState:()=>({push:mock.push})}}));
beforeEach(()=>{vi.resetModules();Object.values(mock).forEach(fn=>fn.mockReset());localStorage.clear();mock.ask.mockResolvedValue(true);});
afterEach(()=>vi.restoreAllMocks());
const update=()=>({version:'0.16.3',download:vi.fn().mockResolvedValue(undefined),install:vi.fn().mockResolvedValue(undefined)});
test('automatic checks download once and offer installation without restarting an editor',async()=>{
 const u=update();mock.check.mockResolvedValue(u);const {checkForUpdates}=await import('./updater');
 await Promise.all([checkForUpdates({silent:true}),checkForUpdates({silent:true})]);
 expect(mock.check).toHaveBeenCalledTimes(1);expect(u.download).toHaveBeenCalledTimes(1);expect(u.install).not.toHaveBeenCalled();expect(mock.relaunch).not.toHaveBeenCalled();expect(mock.push.mock.calls[0][0].text).toContain('更新已下载');
});
test('disabled automatic downloads still announce the available version',async()=>{
 const u=update();mock.check.mockResolvedValue(u);const api=await import('./updater');api.setAutoDownloadUpdates(false);await api.checkForUpdates({silent:true});
 expect(u.download).not.toHaveBeenCalled();expect(mock.push.mock.calls[0][0].text).toContain('发现新版本');
});
test('manual install waits for the existing editor guard and refuses to interrupt dirty or running work',async()=>{
 const u=update();mock.check.mockResolvedValue(u);const block=(e:Event)=>(e as CustomEvent).detail.promises.push(Promise.reject(Error('有未保存的正文')));window.addEventListener('scholay-space-will-switch',block);
 try{await (await import('./updater')).checkForUpdates({silent:false});}finally{window.removeEventListener('scholay-space-will-switch',block);}
 expect(u.install).not.toHaveBeenCalled();expect(mock.relaunch).not.toHaveBeenCalled();expect(mock.error.mock.calls[0][0]).toContain('未保存');
});
test('manual update downloads, validates the idle state again, installs and relaunches',async()=>{
 const u=update();mock.check.mockResolvedValue(u);let checks=0;const guard=(e:Event)=>{checks++;(e as CustomEvent).detail.promises.push(Promise.resolve());};window.addEventListener('scholay-space-will-switch',guard);
 try{await (await import('./updater')).checkForUpdates({silent:false});}finally{window.removeEventListener('scholay-space-will-switch',guard);}
 expect(checks).toBe(2);expect(u.install).toHaveBeenCalledTimes(1);expect(mock.relaunch).toHaveBeenCalledTimes(1);
});
test('a rejected download or signature never reaches installation',async()=>{
 const u=update();u.download.mockRejectedValue(Error('signature mismatch'));mock.check.mockResolvedValue(u);await (await import('./updater')).checkForUpdates({silent:false});
 expect(u.install).not.toHaveBeenCalled();expect(mock.relaunch).not.toHaveBeenCalled();expect(mock.error.mock.calls[0][0]).toContain('signature mismatch');
});
