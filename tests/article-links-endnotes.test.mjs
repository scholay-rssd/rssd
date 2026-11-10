import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {renderArticle,renderArticleParts,normalizeArticleEndnotes,markdownLinks} from '../scripts/article-format.mjs';
import {notebookMarkdown} from '../desktop/scripts/agent/notebook.mjs';
import {recordFields,recordHeadings} from '../scripts/editorial-record.mjs';

const note=(id,text,extra={})=>({id,type:'paragraph',state:'ready',text,sourceIds:[],...extra});
const notebook=blocks=>({version:2,kind:'article',title:'保留原题',skills:[],blocks,groups:[],sources:[],fields:{},mounts:{templates:[],brands:[]}});
const brand=(id,text)=>note(id,text,{type:'annotation',role:'endnote',purpose:'marketing',locked:true,preset:{brandId:'chosen',id,version:2}});
const disclosure='信息由 [Scholay 学术一站式平台](https://www.scholay.com/t/M4ZZW8KRE5) 整理并发表，如有侵权请反馈下架。';
const syndication='信息同步发表于[恩特学术](https://enterscholar.com)，智能时代的学者社区';
const site={name:'学术门户',origin:'https://enter.scholay.com'};

test('legacy selected brand paragraphs become one final list without changing their wording or links',()=>{
 const body='# 原题\n\n正文。\n\n## 参考文献\n\n1. [文献](https://example.org/paper)';
 const text=body+'\n\n[学术门户](https://enter.scholay.com)\n\n'+disclosure+'\n\n'+syndication;
 const normalized=normalizeArticleEndnotes(text,{site});
 assert.equal(normalized,body+'\n\n### 品牌与发布说明\n\n1. [学术门户](https://enter.scholay.com)\n\n2. '+disclosure+'\n\n3. '+syndication+'\n');
 assert.equal(normalizeArticleEndnotes(normalized,{site}),normalized);
 assert.deepEqual(markdownLinks(normalized),markdownLinks(text));
 const parts=renderArticleParts(text,{site});
 assert.doesNotMatch(parts.body,/品牌与发布说明|整理并发表/);
 assert.match(parts.endnotes,/<h2>参考文献<\/h2>\n<ol>/);
 assert.equal((parts.endnotes.match(/<li>/g)||[]).length,4);
});

test('a selected site-only signature is a note, while other source links stay in the body',()=>{
 const text='正文。\n\n[学术门户](https://enter.scholay.com/)';
 assert.match(renderArticleParts(text,{site}).endnotes,/<li><a href="https:\/\/enter.scholay.com\/"/);
 for(const suffix of ['[别的署名](https://enter.scholay.com/)','[学术门户](https://enter.scholay.com/guide/)','[学术门户](https://example.org/)']){
  assert.equal(normalizeArticleEndnotes('正文。\n\n'+suffix,{site}),'正文。\n\n'+suffix);
 }
});

test('manual prose, quotations, code, non-final notes and edited disclosures remain unchanged',()=>{
 for(const text of ['正文。\n\n> '+disclosure,'正文。\n\n```markdown\n'+disclosure+'\n```',disclosure+'\n\n作者补充。','正文。\n\n'+disclosure.replace('整理并发表','校订并发表')])assert.equal(normalizeArticleEndnotes(text,{site}),text);
});

test('explicit numbered brand sections can follow separate source panels without absorbing other prose',()=>{
 const text='正文。\n\n### 品牌与发布说明\n\n1. [自选品牌](https://example.org/brand)\n';
 const parts=renderArticleParts(text);
 assert.equal(parts.body,'<p>正文。</p>\n');assert.match(parts.endnotes,/自选品牌/);
 const more=text+'\n作者补充。\n\n1. 正文清单\n';
 assert.equal(renderArticleParts(more).endnotes,'');
 assert.equal(renderArticleParts('正文。').endnotes,'');
});

