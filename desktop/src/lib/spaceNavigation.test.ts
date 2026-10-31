// @vitest-environment jsdom
import {act,createElement} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

const app=vi.hoisted(()=>({
 transition:undefined as undefined|((spaceId:string)=>Promise<void>),
 invoke:vi.fn(),
 setActiveSite:vi.fn(),
 root:undefined as undefined|{unmount:()=>void},
}));
vi.mock('react-dom/client',async importOriginal=>{
 const original=await importOriginal<typeof import('react-dom/client')>();
 return {...original,default:{...original.default,createRoot:(...args:Parameters<typeof original.createRoot>)=>{
  const root=original.createRoot(...args);app.root=root;return root;
 }}};
});
vi.mock('./nativeCore',()=>({isTauri:()=>true,invoke:app.invoke,nativeTransport:{}}));
vi.mock('./spaceTransition',()=>({
 configureSpaceTransition:(handler:typeof app.transition)=>{app.transition=handler;},
 trackNativeWork:()=>({setEpoch:vi.fn(),pause:vi.fn(),resume:vi.fn(),drain:vi.fn()}),
 waitForSpacePreparation:async(work:()=>Promise<void>)=>work(),
}));
vi.mock('../i18n',()=>({setLanguage:vi.fn(),detectLanguage:()=> 'zh'}));
vi.mock('../../../scripts/site-profile.mjs',()=>({setActiveSite:app.setActiveSite}));
vi.mock('../components/ErrorBoundary',()=>({ErrorBoundary:({children}:{children:unknown})=>children}));
vi.mock('../WorkspaceApp',()=>({default:()=>createElement('main',{
 'data-workspace':localStorage.getItem('papr.workspace.v2'),
 'data-section':localStorage.getItem('scholay.rss.library.v1'),
 'data-reader-tabs':localStorage.getItem('reader.tabs'),
})}));
vi.mock('../store',()=>({resetSpaceUi:vi.fn()}));
vi.mock('../App',()=>({resetStartupView:vi.fn()}));
vi.mock('./readerTabs',()=>({flushReaderTabs:vi.fn(),restoreSpaceReaderTabs:vi.fn()}));
vi.mock('./readingGroups',()=>({flushReadingGroups:vi.fn(),restoreSpaceReadingGroups:vi.fn()}));
vi.mock('./readerPageSession',()=>({clearSpacePageSessions:vi.fn()}));
vi.mock('./pageViewQueue',()=>({enqueuePageView:async(work:()=>void)=>work()}));
vi.mock('./formatJobs',()=>({useFormatJobs:{setState:vi.fn()}}));
vi.mock('../toast',()=>({useToasts:{getState:()=>({dismiss:vi.fn()})},toast:{error:vi.fn()}}));

beforeEach(()=>{
 vi.resetModules();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 localStorage.clear();document.body.innerHTML='<div id="root"></div>';
 app.transition=undefined;app.root=undefined;app.setActiveSite.mockReset();app.invoke.mockReset();
 app.invoke.mockImplementation(async(command:string,args?:{spaceId:string})=>{
  if(command==='space_context')return {site:{id:'academic'},spaceId:'academic',runtimeEpoch:1};
  if(command==='space_select')return {site:{id:args!.spaceId},spaceId:args!.spaceId,runtimeEpoch:2};
 });
});
afterEach(async()=>{await act(()=>app.root?.unmount());vi.unstubAllGlobals();});

async function boot(workspace:string,section='articles'){
 localStorage.setItem('papr.workspace.v2',workspace);
 localStorage.setItem('scholay.rss.library.v1',section);
 localStorage.setItem('reader.tabs','academic-tabs');
 await act(async()=>{
  await import('../main');
  await vi.waitFor(()=>expect(document.querySelector('main')).not.toBeNull());
 });
}

it.each([
 ['editorial','articles'],['library','articles'],['gallery','articles'],
 ['rss','articles'],['discover','hot'],['discover','labels'],['discover','calendar'],['discover','history'],['connections','articles'],
])('stays in %s / %s when switching to a new space',async(workspace,section)=>{
 await boot(workspace,section);
 await act(()=>app.transition!('pets'));
 expect(document.querySelector('main')?.dataset.workspace).toBe(workspace);
 expect(document.querySelector('main')?.dataset.section).toBe(section);
 expect(document.querySelector('main')?.dataset.readerTabs).toBeUndefined();
 expect(localStorage.getItem('scholay.space-storage.active')).toBe('pets');
});

it('keeps the current feature over the destination history and restores only that space’s tabs',async()=>{
 localStorage.setItem('scholay.space-storage.pets',JSON.stringify({
  'papr.workspace.v2':'rss','scholay.rss.library.v1':'hot','reader.tabs':'pet-tabs',
 }));
 await boot('library','history');
 await act(()=>app.transition!('pets'));
 expect(document.querySelector('main')?.dataset.workspace).toBe('library');
 expect(document.querySelector('main')?.dataset.section).toBe('history');
 expect(document.querySelector('main')?.dataset.readerTabs).toBe('pet-tabs');
 await act(()=>app.transition!('academic'));
 expect(document.querySelector('main')?.dataset.workspace).toBe('library');
 expect(document.querySelector('main')?.dataset.readerTabs).toBe('academic-tabs');
});

it('restores the original space, feature and tabs if native selection fails',async()=>{
 await boot('editorial','calendar');
 app.invoke.mockReset().mockImplementation(async(command:string)=>{
  if(command==='space_select')throw Error('目标资料库不可用');
 });
 await act(async()=>{await expect(app.transition!('pets')).rejects.toThrow('目标资料库不可用');});
 expect(localStorage.getItem('scholay.space-storage.active')).toBe('academic');
 expect(document.querySelector('main')?.dataset.workspace).toBe('editorial');
 expect(document.querySelector('main')?.dataset.section).toBe('calendar');
 expect(document.querySelector('main')?.dataset.readerTabs).toBe('academic-tabs');
});
