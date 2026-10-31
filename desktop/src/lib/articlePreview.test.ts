// @vitest-environment jsdom
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const {call}=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('../editorial/taskWorkbench',async importOriginal=>({...await importOriginal<any>(),taskCall:call}));
vi.mock('../editorial/CursorAgentPane',()=>({default:()=>null}));
vi.mock('../editorial/WorkDetail',()=>({default:()=>createElement('section',{'data-draft-editor':true})}));
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async(command:string,args?:any)=>command==='editorial_call'&&args?.method==='draft_preview'?{html:'<h1>已保存标题</h1><p>已保存正文</p>'}:command==='list_articles'?[]:null)}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async()=>()=>{})}));
import {invoke} from '@tauri-apps/api/core';
import TaskCanvas from '../editorial/TaskCanvas';
import StructuredWorkflow from '../editorial/StructuredWorkflow';

const item=(id:string,selected:boolean)=>({id,title:'素材 '+id,summary:'摘要 '+id,url:'https://example.org/'+id,publisher:'机构',date:'2026-10-04',selected,excluded:!selected});
const base=()=>({id:'task-1',mode:'xiwen',title:'测试',brief:'',days:7,articleId:'draft-1',workIds:[],revision:3,assets:[],ui:{tabs:[]},workflow:{authorized:true,sources:'combined'},
 board:{titles:[],sections:[{id:'s1',title:'研究前沿',slotCount:3,slots:[{id:'a',mode:'manual'},{id:'b',mode:'manual'},{id:'w',mode:'smart',prompt:'方向'}],items:[item('a',true),item('b',false)]},{id:'s2',title:'学界动态',slotCount:1,slots:[{id:'c',mode:'manual'}],items:[item('c',true)]}]},
 outline:{blocks:[]}}) as any;
let host:HTMLDivElement,preview:HTMLDivElement,root:ReturnType<typeof createRoot>,saved:any[];
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();saved=[];call.mockReset();vi.mocked(invoke).mockClear();host=document.createElement('div');preview=document.createElement('div');document.body.append(host,preview);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();preview.remove();});
function Canvas({initial,kind}:{initial:any;kind:'board'|'outline'}){
 const [task,setTask]=useState(initial);
 return createElement(TaskCanvas,{task,kind,busy:false,previewHost:preview,onSave:async(p:any,revision?:number)=>{saved.push(p);setTask((t:any)=>({...t,...p,revision:(revision??t.revision)+1}));},onConfirm:async()=>{},onPrompt:()=>{},onOpenUrl:()=>{},onRefresh:()=>{}});
}
const elements=()=>[...preview.querySelectorAll<HTMLElement>('.preview-element[data-preview-id]')].map(e=>e.dataset.previewId);

it('previews the chosen materials as an article and keeps places for what is still being searched',async()=>{
 await act(async()=>root.render(createElement(Canvas,{initial:base(),kind:'board'})));
 expect(elements()).toEqual(['a','c']);
 expect([...preview.querySelectorAll('h2')].map(h=>h.textContent)).toEqual(['研究前沿','学界动态']);
 expect(preview.querySelector('h1.preview-pending')).not.toBeNull();expect(preview.textContent).toContain('摘要 a');expect(preview.textContent).not.toContain('素材 b');
 expect(preview.querySelectorAll('.preview-element.is-placeholder')).toHaveLength(1);
});

it('removing a material in the preview unselects its card on the station and saves the board',async()=>{
 await act(async()=>root.render(createElement(Canvas,{initial:base(),kind:'board'})));
 const picked=()=>host.querySelector<HTMLInputElement>('[aria-label="选用：素材 a"]')!;expect(picked().checked).toBe(true);
 await act(async()=>preview.querySelector<HTMLButtonElement>('[aria-label="从文章中移除：素材 a"]')!.click());
 expect(elements()).toEqual(['c']);expect(picked().checked).toBe(false);
 const stored=saved.at(-1).board.sections[0].items;expect(stored).toHaveLength(2);expect(stored[0]).toMatchObject({id:'a',selected:false,excluded:true});
 await act(async()=>picked().click());expect(elements()).toEqual(['a','c']);
});

