// @vitest-environment jsdom
import {beforeEach,expect,it} from 'vitest';
import {libraryNavigationKey,readLibraryNavigation} from '../editorial/libraryNavigation';
import {EMPTY_FILTERS,type Work} from '../editorial/contentLibrary';

beforeEach(()=>localStorage.clear());
it('imports mixed library tabs into their matching lists without changing the original preference',()=>{
 const previous=JSON.stringify({tabs:[{id:'draft',title:'本机稿件',source:'local'},{id:'published',title:'云端作品',source:'cloud'}],selected:'draft'});
 localStorage.setItem('scholay.library.tabs:/space',previous);
 const local=readLibraryNavigation(localStorage,'/space','local',[]),cloud=readLibraryNavigation(localStorage,'/space','cloud',[]);
 expect(local.tabs.map(t=>t.id)).toEqual(['draft']);expect(local.selected).toBe('draft');
 expect(cloud.tabs.map(t=>t.id)).toEqual(['published']);expect(cloud.selected).toBe('published');
 expect(localStorage.getItem('scholay.library.tabs:/space')).toBe(previous);
});
it('restores selection, search and scroll independently by space and list',()=>{
 localStorage.setItem(libraryNavigationKey('/space','local'),JSON.stringify({tabs:[{id:'draft',title:'稿件'}],selected:'draft',filters:{...EMPTY_FILTERS,query:'检索',location:['cloud']},scrollTop:340,limit:120}));
 const restored=readLibraryNavigation(localStorage,'/space','local',[]);
 expect(restored.selected).toBe('draft');expect(restored.filters.query).toBe('检索');expect(restored.filters.location).toEqual(['local']);expect(restored.scrollTop).toBe(340);expect(restored.limit).toBe(120);
 expect(readLibraryNavigation(localStorage,'/space','cloud',[]).tabs).toEqual([]);
 expect(readLibraryNavigation(localStorage,'/another-space','local',[]).tabs).toEqual([]);
});
it('keeps intentionally closed lists empty instead of importing old mixed tabs again',()=>{
 localStorage.setItem('scholay.library.tabs:/space',JSON.stringify({tabs:[{id:'draft',title:'稿件',source:'local'}]}));
 localStorage.setItem(libraryNavigationKey('/space','local'),JSON.stringify({tabs:[],selected:''}));
 expect(readLibraryNavigation(localStorage,'/space','local',[]).tabs).toEqual([]);
});
it('falls back safely for malformed preferences and classifies old tabs without a source',()=>{
 localStorage.setItem(libraryNavigationKey('/space','local'),'{bad');
 expect(readLibraryNavigation(localStorage,'/space','local',[]).tabs).toEqual([]);
 localStorage.removeItem(libraryNavigationKey('/space','local'));
 localStorage.setItem('scholay.library.tabs:/space',JSON.stringify({tabs:[{id:'draft',title:'稿件'},null,{id:4}],selected:'missing'}));
 const works=[{id:'draft',local:{id:'draft'}}] as Work[];
 expect(readLibraryNavigation(localStorage,'/space','local',works).selected).toBe('draft');
});
