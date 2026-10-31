// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('../api',()=>({getSetting:vi.fn(async()=>JSON.stringify({version:2,templates:[],memory:{days:7,notes:''}})),setSetting:vi.fn(),listArticles:vi.fn(async()=>[]),getArticle:vi.fn()}));
import TopicCards from '../editorial/TopicCards';
const item=(id:string)=>({id,title:'T'+id,summary:'s',url:'https://e.org/'+id,date:'2026-10-01',acquiredVia:'rss',selected:true,locked:true});
const section=(id:string,ids:string[])=>({id,title:'栏'+id,slots:ids.map(x=>({id:x})),items:ids.map(item)});
function ev(type:string,x=0){const e=new Event(type,{bubbles:true,cancelable:true}) as any;e.clientX=x;e.relatedTarget=null;Object.defineProperty(e,'dataTransfer',{value:{effectAllowed:'',dropEffect:'',setData:vi.fn(),setDragImage:vi.fn()}});return e as Event;}
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});
async function setup(sections:any[],extra:object={}){
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 let board:any={titles:[],sections};const render=()=>root.render(createElement(TopicCards,{busy:false,loading:false,sectionCount:sections.length,onChange:(n:any)=>{board=n;render();},onOpenUrl:vi.fn(),board,...extra}));
 await act(async()=>render());
 const order=()=>board.sections.map((s:any)=>s.slots.map((x:any)=>x.id).join('')),cards=()=>[...host.querySelectorAll<HTMLElement>('.topic-card')];
 for(const card of cards())card.getBoundingClientRect=()=>({left:0,width:100,right:100,top:0,bottom:100,height:100,x:0,y:0,toJSON(){}}) as DOMRect;
 const start=(i:number)=>act(async()=>void cards()[i].querySelector('.topic-drag')!.dispatchEvent(ev('dragstart')));
 const over=async(el:Element,x=0)=>{const e=ev('dragover',x);await act(async()=>void el.dispatchEvent(e));return e.defaultPrevented;};
 const drop=async(el:Element,x=0)=>{await act(async()=>void el.dispatchEvent(ev('drop',x)));await act(async()=>void host.querySelector('.topic-drag')?.dispatchEvent(ev('dragend')));};
 return {host,root,order,cards,start,over,drop,board:()=>board};
}
describe('card reordering',()=>{
 it('the side of the card under the pointer decides before or after, with a visible marker',async()=>{
  const h=await setup([section('s',['a','b','c'])]);await h.start(0);
  expect(await h.over(h.cards()[2],80)).toBe(true);expect(h.cards()[2].className).toContain('is-drop-after');expect(h.cards()[0].className).toContain('is-dragging');
  expect(await h.over(h.cards()[2],20)).toBe(true);expect(h.cards()[2].className).toContain('is-drop-before');expect(h.cards()[2].className).not.toContain('is-drop-after');
  await h.drop(h.cards()[2],80);expect(h.order()).toEqual(['bca']);expect(h.host.querySelector('.is-drop-before,.is-drop-after,.is-dragging')).toBeNull();
  await act(async()=>h.root.unmount());
 });
 it('dropping on the left half inserts before the target',async()=>{
  const h=await setup([section('s',['a','b','c'])]);await h.start(2);await h.over(h.cards()[0],20);await h.drop(h.cards()[0],20);expect(h.order()).toEqual(['cab']);await act(async()=>h.root.unmount());
 });
 it('blank row space is an end-of-column drop zone',async()=>{
  const h=await setup([section('s',['a','b','c'])]);await h.start(0);
  const row=h.host.querySelector('.topic-card-items')!;expect(h.host.querySelector('.topic-add-card')).toBeNull();
  expect(await h.over(row)).toBe(true);await h.drop(row);expect(h.order()).toEqual(['bca']);
  await h.start(0);await h.over(row);await h.drop(row);expect(h.order()).toEqual(['cab']);await act(async()=>h.root.unmount());
 });
 it('moves across columns, respects the five-card limit, and cleans up when the drag is cancelled',async()=>{
  const h=await setup([section('s',['a','b']),section('t',['d'])]);await h.start(1);await h.over(h.cards()[2],80);await h.drop(h.cards()[2],80);expect(h.order()).toEqual(['a','db']);
  const full=await setup([section('s',['a']),section('t',['d','e','f','g','h'])]);await full.start(0);await full.over(full.cards()[1],20);await full.drop(full.cards()[1],20);expect(full.order()).toEqual(['a','defgh']);
  await h.start(0);await h.over(h.cards()[1],80);expect(h.host.querySelector('.is-drop-after')).not.toBeNull();await act(async()=>void h.host.querySelector('.topic-drag')!.dispatchEvent(ev('dragend')));expect(h.host.querySelector('.is-drop-after,.is-dragging')).toBeNull();
  await act(async()=>h.root.unmount());await act(async()=>full.root.unmount());
 });
 it('is inert while busy',async()=>{
  const h=await setup([section('s',['a','b'])],{busy:true});const handle=h.cards()[0].querySelector<HTMLButtonElement>('.topic-drag')!;expect(handle.disabled).toBe(true);expect(handle.draggable).toBe(false);await act(async()=>h.root.unmount());
 });
});