it('keeps outline blocks and their preview in step whichever side deletes one',async()=>{
 const task={...base(),topicConfirmed:'topic',outline:{titleCandidates:['标题甲','标题乙'],selectedTitle:1,blocks:[{id:'sum',type:'summary',text:'导语'},{id:'h',type:'heading',text:'第一节'},{id:'p',type:'paragraph',text:''},{id:'img',type:'image',text:'流程示意'},{id:'ref',type:'references',text:'[1] 来源'}]}};
 await act(async()=>root.render(createElement(Canvas,{initial:task,kind:'outline'})));
 expect(preview.querySelector('h1')?.textContent).toBe('标题乙');expect(elements()).toEqual(['sum','h','p','img','ref']);
 expect(preview.querySelector('[data-preview-id=p]')?.classList.contains('is-placeholder')).toBe(true);expect(preview.querySelector('[data-preview-id=img] figcaption')?.textContent).toBe('流程示意');
 await act(async()=>preview.querySelector<HTMLButtonElement>('[aria-label^="删除小标题"]')!.click());
 expect(elements()).toEqual(['sum','p','img','ref']);expect(host.querySelectorAll('.outline-block')).toHaveLength(4);expect(saved.at(-1).outline.blocks.map((b:any)=>b.id)).toEqual(['sum','p','img','ref']);
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.outline-block header button')].find(b=>b.textContent==='删除')!.click());
 expect(elements()).toEqual(['p','img','ref']);expect(host.querySelectorAll('.outline-block')).toHaveLength(3);
});

it('keeps the preview permanently beside every station, swappable, and shows the saved manuscript once written',async()=>{
 const props=(task:any,work?:any)=>({task,work,run:{},active:true,refreshToken:0,obscured:false,agentBusy:false,onAccept:()=>{},onUi:()=>{},onSave:async()=>{},onDraft:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onRefresh:()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});
 call.mockImplementation(async(method:string)=>method==='task_check'?{draftReady:true,checks:[],images:0,reviewed:false}:null);
 await act(async()=>root.render(createElement(StructuredWorkflow,props(base()))));
 const split=()=>host.querySelector<HTMLElement>('.flow-split')!,pane=()=>host.querySelector<HTMLElement>('.flow-preview')!;
 expect(split().dataset.previewSide).toBe('right');expect(pane().getAttribute('aria-label')).toBe('文章预览');
 expect([...pane().querySelectorAll<HTMLElement>('.preview-element[data-preview-id]')].map(e=>e.dataset.previewId)).toEqual(['a','c']);
 await act(async()=>pane().querySelector<HTMLButtonElement>('[aria-label="交换编排区与预览区的位置"]')!.click());
 expect(split().dataset.previewSide).toBe('left');expect(localStorage.getItem('scholay.workbench.previewSide')).toBe('left');
 await act(async()=>root.render(createElement(StructuredWorkflow,props({...base(),topicConfirmed:'topic'}))));
 expect(pane().querySelector('.preview-empty')?.textContent).toContain('生成大纲后');expect(split().dataset.previewSide).toBe('left');
 const written={...base(),topicConfirmed:'topic',outlineConfirmed:'outline',workIds:['draft-1']};
 await act(async()=>root.render(createElement(StructuredWorkflow,props(written))));
 expect(pane().querySelector('.preview-empty')?.textContent).toContain('生成正文后');
 await act(async()=>root.render(createElement(StructuredWorkflow,props(written,{id:'draft-1',title:'本地稿件',type:'xiwen',category:'学界犀闻',locations:['local'],external:[],local:{id:'draft-1',canonicalPath:'articles/x.md'}}))));
 expect(invoke).toHaveBeenCalledWith('editorial_call',{method:'draft_preview',params:{id:'draft-1',embedImages:true}});
 expect(pane().querySelector('[data-stage=draft] h1')?.textContent).toBe('已保存标题');
});
