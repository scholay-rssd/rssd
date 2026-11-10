import test from 'node:test';
import assert from 'node:assert/strict';
import {articleBodyHeadings,datedRecordTitle,descriptionText,listingDescription,pageMetadata,plainText} from '../web/engine/page-metadata.mjs';

test('listing pages and distinct topics receive content-specific metadata',()=>{
  const site={name:'研究方法',description:'研究方法与实践',slogan:'学习研究，理解证据'};
  const a=pageMetadata({title:'定量方法',route:'/archive/quantitative/',body:'<p class="eyebrow">栏目</p><p>从抽样设计到模型检验，理解定量研究。</p>',site});
  const b=pageMetadata({title:'质性方法',route:'/archive/qualitative/',body:'<p>从访谈、编码到田野记录，理解质性研究。</p>',site});
  assert.equal(a.title,'定量方法 · 研究方法');
  assert.match(a.description,/抽样设计/);assert.notEqual(a.description,b.description);
  assert.equal(pageMetadata({title:site.name,route:'/',body:'',site}).title,'研究方法｜学习研究，理解证据');
  const page=number=>listingDescription({title:'学术新闻',page:number,pages:3,items:[{title:'实际文章'}]});
  assert.notEqual(page(1),page(2));assert.match(page(2),/第 2 页/);
});

test('headings, repeated event titles and escaped descriptions retain real content',()=>{
  assert.equal(articleBodyHeadings('<h1 id="x">章节</h1><h2>细节</h2><code>&lt;h1&gt;</code>'),'<h2 id="x">章节</h2><h2>细节</h2><code>&lt;h1&gt;</code>');
  assert.notEqual(datedRecordTitle({title:'项目申报'},'2025-06-01'),datedRecordTitle({title:'项目申报'},'2026-06-01'));
  assert.equal(datedRecordTitle({title:'(untitled)',sourceName:'研究协会'},'2026-10-20'),'研究协会通知（2026-10-20）');
  assert.equal(plainText('<script>private()</script><p>A &amp; B</p>'),'A & B');
  assert.doesNotThrow(()=>plainText('&#999999999999999999;'));
  assert.equal(Array.from(descriptionText('题目','很'.repeat(300))).length,200);
});

test('only empty method and portal listings are noindex; filled pages recover automatically',()=>{
  const site={id:'metho',name:'研究方法',origin:'https://metho.scholay.com',description:'研究方法与实践'};
  const metadata=(route,body,selected=site)=>pageMetadata({title:'目录',route,body,site:selected});
  assert.equal(metadata('/archive/methods/','<p class="empty">暂无内容</p>').robots,'noindex,follow');
  assert.equal(metadata('/archive/methods/','<article>新增方法文章</article>').robots,'index,follow,max-image-preview:large');
  assert.equal(metadata('/news/article/','<article><p class="empty">代码示例中的类名</p></article>').robots,'index,follow,max-image-preview:large');
  assert.equal(metadata('/journal/','<section class="hero">首页概览</section>').canonical,site.origin+'/');
  assert.equal(metadata('/journal/','<section data-feed-section="">阅读目录</section>').canonical,site.origin+'/archive/');
  assert.equal(metadata('/archive/empty/','<p class="empty">暂无内容</p>',{...site,id:'legis'}).robots,'index,follow,max-image-preview:large');
});
