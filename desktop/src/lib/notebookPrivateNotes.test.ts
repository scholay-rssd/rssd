// @vitest-environment jsdom
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import NotebookInternalNotes from '../editorial/NotebookInternalNotes';
import NotebookSourceEditor from '../editorial/NotebookSourceEditor';
import {notebookMarkdown,type InternalNotes} from '../../scripts/agent/notebook.mjs';

it('private rows remain outside exported prose while author edits persist',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 function Harness(){const [notes,setNotes]=useState<InternalNotes>({supplement:'小样本下实际覆盖率可能偏离。',images:'只作氛围参考'});return createElement('div',null,createElement(NotebookInternalNotes,{notes,onChange:setNotes,signatures:[{runId:'actual',agentId:'cursor',agentName:'Cursor',modelId:'default[]',modelName:'Auto',device:'Isaac 的 Mac Studio',startedAt:'2026-10-28T00:00:00Z',action:'organize',status:'completed'}]}),createElement('output',null,notebookMarkdown({version:2,title:'正文',kind:'article',skills:[],sources:[],fields:{},blocks:[{id:'p',type:'paragraph',text:'公开内容',state:'ready',sourceIds:[]}],internalNotes:notes})));}
 await act(async()=>root.render(createElement(Harness)));
 expect(host.querySelector('[data-visibility="private"]')).not.toBeNull();expect(document.querySelector('[role=dialog]')).toBeNull();expect(host.querySelector('textarea')).toBeNull();
 const marker=host.querySelector<HTMLButtonElement>('.notebook-private-trigger')!;
 await act(async()=>marker.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
 expect(document.querySelector('[role=dialog]')!.textContent).toContain('仅作者可见 · 不对外展示');
 expect(document.querySelector('[role=dialog]')!.textContent).toContain('自动选择（具体模型未报告）');
 expect(document.querySelector('.notebook-model-row span')!.textContent).toBe('Cursor · 整理与写作 · 已完成 · Isaac 的 Mac Studio');
 expect(document.querySelector('[role=dialog]')!.textContent).toContain('补充说明');expect(document.querySelector('[role=dialog]')!.textContent).toContain('小样本下实际覆盖率可能偏离。');
 expect(host.querySelector('output')!.textContent).not.toContain('覆盖率');
 await act(async()=>Array.from(document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')).find(b=>b.textContent==='编辑')!.click());
 const textarea=document.querySelector<HTMLTextAreaElement>('[aria-label="写作说明 · 仅内部可见"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'新增内部写作说明');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(textarea.value).toBe('新增内部写作说明');expect(host.querySelector('output')!.textContent).not.toMatch(/氛围|内部写作/);
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(document.querySelector('[role=dialog]')).toBeNull();expect(document.activeElement).toBe(marker);
 await act(async()=>{marker.blur();marker.focus();});expect(document.querySelector('[role=dialog]')).not.toBeNull();
 await act(async()=>document.body.dispatchEvent(new Event('pointerdown',{bubbles:true})));expect(document.querySelector('[role=dialog]')).toBeNull();
 await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();
});
it('fenced code previews without wrappers and preserves exact source when editing',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),change=vi.fn();
 const text='```python\nfor n in range(3):\n    print(n < 2)\n```';
 await act(async()=>root.render(createElement(NotebookSourceEditor,{text,rowId:'code',label:'代码行',disabled:false,onChange:change})));
 expect(host.querySelector('pre code')!.textContent).toBe('for n in range(3):\n    print(n < 2)');expect(host.querySelector('textarea')).toBeNull();
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='编辑源码')!.click());
 expect(host.querySelector('textarea')!.value).toBe(text);expect(host.querySelector('textarea')!.getAttribute('wrap')).toBe('off');expect(change).not.toHaveBeenCalled();
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});
it('keeps an emptied note editable until Done and honors a writing lock',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 function Harness({disabled=false}:{disabled?:boolean}){const [notes,setNotes]=useState<InternalNotes>({writing:'待重写'});return createElement(NotebookInternalNotes,{notes,onChange:setNotes,disabled});}
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());
 await act(async()=>Array.from(document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')).find(b=>b.textContent==='编辑')!.click());
 const field=document.querySelector<HTMLTextAreaElement>('[aria-label="写作说明 · 仅内部可见"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'');field.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(document.querySelector('[role=dialog]')).not.toBeNull();expect(field.value).toBe('');
 await act(async()=>root.render(createElement(Harness,{disabled:true})));expect(field.disabled).toBe(true);
 await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();
});
