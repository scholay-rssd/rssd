// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const {call,list}=vi.hoisted(()=>({call:vi.fn(),list:vi.fn()}));
vi.mock('../editorial/taskWorkbench',()=>({taskCall:call}));
vi.mock('../api',()=>({listArticles:list,getArticle:vi.fn()}));
import NotebookImagePicker from '../editorial/NotebookImagePicker';
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
afterEach(async()=>{await act(async()=>root?.unmount());host?.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('keeps keyword searches independent from a long generation brief and restores each tab input',async()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 call.mockReset();call.mockResolvedValue({items:[],hasMore:false});list.mockResolvedValue([]);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const requirement='详细的图像构图要求'.repeat(40);
 await act(async()=>root.render(createElement(NotebookImagePicker,{taskId:'t',block:{id:'i',type:'image',state:'placeholder',text:'',requirement,sourceIds:[]},initialMode:'online',busy:false,onPick:async()=>{},onGenerate:async()=>{},onClose:()=>{},onOpenUrl:()=>{}})));
 const input=()=>host.querySelector<HTMLInputElement>('[aria-label="图片检索词"]')!;
 const click=async(label:string)=>act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(x=>x.textContent===label)!.click();});
 expect(input().value).toBe('');await act(async()=>vi.runAllTimersAsync());expect(call).not.toHaveBeenCalled();
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input(),'keyboard');input().dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>vi.runAllTimersAsync());expect(call).toHaveBeenLastCalledWith('notebook_image_search',{taskId:'t',mode:'online',query:'keyboard',page:1});
 await click('即时生成');expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(requirement);
 await click('本地选取');expect(input().value).toBe('');await act(async()=>vi.runAllTimersAsync());expect(call).toHaveBeenLastCalledWith('notebook_image_search',{taskId:'t',mode:'local',query:'',page:1});
 await click('在线搜索');expect(input().value).toBe('keyboard');
});
