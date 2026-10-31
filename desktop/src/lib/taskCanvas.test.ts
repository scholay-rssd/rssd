// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import TaskCanvas from '../editorial/TaskCanvas';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async(command:string)=>command==='list_articles'?[]:null)}));
it('retains an unsaved outline when a different version arrives and saves against its original revision',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const task:any={id:'task',revision:1,board:{titles:[],sections:[]},outline:{blocks:[{id:'block',type:'paragraph',text:'original'}]},ui:{tabs:[]},assets:[],workIds:[],topicConfirmed:'yes'};
 const save=vi.fn().mockRejectedValue(Error('CONFLICT')),draft=vi.fn();
 const props:any={task,kind:'outline',busy:false,onSave:save,onDraft:draft,onConfirm:vi.fn(),onPrompt:vi.fn(),onOpenUrl:vi.fn(),onRefresh:vi.fn()};
 await act(async()=>root.render(createElement(TaskCanvas,props)));
 const text=host.querySelector('textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(text,'my unsaved edit');text.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(draft).toHaveBeenLastCalledWith('outline',expect.objectContaining({revision:1,value:{blocks:[{id:'block',type:'paragraph',text:'my unsaved edit'}]}}));
 await act(async()=>root.render(createElement(TaskCanvas,{...props,task:{...task,revision:2,outline:{blocks:[{id:'block',type:'paragraph',text:'other writer'}]}}})));
 expect(text.value).toBe('my unsaved edit');expect(host.querySelector('[role=alert]')?.textContent).toContain('新');
 await act(async()=>text.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
 expect(save).toHaveBeenLastCalledWith(expect.any(Object),1);expect(text.value).toBe('my unsaved edit');
 await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();
});

it('keeps source-date explanation but moves title choice out of the topic board',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const board={titles:['one','two'],selectedTitle:'two',sections:[{id:'s',title:'science',items:[{id:'n',title:'news',summary:'summary',url:'https://example.org',date:'2026-10-02',dateBasis:'近期报道回溯',publicationDate:'2025-08-27'}]}]};
 const task:any={id:'legacy',revision:5,board,outline:{blocks:[]},ui:{tabs:[]},assets:[],workIds:[],topicConfirmed:'unchanged'};const onSave=vi.fn();
 await act(async()=>root.render(createElement(TaskCanvas,{task,kind:'board',busy:false,onSave,onConfirm:vi.fn(),onPrompt:vi.fn(),onOpenUrl:vi.fn(),onRefresh:vi.fn()})));
 expect(host.querySelector('input[type=radio]')).toBeNull();expect(host.textContent).toContain('近期报道回溯 · 原研究日期 2025-08-27');expect(onSave).not.toHaveBeenCalled();
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('chooses an outline title, locks its block and confirms the saved revision',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const task:any={id:'task',revision:1,board:{titles:[],sections:[]},outline:{titleCandidates:['one','two'],selectedTitle:0,blocks:[{id:'t',type:'title',text:'one'}]},topicConfirmed:'yes',ui:{tabs:[]},assets:[],workIds:[]};
 const save=vi.fn(async()=>{}),confirm=vi.fn(async()=>{});
 await act(async()=>root.render(createElement(TaskCanvas,{task,kind:'outline',busy:false,onSave:save,onConfirm:confirm,onPrompt:vi.fn(),onOpenUrl:vi.fn(),onRefresh:vi.fn()})));
 await act(async()=>(host.querySelector('[aria-label="选用标题 2"]') as HTMLInputElement).click());
 expect(save).toHaveBeenCalledWith({outline:{titleCandidates:['one','two'],selectedTitle:1,blocks:[{id:'t',type:'title',text:'two',locked:true}]}},1);
 await act(async()=>(host.querySelector('.task-primary') as HTMLButtonElement).click());expect(confirm).toHaveBeenCalledWith('outline',2);
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('blocks confirmation while an AI slot has no material even with manual selections',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const task:any={id:'t',revision:1,mode:'xiwen',board:{titles:[],sections:[{id:'s',title:'新闻',slots:[{id:'manual',mode:'manual'},{id:'ai',mode:'smart',prompt:'研究'}],items:[{id:'manual',title:'手动素材',url:'https://example.org',selected:true}]}]},outline:{blocks:[]},ui:{tabs:[]},assets:[],workIds:[]};
 const confirm=vi.fn(),props:any={task,kind:'board',busy:false,onSave:async()=>{},onConfirm:confirm,onPrompt:()=>{},onOpenUrl:()=>{},onRefresh:()=>{}};
 await act(async()=>root.render(createElement(TaskCanvas,props)));expect(host.querySelector<HTMLButtonElement>('.task-primary')!.disabled).toBe(true);
 await act(async()=>host.querySelector<HTMLButtonElement>('.task-primary')!.click());expect(confirm).not.toHaveBeenCalled();
 const filled={...task,revision:2,board:{...task.board,sections:task.board.sections.map((s:any)=>({...s,items:[...s.items,{id:'ai',title:'AI 素材',url:'https://example.org/ai',selected:false}]}))}};
 await act(async()=>root.render(createElement(TaskCanvas,{...props,task:filled})));expect(host.querySelector<HTMLButtonElement>('.task-primary')!.disabled).toBe(false);
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('routes legacy image regeneration into gallery conversation without running the article agent',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const task:any={id:'t',revision:1,board:{titles:[],sections:[]},outline:{blocks:[]},ui:{tabs:[]},workIds:['draft-one'],assets:[{id:'asset-one',articleId:'draft-one',name:'研究方法示意图',path:'assets/figure.webp'}]};
 const action=vi.fn(),prompt=vi.fn(),compose=vi.fn();window.addEventListener('scholay-gallery-compose',compose);
 await act(async()=>root.render(createElement(TaskCanvas,{task,kind:'images',busy:false,onSave:async()=>{},onConfirm:async()=>{},onPrompt:prompt,onAction:action,onOpenUrl:()=>{},onRefresh:()=>{}})));
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='到图库生成')!.click());
 expect((compose.mock.calls[0][0] as CustomEvent).detail).toEqual({prompt:expect.stringContaining('研究方法示意图'),articleId:'draft-one',slotPath:'assets/figure.webp'});expect(action).not.toHaveBeenCalled();expect(prompt).not.toHaveBeenCalled();expect(host.textContent).toContain('替换图片');
 window.removeEventListener('scholay-gallery-compose',compose);await act(async()=>root.unmount());vi.unstubAllGlobals();
});
