// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import TopicCards from '../editorial/TopicCards';
it('selects and locks cards, deletes with a dismissal, reorders by keyboard and adds empty slots by section',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const item=(id:string)=>({id,title:id,summary:'summary',url:'https://example.org/'+id,date:'2026-10-04',selected:false});let board:any={titles:[],sections:[{id:'s',title:'方法',items:[item('one'),item('two')]},{id:'other',title:'应用',items:[item('three')]}]};
 const render=()=>root.render(createElement(TopicCards,{board,busy:false,loading:false,sectionCount:1,onChange:next=>{board=next;render();},onOpenUrl:vi.fn()}));await act(render);
 await act(async()=>(host.querySelector('[aria-label="选用：one"]') as HTMLInputElement).click());expect(board.sections[0].items[0]).toMatchObject({selected:true,locked:true,excluded:false});
 await act(async()=>host.querySelector('[aria-label="拖动排序：one"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));expect(board.sections[0].items.map((i:any)=>i.id)).toEqual(['two','one']);
 await act(async()=>(host.querySelector('[aria-label="删除素材：one"]') as HTMLButtonElement).click());expect(board.dismissed).toContain('https://example.org/one');expect(host.querySelector('[aria-label="选用：one"]')).toBeNull();
 const start=new Event('dragstart',{bubbles:true});Object.defineProperty(start,'dataTransfer',{value:{effectAllowed:'',setData:vi.fn()}});
 await act(async()=>host.querySelector('[aria-label="拖动排序：two"]')!.dispatchEvent(start));
 await act(async()=>host.querySelectorAll('.topic-card-grid')[1].dispatchEvent(new Event('drop',{bubbles:true,cancelable:true})));
 expect(board.sections[0].items).toHaveLength(0);expect(board.sections[1].items.map((i:any)=>i.id)).toEqual(['three','two']);
 expect(host.querySelector('[aria-label^="新增卡片"]')).toBeNull();expect(host.querySelector('.topic-section .topic-row-empty')?.textContent).toBe('拖入素材或模板');expect(host.textContent).not.toContain('继续找');
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});
it('fills only returned section slots while the rest retain one empty slot',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);const props={busy:true,loading:true,sectionCount:3,onChange:vi.fn(),onOpenUrl:vi.fn()};
 await act(async()=>root.render(createElement(TopicCards,{...props,board:{titles:[],sections:[]}})));expect(host.querySelectorAll('.topic-placeholder')).toHaveLength(3);expect(host.querySelector('.topic-placeholder :not(.topic-ghost)>i')).toBeNull();expect(host.querySelector('.topic-placeholder .topic-ghost')!.getAttribute('aria-hidden')).toBe('true');expect(host.textContent).not.toContain('从真实信息中找到选题');
 await act(async()=>root.render(createElement(TopicCards,{...props,board:{titles:[],sections:[{id:'s',title:'已返回分栏',items:[{id:'a',title:'已核实素材',summary:'摘要',url:'https://example.org',date:'2026-10-04'}]}]}})));expect(host.querySelectorAll('.topic-placeholder')).toHaveLength(2);expect(host.querySelectorAll('.topic-card:not(.topic-placeholder)')).toHaveLength(1);expect(host.textContent).toContain('已核实素材');
 const items=Array.from({length:5},(_,i)=>({id:'card-'+i,title:'完整长标题'+i,summary:'完整摘要'.repeat(100),url:'https://example.org/'+i,date:'2026-10-04'}));
 for(const count of [3,5]){
  await act(async()=>root.render(createElement(TopicCards,{...props,sectionCount:1,board:{titles:[],sections:[{id:'s',title:'材料',items:items.slice(0,count)}]}})));
  expect(host.querySelectorAll('.topic-placeholder')).toHaveLength(0);
  expect(host.querySelectorAll('.topic-card-items>.topic-card')).toHaveLength(count);
  expect(host.querySelector('h4')?.getAttribute('title')).toBe(items[0].title);
  expect(host.querySelector('.topic-card p')?.getAttribute('title')).toBe(items[0].summary);
 }
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});
it('persists section and slot edits, enforces five by five, and keeps deletions empty',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);let board:any={titles:[],sections:[]};
 const render=()=>root.render(createElement(TopicCards,{board,busy:false,loading:false,sectionCount:3,onChange:next=>{board=next;render();},onOpenUrl:vi.fn()}));await act(render);
 expect(host.querySelectorAll('.topic-placeholder')).toHaveLength(3);
 // Cards are added by dragging from the shelf; a column offers no add button. Its leftover empty slot can be turned into an AI card or removed.
 expect(host.querySelector('[aria-label^="新增卡片"]')).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="AI 检索：分栏 1 1"]')!.click());expect(board.sections[0].slots[0].mode).toBe('smart');expect(board.sections[0].slotCount).toBe(1);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="删除空卡片：分栏 2 1"]')!.click());expect(board.sections[1].slotCount).toBe(0);expect(host.querySelectorAll('.topic-row-empty')).toHaveLength(1);
 for(let i=0;i<2;i++)await act(async()=>host.querySelector<HTMLButtonElement>('.topic-add-section')!.click());
 expect(board.sections).toHaveLength(5);expect(host.querySelector<HTMLButtonElement>('.topic-add-section')!.disabled).toBe(true);
 expect(board.sections[4]).toMatchObject({items:[],slotCount:1});
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="编辑分栏名：分栏 1"]')!.click());expect(host.querySelector('input[aria-label="分栏名称"]')).not.toBeNull();
 await act(async()=>host.querySelector('input[aria-label="分栏名称"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 for(let i=0;i<5;i++)await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label^="删除分栏："]')!.click());
 expect(board.sections).toHaveLength(0);expect(board.targetSections).toBe(0);expect(host.querySelectorAll('.topic-section')).toHaveLength(0);
 await act(async()=>host.querySelector<HTMLButtonElement>('.topic-add-section')!.click());expect(board.sections).toHaveLength(1);expect(host.querySelectorAll('.topic-placeholder')).toHaveLength(1);
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});

