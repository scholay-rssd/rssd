// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
const {list}=vi.hoisted(()=>({list:vi.fn(async()=>[])}));
vi.mock('../api',()=>({listArticles:list}));
import TopicSourceShelf from '../editorial/TopicSourceShelf';
it('applies local RSS filters only on request and never opens the RSS reader',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();const host=document.createElement('div'),dock=document.createElement('div');document.body.append(host,dock);const root=createRoot(host),jump=vi.fn();window.addEventListener('scholay-topic-pick-start',jump);
 try{await act(async()=>root.render(createElement(TopicSourceShelf,{toolbarHost:dock,fixedTab:'starred',allRss:true,templatesEnabled:false,rowLayout:true,busy:false,usedUrls:[],chosen:null,onChoose:()=>{},onDrag:()=>{}})));await act(async()=>vi.runOnlyPendingTimers());
 expect(list).toHaveBeenLastCalledWith({kind:'all'},false,null,false,30,0);expect(dock.querySelector('[aria-label="去 RSS 里挑选并加星标"]')).toBeNull();expect(host.querySelector('.topic-shelf-add')).toBeNull();
 const select=dock.querySelector('select')!;await act(async()=>{select.value='starred';select.dispatchEvent(new Event('change',{bubbles:true}));dock.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();});expect(list).toHaveBeenCalledTimes(1);
 await act(async()=>[...dock.querySelectorAll('button')].find(b=>b.textContent==='应用筛选条件')!.click());await act(async()=>vi.runOnlyPendingTimers());expect(list).toHaveBeenLastCalledWith({kind:'starred'},true,null,false,30,0);expect(jump).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());window.removeEventListener('scholay-topic-pick-start',jump);host.remove();dock.remove();vi.useRealTimers();vi.unstubAllGlobals();}
});