test('published pages keep source panels before brand notes and retain the original stored content',async t=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {profiles}=await import('../scripts/site-config.mjs');
 const {buildSiteRelease}=await import('../web/engine/render-site.mjs');
 const profile=profiles.find(s=>s.id==='enter'),target=await mkdtemp(join(tmpdir(),'brand-endnotes-'));
 t.after(()=>rm(target,{recursive:true,force:true}));
 const markdown='# 原题\n\n人工正文 https://example.org/body。\n\n'+disclosure;
 const snapshot={news:[{id:'brand-note',title:'原题',category:profile.columns[1],date:'2026-10-17',markdown,sources:[{label:'核验来源',url:'https://example.org/source'}]}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:brand-note':'/news/brand-note/'}};
 const original=JSON.stringify(snapshot);
 await buildSiteRelease({site:profile,source:process.cwd(),target,job:{id:'brand-notes-test',snapshot,snapshot_hash:'fixture'}});
 const html=await readFile(join(target,'news/brand-note/index.html'),'utf8');
 assert.match(html,/href="https:\/\/example.org\/body"/);
 assert.ok(html.indexOf('article-endnotes')>html.indexOf('核验来源'));
 assert.match(html,/<div class="article-body article-endnotes"><h2>参考文献<\/h2>\n<ol>/);
 assert.equal(JSON.stringify(snapshot),original);
 const published=JSON.parse(await readFile(join(target,'published-content.json'),'utf8'));
 assert.equal(published.records[0].bodyMarkdown,markdown);
});

test('prose, captions and reference lists link full URLs as well as Markdown links',()=>{
 const text='正文 https://example.org/body。\n\n图注 https://example.org/image （许可）。\n\n## 参考文献\n\n1. 论文. https://doi.org/10.1051/0004-6361/202660769 （发表日期）\n2. [原文](https://example.org/paper?a=1&b=2)\n\n### 品牌与发布说明\n\n1. [品牌](https://example.org/brand)';
 const html=renderArticle(text);
 assert.deepEqual(markdownLinks(text),['https://example.org/body','https://example.org/image','https://doi.org/10.1051/0004-6361/202660769','https://example.org/paper?a=1&b=2','https://example.org/brand']);
 assert.equal((html.match(/<a /g)||[]).length,5);
 assert.match(html,/href="https:\/\/example.org\/body"[^>]*>https:\/\/example.org\/body<\/a>。/);
 assert.match(html,/rel="noopener noreferrer"/);
 assert.doesNotMatch(html,/<a[^>]*>[^<]*<a/);
});

test('literal code and raw HTML remain literal; unsafe protocols never become active links',()=>{
 const html=renderArticle('`https://example.org/code`\n\n```text\nhttps://example.org/fence\n```\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1)) [数据](data:text/html,hello)\n\n作者 example.org 和 name@example.org');
 assert.doesNotMatch(html,/<a\b|<script\b|href="(?:javascript|data):/i);
 assert.match(html,/<code>https:\/\/example.org\/code<\/code>/);
 assert.match(html,/&lt;script&gt;/);
});

test('Chinese punctuation separates bare URLs while explicit Unicode links retain their destinations',()=>{
 const text='网址 https://example.org/中文。后文；https://example.org/second（说明）\n\n[保留，标题](https://example.org/路径，内容) <https://example.org/路径。> https://example.org/encoded%E3%80%82。';
 assert.deepEqual(markdownLinks(text),[
  'https://example.org/%E4%B8%AD%E6%96%87',
  'https://example.org/second',
  'https://example.org/%E8%B7%AF%E5%BE%84%EF%BC%8C%E5%86%85%E5%AE%B9',
  'https://example.org/%E8%B7%AF%E5%BE%84%E3%80%82',
  'https://example.org/encoded%E3%80%82',
 ]);
 assert.match(renderArticle(text),/>保留，标题<\/a>/);
 assert.match(renderArticle(text),/<\/a>。后文；<a /);
});

test('selected brand notes become numbered final notes without changing source, locks or mounts',()=>{
 const first=brand('brand-a','信息由 [品牌甲](https://example.org/a) 整理。'),second=brand('brand-b','同步发表于 https://example.org/b\n\n保留作者的关系说明。');
 const input=notebook([note('intro','正文开始。'),first,note('image','https://example.org/image.webp',{type:'image'}),note('caption','图注原文。',{type:'annotation',role:'caption',targetId:'image'}),note('ending','正文结尾。',{sourceIds:['paper']}),second,note('pending','不能导出',{type:'annotation',role:'endnote',purpose:'marketing',state:'placeholder'})]);
 input.sources=[{id:'paper',url:'https://example.org/paper',title:'论文'}];
 input.mounts.brands=[{id:'unused',endnotes:[{text:'不应自动添加的品牌'}]}];
 const original=structuredClone(input),text=notebookMarkdown(input),html=renderArticle(text);
 assert.deepEqual(input,original);
 assert.ok(text.indexOf('图注原文。')<text.indexOf('正文结尾。'));
 assert.match(text,/### 参考文献/);
 assert.doesNotMatch(text,/### 来源|### 品牌与发布说明/);
 assert.ok(text.endsWith('   保留作者的关系说明。\n'));
 assert.match(text,/2\. 信息由 \[品牌甲\]/);
 assert.match(text,/3\. 同步发表于 https:\/\/example.org\/b/);
 const tokens=new MarkdownIt().parse(text,{});
 assert.equal(tokens.filter(x=>x.type==='ordered_list_open').length,1);
 assert.equal(tokens.filter(x=>x.type==='list_item_open').length,3); // one source + two notes
 assert.match(html,/<a href="https:\/\/example.org\/b"/);
 assert.doesNotMatch(text,/不能导出|不应自动添加的品牌/);
});

test('non-brand endnotes remain attributed and precede the final brand list',()=>{
 const input=notebook([brand('brand','[品牌](https://example.org/brand)'),note('body','正文。'),note('ref','[材料](https://example.org/source)',{type:'annotation',role:'endnote',purpose:'reference',sourceIds:['s']})]);
 input.sources=[{id:'s',title:'材料',url:'https://example.org/source'}];
 const text=notebookMarkdown(input);
 assert.ok(text.indexOf('正文。')<text.indexOf('### 参考文献'));
 assert.ok(text.indexOf('[材料]')<text.indexOf('[品牌]'));
 assert.equal(text.split('https://example.org/source').length,2);
 assert.doesNotMatch(text,/### 来源/);
});

test('articles with no selected endnotes keep their exact existing Markdown',()=>{
 assert.equal(notebookMarkdown(notebook([note('body','原文 **保持**。')])), '# 保留原题\n\n原文 **保持**。\n');
});

test('structured records demote extra H2 headings so placeholder 参考文献 cannot break the two-section contract',()=>{
 const input=notebook(recordHeadings('openSource').flatMap((text,i)=>[note('h'+i,text,{type:'heading',level:2,locked:true}),note('p'+i,'原有内容。')]));
 input.kind='openSource';
 input.blocks.push(note('ref','参考文献',{type:'heading',level:2}),brand('brand','[品牌](https://example.org/brand)'));
 const text=notebookMarkdown(input);
 assert.equal((text.match(/^## /gm)||[]).length,2);
 assert.match(text,/### 参考文献/);
 assert.equal(recordFields('openSource',{},text).summary.includes('原有内容'),true);
});
for(const kind of ['year','history','openSource'])test(kind+' structured records preserve the final linked notes',()=>{
 const input=notebook(recordHeadings(kind).flatMap((text,i)=>[note('h'+i,text,{type:'heading',level:2,locked:true}),note('p'+i,'原有内容。')]));
 input.kind=kind;input.blocks.push(brand('brand','[品牌](https://example.org/brand)'));
 const text=notebookMarkdown(input),fields=recordFields(kind,{},text);
 assert.equal((text.match(/^## /gm)||[]).length,2);
 assert.ok(Object.values(fields).some(v=>typeof v==='string'&&v.includes('### 参考文献\n\n1. [品牌]')));
});

test('references and brand disclosures share a single continuous ordered list',()=>{
 for(const list of ['1. 第一篇\n2. 第二篇','- 第一篇\n- 第二篇']){
  const html=renderArticle('正文。\n\n## 参考文献\n\n'+list+'\n\n### 品牌与发布说明\n\n1. 品牌甲\n2. 发布说明');
  assert.equal((html.match(/<ol>/g)||[]).length,1);
  assert.equal((html.match(/<li>/g)||[]).length,4);
  assert.doesNotMatch(html,/品牌与发布说明|<ul>/);
  assert.ok(html.indexOf('第二篇')<html.indexOf('品牌甲'));
 }
});

test('caption labels following images are quiet; ordinary prose and code stay untouched',()=>{
 const image='![示意](https://example.org/image.webp)';
 for(const caption of ['图注：原作者与许可 https://example.org/license','图 1 示意图','AI 生成示意图','图｜流程示意','*图1：说明*','学习记忆改用索引检索。AI 生成机制示意图。','键盘近景。图：[原图](https://example.org/photo)，作者摄，CC BY 2.0。']){
  assert.match(renderArticle(image+'\n\n'+caption),/<p class="article-caption">/);
 }
 assert.doesNotMatch(renderArticle(image+'\n\n接下来讨论研究结果。'),/article-caption/);
 assert.doesNotMatch(renderArticle('图注：这是普通文字。'),/article-caption/);
 assert.doesNotMatch(renderArticle('```\n'+image+'\n\n图注：示例\n```'),/class="article-caption"/);
});

test('bibliography-backed links and numbered citations render as superscripts in both full and split views',()=>{
 const text='作者 [甲](https://example.org/a) 认为如此。[2] `代码[1]` [普通链接](https://example.org/tool)。\n\n## 参考文献\n\n1. [甲文献](https://example.org/a)\n2. [乙文献](https://example.org/b)';
 for(const html of [renderArticle(text),renderArticleParts(text).body]){
  assert.equal((html.match(/<sup class="article-citation">/g)||[]).length,2);
  assert.match(html,/甲<sup[^>]*><a[^>]*href="https:\/\/example.org\/a"[^>]*>\[1\]<\/a><\/sup>/);
  assert.match(html,/<code>代码\[1\]<\/code>/);
  assert.match(html,/<a[^>]*href="https:\/\/example.org\/tool"[^>]*>普通链接<\/a>/);
 }
 assert.doesNotMatch(renderArticleParts(text).endnotes,/<sup/);
 assert.doesNotMatch(renderArticle('数组[1]，无文献。'),/<sup/);
});

test('figure description captions retain caption typography',()=>{
 assert.match(renderArticle('![图](https://example.org/a.webp)\n\n图示：记录方式。'),/<p class="article-caption">图示/);
});
