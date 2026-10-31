// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({getSetting:vi.fn(),setSetting:vi.fn(),listArticles:vi.fn(),getArticle:vi.fn()}));
vi.mock('../api',()=>api);
import TopicCards from '../editorial/TopicCards';
const row=(id:number)=>({id,title:'星标'+id,feedTitle:'来源',url:'https://example.org/'+id,publishedAt:'2026-10-01T00:00:00Z',snippet:'摘要'});
const item=(id:string)=>({id,title:'T'+id,summary:'s',url:'https://e.org/'+id,date:'2026-10-01',acquiredVia:'rss',rssId:id,selected:true,locked:true});
const column=(id:string,ids:string[],extra:object={})=>({id,title:'栏'+id,slotCount:ids.length,slots:ids.map(x=>({id:x,mode:'manual'})),items:ids.map(item),...extra});
function ev(type:string,x=0){const e=new Event(type,{bubbles:true,cancelable:true}) as any;e.clientX=x;e.relatedTarget=null;Object.defineProperty(e,'dataTransfer',{value:{effectAllowed:'',dropEffect:'',setData:vi.fn(),setDragImage:vi.fn()}});return e as Event;}
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});
async function setup(sections:any[]){
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);api.getSetting.mockReset().mockResolvedValue(JSON.stringify({version:2,templates:[],memory:{days:7,notes:''}}));api.setSetting.mockReset().mockResolvedValue(undefined);api.listArticles.mockReset().mockResolvedValue([row(7),row(8)]);api.getArticle.mockReset().mockRejectedValue(new Error('offline'));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let board:any={titles:[],sections};
 const render=()=>root.render(createElement(TopicCards,{busy:false,loading:false,sectionCount:sections.length,onChange:(n:any)=>{board=n;render();},onOpenUrl:vi.fn(),board}));
 await act(async()=>render());await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 const cards=()=>[...host.querySelectorAll<HTMLElement>('.topic-card')];for(const c of cards())c.getBoundingClientRect=()=>({left:0,width:100,right:100,top:0,bottom:100,height:100,x:0,y:0,toJSON(){}}) as DOMRect;
 const shelf=(i=0)=>host.querySelectorAll<HTMLElement>('.topic-shelf-card')[i];
 const ids=()=>board.sections.map((s:any)=>s.slots.map((x:any)=>x.id).join(','));
 return {host,root,cards,shelf,ids,board:()=>board};
}
describe('adding a card creates its slot',()=>{
 it('has no add button: an empty column shows a drop target, and a source picked by click lands on the row it is confirmed on',async()=>{
  const h=await setup([column('a',[],{title:'基金与资助'})]);
  const row=()=>h.host.querySelector<HTMLElement>('.topic-card-items')!;
  expect(h.host.querySelector('.topic-add-card')).toBeNull();expect(row().querySelector('.topic-row-empty')?.textContent).toBe('拖入素材或模板');expect(row().dataset.accepting).toBeUndefined();
  await act(async()=>row().click());expect(h.board().sections[0].slots).toHaveLength(0);
  await act(async()=>h.shelf().querySelector<HTMLButtonElement>('.topic-source-select')!.click());await act(async()=>{await new Promise(r=>setTimeout(r,20));});
  expect(row().dataset.accepting).toBe('true');await act(async()=>row().querySelector<HTMLElement>('.topic-row-empty')!.click());
  expect(h.board().sections[0].slots).toHaveLength(1);expect(h.board().sections[0].slots[0].mode).toBe('manual');expect(row().querySelector('.topic-row-empty')).toBeNull();await act(async()=>h.root.unmount());
 });
 it('clicking a row adds the selected shelf item as a card, and stops at five cards',async()=>{
  const h=await setup([column('a',['m1','m2','m3','m4'])]);
  await act(async()=>h.shelf().querySelector<HTMLButtonElement>('.topic-source-select')!.click());await act(async()=>{await new Promise(r=>setTimeout(r,20));});
  const row=h.host.querySelector<HTMLElement>('.topic-card-items')!;expect(row.dataset.accepting).toBe('true');await act(async()=>row.click());
  const slots=h.board().sections[0].slots;expect(slots).toHaveLength(5);expect(slots[4].mode).toBe('manual');expect(h.board().sections[0].items.find((i:any)=>i.id===slots[4].id)).toMatchObject({rssId:'7',title:'星标7'});
  await act(async()=>h.shelf(1).querySelector<HTMLButtonElement>('.topic-source-select')!.click());await act(async()=>{await new Promise(r=>setTimeout(r,20));});
  expect(row.dataset.accepting).toBeUndefined();await act(async()=>row.click());expect(h.board().sections[0].slots).toHaveLength(5);await act(async()=>h.root.unmount());
 });
 it('a new column starts with one AI card, not an empty slot',async()=>{
  const h=await setup([column('a',['m1'])]);await act(async()=>[...h.host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='＋ 新增分栏')!.click());
  const created=h.board().sections[1];expect(created.title).toBe('分栏 2');expect(created.slots).toHaveLength(1);expect(created.slots[0]).toMatchObject({mode:'smart',templateName:'分栏 2'});expect(created.items).toEqual([]);await act(async()=>h.root.unmount());
 });
 it('a leftover empty slot is filled first so no ghost is left behind',async()=>{
  const h=await setup([{id:'a',title:'旧栏',slotCount:2,slots:[{id:'m1',mode:'manual'},{id:'old'}],items:[item('m1')]}]);
  await act(async()=>h.shelf().querySelector<HTMLButtonElement>('.topic-source-select')!.click());await act(async()=>{await new Promise(r=>setTimeout(r,20));});
  await act(async()=>h.host.querySelector<HTMLElement>('.topic-card-items')!.click());
  expect(h.ids()).toEqual(['m1,old']);expect(h.board().sections[0].items.map((i:any)=>i.id)).toEqual(['m1','old']);await act(async()=>h.root.unmount());
 });
});
describe('dragging a shelf item onto a column',()=>{
 async function dragShelf(h:any){await act(async()=>void h.shelf().dispatchEvent(ev('dragstart')));}
 it('inserts a new card before or after the card under the pointer, with a marker',async()=>{
  const h=await setup([column('a',['m1','m2'])]);await dragShelf(h);
  const e=ev('dragover',80);await act(async()=>void h.cards()[0].dispatchEvent(e));expect(e.defaultPrevented).toBe(true);expect(h.cards()[0].className).toContain('is-drop-after');
  await act(async()=>void h.cards()[0].dispatchEvent(ev('drop',80)));
  const slots=h.board().sections[0].slots.map((s:any)=>s.id);expect(slots).toHaveLength(3);expect(slots[0]).toBe('m1');expect(slots[2]).toBe('m2');expect(h.board().sections[0].items.find((i:any)=>i.id===slots[1])).toMatchObject({rssId:'7'});
  expect(h.host.querySelector('.is-drop-before,.is-drop-after')).toBeNull();await act(async()=>h.root.unmount());
 });
 it('blank row space appends, and the left half of a card inserts before it',async()=>{
  const h=await setup([column('a',['m1','m2'])]);await dragShelf(h);
  const over=ev('dragover');await act(async()=>void h.host.querySelector('.topic-card-items')!.dispatchEvent(over));expect(over.defaultPrevented).toBe(true);
  await act(async()=>void h.host.querySelector('.topic-card-items')!.dispatchEvent(ev('drop')));
  let slots=h.board().sections[0].slots.map((s:any)=>s.id);expect(slots).toHaveLength(3);expect(slots.slice(0,2)).toEqual(['m1','m2']);
  await act(async()=>void h.shelf(1).dispatchEvent(ev('dragstart')));await act(async()=>void h.cards()[0].dispatchEvent(ev('dragover',10)));await act(async()=>void h.cards()[0].dispatchEvent(ev('drop',10)));
  slots=h.board().sections[0].slots.map((s:any)=>s.id);expect(slots).toHaveLength(4);expect(slots[1]).toBe('m1');expect(h.board().sections[0].items.find((i:any)=>i.id===slots[0])).toMatchObject({rssId:'8'});await act(async()=>h.root.unmount());
 });
 it('refuses drops into a full column',async()=>{
  const h=await setup([column('a',['m1','m2','m3','m4','m5'])]);await dragShelf(h);
  const e=ev('dragover',10);await act(async()=>void h.cards()[0].dispatchEvent(e));expect(e.defaultPrevented).toBe(false);await act(async()=>void h.cards()[0].dispatchEvent(ev('drop',10)));expect(h.board().sections[0].slots).toHaveLength(5);await act(async()=>h.root.unmount());
 });
});
