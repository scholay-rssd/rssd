import test from 'node:test';
import assert from 'node:assert/strict';
import {renderArticleParts} from '../web/engine/article-math.mjs';
import {STRUCTURES,articleStructures,headingAnchors} from '../web/themes/structures.mjs';
import {BLOG_SITES,DEMO_BLOG_SITES} from '../web/themes/journal/blog-presets.mjs';
import {DEMO_STRUCTURES} from '../web/demo/catalogue.mjs';

const record=(id,date,extra={})=>({id,title:id,route:'/news/'+id+'/',collectionId:'c',publication:{date},...extra});

test('every structure a site enables exists, and the Demo catalogue shows each one',()=>{
  for(const [id,preset] of Object.entries(BLOG_SITES))for(const s of preset.structures||[])assert(STRUCTURES[s],id+': '+s);
  for(const preset of Object.values(DEMO_BLOG_SITES))assert.deepEqual(preset.structures,Object.keys(STRUCTURES));
  for(const id of Object.keys(STRUCTURES))assert(DEMO_STRUCTURES.some(s=>s.id===id),'Demo catalogue lacks '+id);
});

test('without structures the article body is untouched',()=>{
  const body='<h2>A</h2><p>x</p><h3>B</h3>';
  assert.deepEqual(articleStructures({record:record('a','2026-01-01'),records:[],body}),{body,classes:[],lead:'',aside:'',after:''});
});

