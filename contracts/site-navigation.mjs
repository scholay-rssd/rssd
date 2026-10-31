// Navigation describes destinations, independently of editorial sections.
const kinds=new Set(['home','feed','page','calendar','resources','projects','gallery','graph','showcase','roadmap']);
const modules=new Set(['calendar','gallery','graph','showcase','roadmap']);
export function validNavigationHref(value){
 if(typeof value!=='string'||!/^\/(?!\/)/.test(value)||/[\\\s\x00-\x1f]/.test(value)||/%(?:2e|2f|5c)/i.test(value))return false;
 return !value.split(/[?#]/)[0].split('/').includes('..');
}
export function validateNavigation(value){
 if(!Array.isArray(value)||!value.length||value.length>20)throw Error('站点导航配置无效');
 const ids=new Set();
 return value.map(item=>{
  if(!item||typeof item!=='object'||Object.keys(item).some(k=>!['id','label','href','view','module','service','localize','labels','match'].includes(k))||!/^[a-z][a-z0-9-]*$/.test(item.id||'')||ids.has(item.id)||typeof item.label!=='string'||!item.label.trim()||item.label.length>80||!kinds.has(item.view)||!validNavigationHref(item.href))throw Error('站点导航入口无效');
  ids.add(item.id);
  if(item.module!==undefined&&!modules.has(item.module))throw Error('未知导航模块');
  if(item.service!==undefined&&item.service!=='guestbook')throw Error('未知导航服务');
  if(item.localize!==undefined&&typeof item.localize!=='boolean')throw Error('导航语言配置无效');
  if(item.labels!==undefined&&(!item.labels||typeof item.labels!=='object'||Array.isArray(item.labels)||Object.entries(item.labels).some(([lang,label])=>!['en','ja','fr','es'].includes(lang)||typeof label!=='string'||!label.trim()||label.length>80)))throw Error('导航翻译无效');
  if(item.match!==undefined&&(!Array.isArray(item.match)||item.match.some(href=>!validNavigationHref(href))))throw Error('导航选中规则无效');
  return structuredClone(item);
 });
}
export function navigationMatches(item,path){
 const clean=path.split('?')[0];
 return (item.match||[item.href]).some(route=>route==='/'?['/','/#/'].includes(clean):route.includes('#')?clean===route||clean.startsWith(route+'/'):clean===route||clean.startsWith(route.endsWith('/')?route:route+'/'));
}
