import test from 'node:test';
import assert from 'node:assert/strict';
import {templateSection,headingsFromBody} from '../desktop/scripts/agent/notebook-authoring.mjs';
import {notebookMarkdown,notebookPromptScope,validateNotebook} from '../desktop/scripts/agent/notebook.mjs';
const block=(id,type,text='',extra={})=>({id,type,text,state:text?'ready':'placeholder',sourceIds:[],...(type==='heading'?{level:2}:{}),...extra});
const note=blocks=>({version:2,title:'文章',kind:'article',skills:['essay'],fields:{},sources:[],groups:[],mounts:{templates:[],brands:[]},assets:{},blocks});

test('template planning labels stay out of Markdown and headings wait for actual prose',()=>{
 let id=0;const section=templateSection({name:'抽象规划名称',prompt:'解释标准误怎样随样本量变化'},()=>String(++id));
 const n={...note(section.blocks),groups:[section.group]};
 assert.deepEqual(headingsFromBody(n),[]);assert.doesNotMatch(notebookMarkdown(n),/抽象规划名称|标准误/);
 n.blocks[1]={...n.blocks[1],text:'样本量扩大到四倍时，标准误变成原来的一半。',state:'ready'};
 assert.deepEqual(headingsFromBody(n),[n.blocks[0].id]);assert.doesNotMatch(notebookMarkdown(n),/抽象规划名称/);
 assert.match(notebookMarkdown(n),/样本量扩大到四倍/);
});

test('heading selection respects unfinished prose, section boundaries and manual protection',()=>{
 const n=note([block('h1','heading','旧标题'),block('p1','paragraph','已写正文'),block('h2','heading'),block('p2','paragraph'),block('h3','heading','人工标题',{locked:true}),block('p3','paragraph','人工正文'),block('h4','heading','有图无正文'),block('img','image')]);
 assert.deepEqual(headingsFromBody(n),['h1']);
 assert.deepEqual(headingsFromBody({...n,kind:'year'}),[]);
 assert.deepEqual(headingsFromBody({...n,kind:'year',blocks:n.blocks.map(b=>b.id==='h1'?{...b,level:3}:b)}),['h1']);
 const grouped={...note([block('h','heading','',{groupId:'s'}),block('inside','paragraph','',{groupId:'s'}),block('outside','paragraph','另一节正文')]),groups:[{id:'s',kind:'section'}]};
 assert.deepEqual(headingsFromBody(grouped),[]);
});

test('a heading pass cannot rewrite body, image captions or unrelated headings',()=>{
 const n=note([block('h','heading'),block('p','paragraph','正式正文'),block('manual','heading','作者标题',{locked:true}),block('p2','paragraph','另一段')]);
 const scope=notebookPromptScope(n,{action:'revise',targetIds:headingsFromBody(n)});
 const next={...n,blocks:n.blocks.map(b=>b.id==='h'?{...b,text:'根据正文提炼',state:'ready'}:b)};
 assert.equal(validateNotebook(next,n,{agent:true,scope}).blocks[0].text,'根据正文提炼');
 assert.throws(()=>validateNotebook({...next,blocks:next.blocks.map(b=>b.id==='p'?{...b,text:'偷偷重写正文'}:b)},n,{agent:true,scope}),/只允许修改/);
 assert.throws(()=>validateNotebook({...next,blocks:next.blocks.map(b=>b.id==='manual'?{...b,text:'偷偷重写标题'}:b)},n,{agent:true,scope}),/人工锁定/);
});
