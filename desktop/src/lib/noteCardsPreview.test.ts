// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import NoteCardsPreview from '../editorial/NoteCardsPreview';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('../lib/nativeCore',()=>({invoke}));
let host:HTMLDivElement,root:Root;
const result=(id='first')=>({id,sourceHash:'source',width:1080,height:1440,pages:[{heading:id,thumbnail:'data:image/png;base64,AA==',blocks:['b0'],positions:[{id:'b0',left:70,top:136}]}],blocks:[{id:'b0',label:'标题',heading:true,tag:'H1',text:'未保存稿件'}]});
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();localStorage.clear();
 vi.stubGlobal('crypto',{subtle:{digest:async()=>new Uint8Array([1,2,3]).buffer}});
 invoke.mockReset().mockImplementation(async(command,args)=>{
  if(command==='editorial_call')return args.method==='draft_private_notes'?null:{html:'<h1>未保存稿件</h1>'};
  if(command==='note_cards_export')return {directory:'export-folder',count:1};
  if(args.method==='render')return result();
  if(args.method==='page')return {image:'data:image/png;base64,AA=='};
  throw Error('Unexpected command');
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
const button=(label:string)=>[...host.querySelectorAll('button')].find(x=>x.textContent===label)!;
async function render(text='# unsaved'){await act(async()=>root.render(createElement(StrictMode,null,createElement(NoteCardsPreview,{articleId:'one',text}))));await act(async()=>vi.advanceTimersByTimeAsync(600));await act(async()=>vi.advanceTimersByTimeAsync(300));}
it('previews unsaved text, adjusts separate pagination, and exports the rendered version without saving or publishing',async()=>{
 await render();expect(invoke).toHaveBeenCalledWith('editorial_call',{method:'draft_preview',params:{id:'one',markdown:'# unsaved',embedImages:true}});
 await act(async()=>button('调整分页').click());
 const select=host.querySelector<HTMLSelectElement>('[aria-label="分页：标题"]')!;
 await act(async()=>{select.value='flow';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(button('导出图片').disabled).toBe(true);
 await act(async()=>vi.advanceTimersByTimeAsync(300));
 expect(invoke).toHaveBeenCalledWith('note_cards_call',{method:'render',params:{articleId:'one',html:'<h1>未保存稿件</h1>',breaks:{b0:'flow'}}});
 await act(async()=>button('导出图片').click());
 expect(invoke).toHaveBeenCalledWith('note_cards_export',{id:'first',sourceHash:'source',format:'png',platform:'xiaohongshu'});
 expect(invoke.mock.calls.every(([cmd,args])=>cmd==='note_cards_call'||cmd==='note_cards_export'||cmd==='editorial_call'&&['draft_preview','draft_private_notes'].includes(args.method))).toBe(true);
 expect(JSON.parse(localStorage.getItem([...Object.keys(localStorage)].find(key=>key.startsWith('scholay.note-cards'))!)!)).toEqual({b0:'flow'});
});
it('rejects late render results and never exports old content after the source changes',async()=>{
 let complete!:(value:ReturnType<typeof result>)=>void;
 const original=invoke.getMockImplementation()!;let renderCount=0;
 invoke.mockImplementation((command,args)=>{if(args.method==='render'&&++renderCount===1)return new Promise(resolve=>{complete=resolve;});return original(command,args);});
 await render('# first');expect(button('导出图片').disabled).toBe(true);
 await render('# second');
 await act(async()=>complete(result('stale')));
 expect(host.textContent).not.toContain('stale');
 await act(async()=>button('导出图片').click());expect(invoke.mock.calls.find(([cmd])=>cmd==='note_cards_export')?.[1].id).toBe('first');
});
it('missing images block export and do not call the renderer with partial content',async()=>{
 invoke.mockResolvedValue({html:'<h1>部分正文</h1>',warnings:['图片缺失']});await render();
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('图片缺失');expect(button('导出图片').disabled).toBe(true);
 expect(invoke.mock.calls.every(([cmd])=>cmd==='editorial_call')).toBe(true);
});
it('protects formula delimiters in a preview copy without saving the manuscript',async()=>{
 const original=invoke.getMockImplementation()!,source=String.raw`# 公式

\(x_i^2\) 和 \[\frac{a}{b}\]`;
 invoke.mockImplementation((command,args)=>command==='editorial_call'?Promise.resolve({html:'<p>'+args.params.markdown+'</p>'}):original(command,args));
 await render(source);
 const request=invoke.mock.calls.find(([cmd])=>cmd==='editorial_call')![1];expect(request.params.markdown).toContain('NOTECARDSMATHTOKEN');expect(source).toContain(String.raw`\(x_i^2\)`);
 const rendered=invoke.mock.calls.find(([,args])=>args?.method==='render')![1];expect(rendered.params.html).toContain(String.raw`\(x_i^2\)`);expect(rendered.params.html).toContain(String.raw`\[\frac{a}{b}\]`);
 expect(invoke.mock.calls.every(([cmd,args])=>cmd==='note_cards_call'||cmd==='editorial_call'&&['draft_preview','draft_private_notes'].includes(args.method))).toBe(true);
});
it('shows a private overlay without sending notes or model names to the image renderer or exporter',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation((command,args)=>args.method==='draft_private_notes'?Promise.resolve({internalNotes:{writing:'CARD_PRIVATE'},modelSignatures:[],blockNotes:{title:{anchor:{type:'heading',text:'未保存稿件'},notes:{supplement:'ROW_PRIVATE'}}}}):original(command,args));
 await render();
 const marker=host.querySelector<HTMLButtonElement>('[data-preview-note-id="title"] button')!;expect(marker).not.toBeNull();
 await act(async()=>marker.click());expect(document.querySelector('[role=dialog]')?.textContent).toContain('ROW_PRIVATE');
 expect(host.querySelector('.note-cards-paper')?.tagName).toBe('IMG');
 await act(async()=>button('导出图片').click());
 expect(JSON.stringify(invoke.mock.calls.filter(([command])=>command==='note_cards_call'||command==='note_cards_export'))).not.toMatch(/PRIVATE|blockNotes|modelSignatures/);
 expect(invoke.mock.calls.filter(([command])=>command==='note_cards_export')).toHaveLength(1);
});
