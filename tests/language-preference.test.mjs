import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('language preferences never insert unsolicited banners or redirect; explicit switches still remember the choice',async()=>{
 const script=await readFile(new URL('../web/engine/site-language.js',import.meta.url),'utf8');
 for(const pathname of ['/','/en/','/archive/','/news/record/'])for(const language of ['zh-CN','en'])for(const storageFails of [false,true]){
  const listeners=[],stored=[];
  const links=['zh-CN','en'].map(locale=>({dataset:{languageSwitch:locale},addEventListener:(type,fn)=>listeners.push({type,fn,locale})}));
  const document={querySelectorAll:selector=>{assert.equal(selector,'[data-language-switch]');return links;},createElement:()=>assert.fail('must not create an automatic banner'),documentElement:{lang:language}};
  const location=Object.freeze({pathname}),navigator=Object.freeze({languages:[language==='en'?'zh-CN':'en']});
  runInNewContext(script,{document,location,navigator,localStorage:{getItem:()=>language==='en'?'zh-CN':'en',setItem:(key,value)=>{if(storageFails)throw Error('unavailable');stored.push([key,value]);}}});
  assert.equal(listeners.length,2);assert.deepEqual(stored,[]);
  for(const listener of listeners){assert.equal(listener.type,'click');listener.fn();}
  assert.deepEqual(stored,storageFails?[]:[['scholay-language','zh-CN'],['scholay-language','en']]);
 }
});
