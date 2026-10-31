// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {trackNativeWork,configureSpaceTransition,selectCreativeSpace,waitForSpacePreparation,spaceSwitchBlockReason} from './spaceTransition';
import {ACTIVE_SITE,setActiveSite} from '../../../scripts/site-profile.mjs';
import profiles from '../../../sites/profiles.json';
import {sectionsForSite} from '../../../contracts/site-sections.mjs';
import {CURRENT_DESTINATION,typeOfColumn} from '../../scripts/agent/destinations.mjs';
import {CURRENT_DOMAIN} from '../../scripts/agent/domain-pack.mjs';
import {CATEGORIES,GROUPS} from '../editorial/contentLibrary';
import {KIND_LABELS} from '../publications/model';
import {activateSpaceStorage} from './spaceStorage';
import {useReaderTabs,flushReaderTabs,restoreSpaceReaderTabs} from './readerTabs';

afterEach(()=>{flushReaderTabs();setActiveSite(profiles[0]);localStorage.clear();});

it('keeps background authoring independent of space selection while retaining editor write guards',()=>{
 expect(spaceSwitchBlockReason([],[{busy:true},{queued:true}])).toBe('');
 expect(spaceSwitchBlockReason([{dirty:true}],[{busy:true}])).toContain('保存');
 expect(spaceSwitchBlockReason([{dirty:false,busy:true}],[])).toContain('完成或取消');
});
it('global accepted-job transport recovery does not hold a workspace switch open',async()=>{
 let finish!:(value:object)=>void;const transport={invoke:vi.fn(()=>new Promise<object>(resolve=>{finish=resolve;}))};
 const tracker=trackNativeWork(transport),recovering=transport.invoke('website_publish_call',{method:'queue_resume_pending',params:{}});
 tracker.pause();await tracker.drain();
 expect((transport.invoke as any)).toBeDefined();finish({resumed:1});await recovering;
});

it('global authoring queue reads can finish after a switch without blocking space-owned writes',async()=>{
 let finish!:(value:object)=>void;
 const native=vi.fn(()=>new Promise<object>(resolve=>{finish=resolve;})),transport={invoke:native};
 const tracker=trackNativeWork(transport);
 const reading=transport.invoke('cursor_agent_call',{method:'queue_status',params:{}});
 tracker.pause();await tracker.drain();
 expect(native.mock.calls[0][2].headers.has('x-today-space-epoch')).toBe(false);
 await expect(transport.invoke('cursor_agent_call',{method:'task_update',params:{}})).rejects.toThrow('正在切换');
 tracker.setEpoch(2);tracker.resume();finish({jobs:[]});await reading;
});

it('drains an old native write, rejects new work during switching, and stamps requests with their space generation',async()=>{
 let finish!:(value:string)=>void;
 const transport={invoke:vi.fn().mockImplementation(()=>new Promise<string>(resolve=>{finish=resolve;}))};
 const native=transport.invoke;
 const tracker=trackNativeWork(transport);
 const writing=transport.invoke('mark_starred',{id:1});
 tracker.pause();
 let drained=false;const drain=tracker.drain().then(()=>{drained=true;});
 await expect(transport.invoke('mark_read',{id:1})).rejects.toThrow('正在切换');
 expect(drained).toBe(false);expect(native).toHaveBeenCalledTimes(1);
 finish('saved');await writing;await drain;expect(drained).toBe(true);
 tracker.setEpoch(4);tracker.resume();
 native.mockResolvedValueOnce('new');await transport.invoke('get_article',{id:1});
 expect((native.mock.calls[0][2].headers as Headers).get('x-today-space-epoch')).toBe('0');
 expect((native.mock.calls[1][2].headers as Headers).get('x-today-space-epoch')).toBe('4');
});

it('coalesces repeated clicks instead of racing two native selections',async()=>{
 let finish!:()=>void;const switcher=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 configureSpaceTransition(switcher);
 const first=selectCreativeSpace('pets'),second=selectCreativeSpace('lingxi');
 expect(first).toBe(second);expect(switcher).toHaveBeenCalledTimes(1);
 finish();await first;
});

