// @vitest-environment jsdom
import {act,createElement as h} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import PaneToolbar,{WindowChromeContext} from '../components/PaneToolbar';
let root:Root,container:HTMLElement,strip:HTMLElement;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 container=document.createElement('main');strip=document.createElement('header');document.body.append(strip,container);root=createRoot(container);
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const left=this===strip?0:300,width=this===strip?1200:600;return {left,right:left+width,width,top:0,bottom:44,height:44,x:left,y:0,toJSON(){}};});
});
afterEach(()=>{act(()=>root.unmount());container.remove();strip.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const render=(active:boolean,click:()=>void)=>act(()=>root.render(h(WindowChromeContext.Provider,{value:{host:strip,workspace:'library',collapsed:false,toggle:()=>{}}},h(PaneToolbar,{active,placement:'toggle',children:h('div',{className:'controls'},h('button',{onClick:click},'展开'))}))));
it('moves extension controls to the aligned strip and removes inactive workspace controls',()=>{
 const click=vi.fn();render(true,click);
 expect(container.querySelector('button')).toBeNull();
 expect(strip.querySelector<HTMLElement>('.window-pane-toolbar')?.style.left).toBe('300px');
 act(()=>strip.querySelector('button')!.click());expect(click).toHaveBeenCalledOnce();
 render(false,click);expect(strip.querySelector('button')).toBeNull();
 render(true,click);expect(strip.querySelectorAll('button')).toHaveLength(1);
});
it('keeps business controls inside the source column even when a window strip is present',()=>{
 act(()=>root.render(h(WindowChromeContext.Provider,{value:{host:strip,workspace:'rss',collapsed:false,toggle:()=>{}}},h(PaneToolbar,{children:h('div',{},h('button',{},'多选'))}))));
 expect(container.querySelector('button')?.textContent).toBe('多选');expect(strip.querySelector('button')).toBeNull();
});
it('reserves a distinct toggle slot when tabs share a narrow expanded pane',()=>{
 act(()=>root.render(h(WindowChromeContext.Provider,{value:{host:strip,workspace:'editorial',collapsed:false,toggle:()=>{}}},h(PaneToolbar,{placement:'tabs',endInset:36,children:h('div',{},h('button',{},'页面'))}))));
 expect(strip.querySelector<HTMLElement>('.window-pane-toolbar')?.style.width).toBe('564px');
 expect(strip.querySelector('.window-pane-toolbar')?.getAttribute('data-placement')).toBe('tabs');
});
it('retains standalone page controls when no shared frame exists',()=>{
 act(()=>root.render(h(PaneToolbar,{children:h('div',{},h('button',{},'刷新'))})));
 expect(container.querySelector('button')?.textContent).toBe('刷新');expect(strip.children).toHaveLength(0);
});