test('callout atom accepts the five alert types and leaves ordinary quotes alone',()=>{
  const html=renderArticleParts('> [!TIP]\n> 先 **备份**。\n\n> [!WARNING] 自定义\n\n> 普通 [!NOTE]\n\n> [!unknown]\n> x').body;
  assert.match(html,/<blockquote class="callout callout-tip">\n<p class="callout-title">提示<\/p>\n<p>先 <strong>备份<\/strong>。<\/p>/);
  assert.match(html,/callout-warning">\n<p class="callout-title">自定义<\/p>\n<\/blockquote>/);
  assert.match(html,/<blockquote>\n<p>普通 \[!NOTE\]<\/p>/);
  assert.match(html,/<blockquote>\n<p>\[!unknown\]/);
  assert.doesNotMatch(renderArticleParts('> [!NOTE] <script>x</script>').body,/<script>/);
});

test('toc anchors are stable and unique; neighbours stay in one collection',()=>{
  const {body,headings}=headingAnchors('<h2>一、背景</h2><h3>Setup &amp; Run</h3><h2>一、背景</h2>');
  assert.deepEqual(headings.map(h=>h.id),['一背景','setup-run','一背景-2']);
  assert.match(body,/<h2 id="一背景">/);
  const records=[record('old','2026-01-01'),record('mid','2026-02-01'),record('new','2026-03-01'),record('other','2026-02-15',{collectionId:'d'})];
  const result=articleStructures({structures:['toc','neighbors'],record:records[1],records,body:'<h2>A</h2><p>x</p><h2>B</h2>'});
  assert.deepEqual(result.classes,['has-toc']);assert.match(result.aside,/href="#a"/);
  assert.match(result.after,/rel="prev" href="\/news\/old\/"[\s\S]*rel="next" href="\/news\/new\/"/);
  assert.doesNotMatch(result.after,/other/);
});

test('data tables scroll in a labelled, focusable region without altering cells',()=>{
  const body=renderArticleParts('| a | b |\n| ---: | --- |\n| 1 | $x$ |').body;
  const {body:wrapped}=articleStructures({structures:['tables'],record:record('a','2026-01-01'),records:[],body});
  assert.match(wrapped,/<div class="table-scroll" role="region" tabindex="0" aria-label="[^"]+"><table class="data-table">/);
  assert.equal(wrapped.replace(/<div class="table-scroll"[^>]*>|<\/div>/g,'').replace(' class="data-table"',''),body);
});

test('byline is a definition list with reading time, so it never becomes a page description',()=>{
  const body='<p>'+'字'.repeat(1200)+' '+'word '.repeat(440)+'</p>';
  const {lead,classes}=articleStructures({structures:['byline','wide-figures','appendix'],record:record('a','2026-01-01',{publication:{date:'2026-01-01',author:'编辑部'}}),records:[],body,column:'方法百科',date:'2026-01-01'});
  assert.match(lead,/^<dl class="article-byline">/);assert.doesNotMatch(lead,/<p\b/);
  assert.match(lead,/<dd>编辑部<\/dd>[\s\S]*约 5 分钟/);
  assert.deepEqual(classes,['figures-wide','has-appendix']);
});

test('fact sheet and citations escape record fields and keep only public links',()=>{
  const r=record('a','2026-01-01',{summary:'<b>要旨</b>',tags:['著作权'],sources:[{label:'判决书',url:'https://www.court.example/case/1'},{label:'x',url:'javascript:alert(1)'}]});
  const {lead,sources}=articleStructures({structures:['fact-sheet','citations'],record:r,records:[],body:'',column:'法律案例',date:'2026-01-01'});
  assert.match(lead,/^<aside class="fact-sheet"[^>]*><dl>/);assert.match(lead,/&lt;b&gt;要旨/);assert.doesNotMatch(lead,/<p\b/);
  assert.match(sources,/<ol><li><a href="https:\/\/www.court.example\/case\/1" rel="noreferrer">判决书 ↗<\/a><small>court.example<\/small><\/li><\/ol>/);
  assert.doesNotMatch(sources,/javascript/);
  assert.equal(articleStructures({structures:['citations'],record:{...r,sources:[]},records:[],body:''}).sources,'');
});

test('infobox has no paragraph; see-also ranks shared tags and skips events and itself',()=>{
  const self=record('cat','2026-01-03',{tags:['猫','饮食']}),records=[self,record('a','2026-01-01',{tags:['猫']}),record('b','2026-01-02',{tags:['猫','饮食']}),record('c','2026-01-04',{collectionId:'x'}),record('e','2026-01-05',{tags:['猫'],type:'event'}),record('d','2026-01-06')];
  const result=articleStructures({structures:['infobox','see-also'],record:self,records,body:'',column:'萌宠见闻',date:'2026-01-03'});
  assert.doesNotMatch(result.lead,/<p\b/);assert.deepEqual(result.classes,['has-infobox']);
  assert.deepEqual([...result.after.matchAll(/href="\/news\/(\w+)\/"/g)].map(m=>m[1]),['b','a','d']);
});

test('epigraph only claims an opening quotation; the title seal is hidden from assistive tech',()=>{
  const body=renderArticleParts('> 学而时习之。\n>\n> —— 《论语》\n\n正文\n\n> 中间的引用').body;
  const {body:out,lead,classes}=articleStructures({structures:['epigraph','title-seal'],record:record('a','2026-01-01'),records:[],body});
  assert.match(out,/^<blockquote class="epigraph">\n<p>学而时习之。<\/p>\n<p class="epigraph-source">—— 《论语》<\/p>/);
  assert.equal((out.match(/class="epigraph"/g)||[]).length,1);
  assert.match(lead,/<div class="title-seal" aria-hidden="true">/);assert.deepEqual(classes,['has-title-seal']);
  const plain=renderArticleParts('正文\n\n> 引用').body;
  assert.equal(articleStructures({structures:['epigraph'],record:record('a','2026-01-01'),records:[],body:plain}).body,plain);
});

test('link directory groups by section, links out directly, and is off unless enabled',async()=>{
  const {homeStructures}=await import('../web/themes/structures.mjs');
  const content={collections:[{id:'tools',name:'软件',route:'/archive/tools/'},{id:'empty',name:'空',route:'/archive/empty/'}],records:[record('zotero','2026-01-02',{collectionId:'tools',summary:'文献管理',sources:[{label:'官网',url:'https://www.zotero.org/'}]}),record('ev','2026-01-03',{collectionId:'tools',type:'event'})]};
  assert.equal(homeStructures({content,sections:content.collections}),'');
  const html=homeStructures({structures:['link-directory'],content,sections:content.collections});
  assert.match(html,/href="#dir-tools">软件<small>1<\/small>/);assert.doesNotMatch(html,/dir-empty|\/news\/ev\//);
  assert.match(html,/<a class="link-host" href="https:\/\/www.zotero.org\/" rel="noreferrer">zotero.org ↗<\/a>/);
  assert.match(articleStructures({structures:['source-action'],record:content.records[0],records:[],body:''}).lead,/class="source-action" href="https:\/\/www.zotero.org\/"/);
});

test('post meta and reading progress add no paragraphs or scripts',()=>{
  const r=articleStructures({structures:['post-meta','reading-progress'],record:record('a','2026-01-01',{tags:['产品']}),records:[],body:'<p>短文</p>',date:'2026-01-01'});
  assert.match(r.lead,/^<div class="post-meta"><time>2026-01-01<\/time><span>约 1 分钟<\/span><span class="post-tag">#产品<\/span><\/div>$/);
  assert.equal(r.after,'<div class="reading-progress" aria-hidden="true"></div>');
});

test('image rows group only image-only paragraphs and keep the shared caption',()=>{
  const md='![a](https://e.org/a.png) ![b](https://e.org/b.png)\n![c](https://e.org/c.png)\n\n图：三张图共用的图注。\n\n![solo](https://e.org/s.png)\n\n文字 ![x](https://e.org/x.png) ![y](https://e.org/y.png)';
  const body=renderArticleParts(md).body,out=articleStructures({structures:['image-rows'],record:record('a','2026-01-01'),records:[],body}).body;
  assert.match(out,/<div class="image-row" style="--images:3"><img src="https:\/\/e.org\/a.png"[^>]*><img[^>]*><img[^>]*><\/div>\n<p class="article-caption">图：三张图共用的图注。<\/p>/);
  assert.equal((out.match(/image-row/g)||[]).length,1);
  assert.match(out,/<p>文字 <img/);
});

test('inline contents needs three headings and shares anchors with the rail',async()=>{
  const {ACADEMIC_STRUCTURES}=await import('../web/themes/academic/build-seo.mjs');
  for(const s of ACADEMIC_STRUCTURES)assert(STRUCTURES[s],s);
  const body='<h2>甲</h2><h3>乙</h3><h2>丙</h2>';
  const r=articleStructures({structures:['contents','toc'],record:record('a','2026-01-01'),records:[],body});
  assert.match(r.lead,/^<details class="article-contents"><summary>本文目录 <small>3<\/small><\/summary><ol><li class="toc-h2"><a href="#甲">/);
  assert.match(r.aside,/href="#甲"/);assert.match(r.body,/<h3 id="乙">/);
  assert.equal(articleStructures({structures:['contents'],record:record('a','2026-01-01'),records:[],body:'<h2>甲</h2><h2>乙</h2>'}).lead,'');
});

test('skins: eight sites own a stylesheet, piggytuck and the others never get one, and sites keep their existing preset',async()=>{
  const {SKINNED_SITES,blogPreset,BLOG_SITES}=await import('../web/themes/journal/blog-presets.mjs');
  const {access,readFile}=await import('node:fs/promises');const {profiles}=await import('../scripts/site-config.mjs');
  assert.deepEqual([...SKINNED_SITES].sort(),['enter','legis','metho','personal','pets','study','xsiching','xsime']);
  for(const id of SKINNED_SITES){
    await access(new URL(`../web/themes/journal/skins/${id}.css`,import.meta.url));
    const css=await readFile(new URL(`../web/themes/journal/skins/${id}.css`,import.meta.url),'utf8');
    assert.match(css,new RegExp(`\\[data-skin=${id}\\]`));assert.doesNotMatch(css,/googleapis|@import|url\(/);
    assert.equal(blogPreset(profiles.find(s=>s.id===id)).skin,id);
  }
  for(const id of ['piggytuck','scholay-today'])assert.equal(blogPreset(profiles.find(s=>s.id===id)||{id,name:id,domain:id}).skin,undefined);
  assert.equal(blogPreset({id:'demo-skin-metho',name:'x',domain:'x'}).skin,'metho');
  assert.equal(BLOG_SITES.metho.theme,'archie');
});
