import test from 'node:test';
import assert from 'node:assert/strict';
import {applyHeadingPlan,headingLabels,setHeadingPreference,setBlockHeadingPreference} from '../desktop/scripts/agent/notebook-headings.mjs';
import {validateNotebook,notebookMarkdown,notebookPromptScope} from '../desktop/scripts/agent/notebook.mjs';
const source={id:'rss',title:'原始标题：n=20 的结果 [附表]',summary:'摘要',url:'https://example.org/original',reviewed:false,acquiredVia:'rss'};
const heading=(id,level=2)=>({id,type:'heading',level,text:'旧标题',state:'ready',sourceIds:['rss']});
const note=()=>({version:2,title:'文章',kind:'article',skills:['documentation'],fields:{},sources:[source],groups:[],blocks:[heading('h'),{id:'p',type:'paragraph',text:'已完成正文',state:'ready',sourceIds:['rss']},heading('sub',3),{id:'q',type:'paragraph',text:'第二段',state:'ready',sourceIds:[]},heading('next')],mounts:{templates:[],brands:[]},assets:{}});
const run=(n,mode,entries)=>{const scope=notebookPromptScope(n,{action:'revise',targetIds:entries.map(e=>e.id)});const result=applyHeadingPlan(n,{mode,entries},scope);return validateNotebook(result,n,{agent:true,scope});};
test('numbering is computed from hierarchy and order, never persisted as heading text',()=>{
 const n=note(),result=run(n,'numbered',['h','sub','next'].map(id=>({id})));
 assert.deepEqual(headingLabels(result.blocks),{h:'1',sub:'1.1',next:'2'});
 assert.equal(result.blocks[0].text,'');assert.match(notebookMarkdown(result),/## 1\n/);assert.match(notebookMarkdown(result),/### 1.1\n/);
 assert.equal(headingLabels([result.blocks[4],...result.blocks.slice(0,4)]).h,'2');
 assert.deepEqual(result.blocks[1],n.blocks[1]);assert.deepEqual(result.sources,n.sources);
});
test('source strategy copies exact titles and rejects generated substitutes',()=>{
 const n=note(),r=run(n,'source',[{id:'h',sourceId:'rss'}]);
 assert.equal(r.blocks[0].text,source.title);assert.equal(r.blocks[0].heading.sourceTitle,source.title);
 assert.match(notebookMarkdown(r),/\\\[附表\\\]/);
 assert.throws(()=>run(n,'source',[{id:'h',sourceId:'rss',text:'加工后的标题'}]),/不能由 AI 改写/);
 assert.throws(()=>run(n,'source',[{id:'h',sourceId:'missing'}]),/请选择/);
});
test('fixed labels come from author or template and cannot be invented',()=>{
 const n=note();assert.throws(()=>run(n,'fixed',[{id:'h'}]),/未设置/);
 n.blocks[0].heading={fixedText:'基金'};const r=run(n,'fixed',[{id:'h'}]);assert.equal(r.blocks[0].text,'基金');assert.equal(headingLabels(r.blocks).h,'1. 基金');
 const manual=setHeadingPreference(note(),'fixed');assert.equal(manual.blocks[0].heading.fixedText,'旧标题');
});
test('author global and per-section preferences survive AI decisions and direct patches',()=>{
 let n=setHeadingPreference(note(),'numbered');assert.throws(()=>run(n,'ai',[{id:'h',text:'新标题'}]),/作者选择/);
 n=setBlockHeadingPreference(n,'h','source');n.blocks[0].heading.sourceId='rss';
 const r=run(n,'numbered',[{id:'h'},{id:'sub'},{id:'next'}]);assert.equal(r.blocks[0].text,source.title);assert.equal(r.headingPolicy.mode,'numbered');
 assert.throws(()=>run(n,'numbered',[{id:'h',mode:'ai',text:'新标题'}]),/局部标题方式/);
 const scope=notebookPromptScope(n,{action:'revise',targetIds:['sub']});const bad=structuredClone(n);bad.blocks[2].heading.mode='ai';bad.blocks[2].text='绕过';assert.throws(()=>validateNotebook(bad,n,{agent:true,scope}),/作者选择/);
});
test('manual headings, protocol headings and non-target body are protected',()=>{
 const n=note();n.blocks[0].locked=true;assert.throws(()=>run(n,'ai',[{id:'h',text:'改写'}]),/保护/);
 n.kind='history';assert.throws(()=>run(n,'ai',[{id:'next',text:'改写'}]),/保护/);
 const r=run(n,'ai',[{id:'sub',text:'乘法次序'}]);assert.equal(r.blocks[2].text,'乘法次序');
 const scope=notebookPromptScope(n,{action:'revise',targetIds:['sub']});r.blocks[1].text='越界';assert.throws(()=>validateNotebook(r,n,{agent:true,scope}),/只允许修改/);
});
test('legacy notebooks render unchanged and incomplete references remain format errors',()=>{
 const n=note();assert.equal(validateNotebook(n).headingPolicy,undefined);assert.match(notebookMarkdown(n),/## 旧标题/);
 const r=run(n,'source',[{id:'h'}]);r.blocks[0].text='不是原标题';assert.throws(()=>validateNotebook(r),/原文快照/);
 const manual=setBlockHeadingPreference(r,'h','manual');assert.equal(manual.blocks[0].locked,true);assert.equal(manual.blocks[0].heading,undefined);
});
