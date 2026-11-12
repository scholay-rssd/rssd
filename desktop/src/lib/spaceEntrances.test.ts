// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import SpaceEntrances,{openCreativeSpace} from '../components/SpaceEntrances';
import profiles from '../../../sites/profiles.json';
import {hasBlockingOverlay} from './useBlockingOverlay';
import {SpaceSwitchBlockedError} from './spaceTransition';
vi.mock('@tauri-apps/api/core',()=>({isTauri:vi.fn(()=>false),invoke:vi.fn().mockResolvedValue(undefined)}));
import {invoke,isTauri} from '@tauri-apps/api/core';
let host:HTMLDivElement,root:Root;
const render=()=>act(async()=>root.render(createElement(SpaceEntrances,{disabled:false})));
const trigger=()=>host.querySelector<HTMLButtonElement>('.space-entrance')!;
const choices=()=>Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.mocked(isTauri).mockReturnValue(false);vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('never switches databases if saving current work fails',async()=>{
 const stop=(e:Event)=>(e as CustomEvent).detail.promises.push(Promise.reject(Error('save conflict')));
 window.addEventListener('scholay-workbench-flush',stop);vi.mocked(invoke).mockClear();
 try{await expect(openCreativeSpace('pets')).rejects.toThrow('save conflict');expect(invoke).not.toHaveBeenCalled();}
 finally{window.removeEventListener('scholay-workbench-flush',stop);}
});
it('keeps the current space when a save hangs, even if that save eventually completes',async()=>{
 vi.useFakeTimers();
 let finish!:()=>void;
 const save=new Promise<void>(resolve=>{finish=resolve;});
 const stop=(e:Event)=>(e as CustomEvent).detail.promises.push(save);
 window.addEventListener('scholay-workbench-flush',stop);
 try{
  const failed=expect(openCreativeSpace('pets')).rejects.toThrow('保存当前空间超时');
  await vi.advanceTimersByTimeAsync(15_000);await failed;
  expect(invoke).not.toHaveBeenCalled();
  finish();await Promise.resolve();expect(invoke).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
 }finally{window.removeEventListener('scholay-workbench-flush',stop);vi.useRealTimers();}
});
it('clears a temporary switch notice when pending work ends but preserves other errors',async()=>{
 let failure:Error=new SpaceSwitchBlockedError('官网操作尚未完成');
 const block=(event:Event)=>(event as CustomEvent).detail.promises.push(Promise.reject(failure));
 window.addEventListener('scholay-space-will-switch',block);
 try{
  await render();await act(async()=>trigger().click());await act(async()=>choices()[1].click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('官网操作尚未完成');expect(invoke).not.toHaveBeenCalled();
  await act(async()=>window.dispatchEvent(new Event('scholay-space-switch-unblocked')));expect(host.querySelector('[role=alert]')).toBeNull();
  failure=Error('数据库不可读');await act(async()=>trigger().click());await act(async()=>choices()[1].click());
  await act(async()=>window.dispatchEvent(new Event('scholay-space-switch-unblocked')));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('数据库不可读');
 }finally{window.removeEventListener('scholay-space-will-switch',block);}
});
it('shows one current logo and opens the registered-space picker without switching until a choice is made',async()=>{
 await render();
 expect(host.querySelectorAll('.space-entrance')).toHaveLength(1);expect(choices()).toHaveLength(0);
 await act(async()=>trigger().click());
 expect(trigger().getAttribute('aria-expanded')).toBe('true');expect(hasBlockingOverlay()).toBe(true);
 expect(choices()).toHaveLength(profiles.length);expect(choices().map(b=>b.querySelector('strong')?.textContent)).toEqual(profiles.map(s=>s.name));
 expect(choices()[0].getAttribute('aria-current')).toBe('true');expect(invoke).not.toHaveBeenCalled();
 await act(async()=>choices()[0].click());expect(invoke).not.toHaveBeenCalled();expect(choices()).toHaveLength(0);
 await act(async()=>trigger().click());
 await act(async()=>choices()[1].click());expect(invoke).toHaveBeenLastCalledWith('space_select',{spaceId:'xsime'});
 expect(choices()).toHaveLength(0);expect(hasBlockingOverlay()).toBe(false);
});
it('shows the current space without navigating when the native registry has one space',async()=>{
 vi.mocked(isTauri).mockReturnValue(true);
 const site=profiles[0];
 vi.mocked(invoke).mockResolvedValue({spaces:[{id:site.spaceId,siteId:site.id,name:site.name,domain:site.domain,origin:site.origin}]});
 await render();
 expect(trigger().getAttribute('aria-haspopup')).toBe('menu');expect(trigger().getAttribute('aria-expanded')).toBe('false');
 await act(async()=>trigger().click());expect(choices()).toHaveLength(1);
 await act(async()=>choices()[0].click());expect(choices()).toHaveLength(0);
 expect(invoke).toHaveBeenCalledExactlyOnceWith('space_context');
});
it('supports keyboard navigation and dismisses without changing spaces',async()=>{
 await render();trigger().focus();
 await act(async()=>trigger().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
 expect(document.activeElement).toBe(choices()[0]);
 await act(async()=>choices()[0].dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})));
 expect(document.activeElement).toBe(choices()[profiles.length-1]);
 await act(async()=>new Promise(resolve=>setTimeout(resolve,0)));
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
 expect(choices()).toHaveLength(0);expect(document.activeElement).toBe(trigger());expect(hasBlockingOverlay()).toBe(false);
 expect(invoke).not.toHaveBeenCalled();
});

it('refreshes registered spaces after a successful authorization import',async()=>{
 vi.mocked(isTauri).mockReturnValue(true);
 const entries=profiles.map(s=>({id:s.spaceId,siteId:s.id,name:s.name,domain:s.domain,origin:s.origin}));
 vi.mocked(invoke).mockResolvedValueOnce({spaces:entries.slice(0,1)}).mockResolvedValueOnce({spaces:entries.slice(0,2)});
 await render();await act(async()=>trigger().click());expect(choices()).toHaveLength(1);
 await act(async()=>window.dispatchEvent(new Event('scholay-spaces-changed')));
 expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
 expect(choices()).toHaveLength(2);
});
