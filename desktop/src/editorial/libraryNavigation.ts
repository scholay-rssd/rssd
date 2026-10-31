import type {Filters,Location,Work} from './contentLibrary';
import {EMPTY_FILTERS} from './contentLibrary';

export type LibraryTab={id:string;title:string;source?:Location};
export type LibraryNavigation={tabs:LibraryTab[];selected:string;filters:Filters;scrollTop:number;limit:number};
export const libraryNavigationKey=(workspace:string,scope:Location)=>`scholay.library.${scope}.navigation:${workspace}`;

// Keep the former mixed library intact. Each new list imports only its own tabs.
export function readLibraryNavigation(storage:Storage,workspace:string,scope:Location,works:Work[]):LibraryNavigation{
 const empty:LibraryNavigation={tabs:[],selected:'',filters:{...EMPTY_FILTERS,location:[scope]},scrollTop:0,limit:60};
 try{
  const saved=storage.getItem(libraryNavigationKey(workspace,scope));
  const value=JSON.parse(saved||storage.getItem('scholay.library.tabs:'+workspace)||'{}');
  const tabs:LibraryTab[]=Array.isArray(value.tabs)?value.tabs.filter((t:LibraryTab)=>t&&typeof t.id==='string'&&typeof t.title==='string'&&(saved||((t.source|| (works.find(w=>w.id===t.id)?.local?'local':'cloud'))===scope))).map((t:LibraryTab)=>({...t,source:scope})):[];
  const selected=tabs.some(t=>t.id===value.selected)?value.selected:tabs.at(-1)?.id||'';
  const f=value.filters;
  return {...empty,tabs,selected,filters:f?{...empty.filters,query:typeof f.query==='string'?f.query:'',type:[],category:Array.isArray(f.category)?f.category.filter((t:unknown)=>typeof t==='string'):[]}:empty.filters,scrollTop:Math.max(0,Number(value.scrollTop)||0),limit:Math.max(60,Number(value.limit)||60)};
 }catch{return empty;}
}