it('a single-material topic keeps one choice: choosing another card releases the first, and columns are not managed',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const item=(id:string,selected:boolean)=>({id,title:id,summary:'摘要',url:'https://example.org/'+id,publisher:'机构',date:'2026-10-04',selected,excluded:!selected});
 let board:any={titles:[],sections:[{id:'s',title:'事件报道',slotCount:3,slots:[{id:'one',mode:'manual'},{id:'two',mode:'smart',prompt:'方向'},{id:'three',mode:'manual'}],items:[item('one',true),item('two',false),item('three',false)]}]};
 const render=()=>root.render(createElement(TopicCards,{single:true,mode:'observation',board,busy:false,loading:false,sectionCount:1,onChange:next=>{board=next;render();},onOpenUrl:vi.fn()}));await act(render);
 expect(host.querySelector('.topic-add-section')).toBeNull();expect(host.querySelector('.topic-section>header')?.hasAttribute('hidden')).toBe(true);
 const chosen=()=>board.sections[0].items.filter((i:any)=>i.selected).map((i:any)=>i.id);
 await act(async()=>(host.querySelector('[aria-label="选用：two"]') as HTMLInputElement).click());
 expect(chosen()).toEqual(['two']);expect(board.sections[0].items[0]).toMatchObject({id:'one',selected:false,excluded:true});expect(board.sections[0].items).toHaveLength(3);
 await act(async()=>(host.querySelector('[aria-label="选用：three"]') as HTMLInputElement).click());expect(chosen()).toEqual(['three']);
 await act(async()=>(host.querySelector('[aria-label="选用：three"]') as HTMLInputElement).click());expect(chosen()).toEqual([]);
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});