it('drains an asynchronous registry read before allowing a native selection',async()=>{
 let finish!:(value:object)=>void;
 const transport={invoke:vi.fn(()=>new Promise<object>(resolve=>{finish=resolve;}))};
 const tracker=trackNativeWork(transport);
 const reading=transport.invoke('space_context');
 tracker.pause();
 let drained=false;const drain=tracker.drain().then(()=>{drained=true;});
 await expect(transport.invoke('space_context')).rejects.toThrow('正在切换');
 expect(drained).toBe(false);
 finish({spaces:[]});await reading;await drain;
 expect(drained).toBe(true);
});

it('times out a stuck page queue before selection and never commits when that queue later resolves',async()=>{
 vi.useFakeTimers();
 try{
  let finish!:()=>void;
  const stuck=new Promise<void>(resolve=>{finish=resolve;});
  const select=vi.fn();
  const transition=waitForSpacePreparation(()=>stuck,'旧空间尚未结束').then(select);
  const failed=expect(transition).rejects.toThrow('旧空间尚未结束');
  await vi.advanceTimersByTimeAsync(15_000);await failed;
  finish();await Promise.resolve();
  expect(select).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});

it('clears preparation timers on success and failure so repeated switches do not leave pending callbacks',async()=>{
 vi.useFakeTimers();
 try{
  for(let i=0;i<20;i++)await expect(waitForSpacePreparation(async()=>i,'timeout')).resolves.toBe(i);
  await expect(waitForSpacePreparation(async()=>{throw Error('save conflict');},'timeout')).rejects.toThrow('save conflict');
  expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});

it('updates domain, public sections and legacy labels across all spaces without reimporting modules',()=>{
 for(const site of [...profiles,profiles[0]]){
  setActiveSite(site);
  expect(ACTIVE_SITE.id).toBe(site.id);
  expect(CURRENT_DESTINATION.id).toBe(site.id);
  expect(CURRENT_DOMAIN.id).toBe(site.legacy?'academic':site.spaceId);
  const sections=sectionsForSite(site);
  expect(CATEGORIES).toEqual(sections.map(s=>s.name));
  expect(GROUPS[1].sections[0].tags).toEqual(sections.map(s=>[s.name,s.name]));
  expect(KIND_LABELS.history).toBe(site.columns[4]);
  expect(typeOfColumn(site.columns[0])).toBe('xiwen');
 }
});

it('restores separate reader sessions even when two databases both contain article ID 1',()=>{
 activateSpaceStorage(localStorage,'academic');
 useReaderTabs.setState({tabs:[],activeId:null,recent:[],closed:[],captureTabId:null});
 useReaderTabs.getState().open(1,false,{title:'Academic article'});flushReaderTabs();
 activateSpaceStorage(localStorage,'pets');restoreSpaceReaderTabs();
 expect(useReaderTabs.getState().tabs).toHaveLength(0);
 useReaderTabs.getState().open(1,false,{title:'Pet article'});flushReaderTabs();
 activateSpaceStorage(localStorage,'academic');restoreSpaceReaderTabs();
 expect(useReaderTabs.getState().tabs.map(t=>t.title)).toEqual(['Academic article']);
 expect(useReaderTabs.getState().tabs[0].restored).toBe(true);
 flushReaderTabs();activateSpaceStorage(localStorage,'pets');restoreSpaceReaderTabs();
 expect(useReaderTabs.getState().tabs.map(t=>t.title)).toEqual(['Pet article']);
});

it('seeds skill templates from the new workspace domain after switching',async()=>{
 const {defaultTemplates,selectedTemplateMode}=await import('../editorial/topicTemplates');
 for(const site of profiles){
  setActiveSite(site);
  for(const mode of ['documentation','design','essay','encyclopedia'] as const){
   expect(defaultTemplates(mode)[0].prompt).toContain(site.domain);
   expect(selectedTemplateMode([mode],'observation')).toBe(mode);
  }
 }
 expect(selectedTemplateMode([],'observation')).toBeUndefined();
});
