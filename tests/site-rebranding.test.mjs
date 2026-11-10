import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles,validateSite} from '../scripts/site-config.mjs';
import {spaceContext} from '../scripts/space-registry.mjs';
import {brandLibrary,brandSeeds} from '../desktop/scripts/agent/brand-library.mjs';
import {applySiteBrands} from '../desktop/scripts/agent/notebook-finalize.mjs';
import {renderArticleParts} from '../scripts/article-format.mjs';
import {brandEndnoteText,siteBrandLine} from '../contracts/brand-endnotes.mjs';
import {renderRssFeed} from '../web/engine/rss-feed.mjs';
async function folder(t){const d=await mkdtemp(join(tmpdir(),'site-rebranding-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
test('old built-in display names refresh while identity, custom labels and foreign origins remain intact',()=>{
 for(const [id,name] of [['enter','学术门户'],['legis','智能法案']]){
  const canonical=profiles.find(s=>s.id===id),old={...canonical,name,author:name},next=validateSite(old);
  assert.equal(next.name,canonical.name);assert.equal(next.author,canonical.author);assert.deepEqual(next.columns,old.columns);assert.equal(next.origin,old.origin);assert.equal(next.spaceId,old.spaceId);
  assert.equal(validateSite({...old,name:'我自己的站名'}).name,'我自己的站名');assert.equal(validateSite({...old,origin:'https://example.invalid'}).name,name);
 }
});
test('an existing shared brand library upgrades names and slogans once, retaining custom text and stale-save protection',async t=>{
 const data=await folder(t),seed=brandSeeds().find(b=>b.id==='site:enter'),old={...seed,name:'学术门户',version:5,endnotes:[{id:seed.id+':footer',label:'官网入口',text:'[学术门户](https://enter.scholay.com)'},{id:'custom',label:'自定义',text:'保留我的额外说明'}]};delete old.slogan;
 const snapshot=structuredClone(old);await writeFile(join(data,'writing-brands.json'),JSON.stringify({version:1,brands:[old]}));
 const [next]=await brandLibrary({data});assert.equal(next.name,'学术之门');assert.equal(next.slogan,'学者的智能时代生活指南');assert.equal(next.version,6);assert.equal(next.endnotes[1].text,'保留我的额外说明');assert.deepEqual(old,snapshot);
 assert.match(next.endnotes[0].text,/\[学术之门\]\(https:\/\/enter\.scholay\.com\) · 学者的智能时代生活指南/);
 assert.deepEqual(await brandLibrary({data}),[next]);await assert.rejects(brandLibrary({data,brand:old,expectedVersion:5}),/新版本/);
});
test('new endnote insertion includes one slogan and a full URL in desktop/headless shared logic',()=>{
 for(const id of ['enter','legis']){
  const note={blocks:[{id:'body',type:'paragraph',text:'保留正文',state:'ready'}],mounts:{brands:[]}},original=structuredClone(note),result=applySiteBrands(note,id,brandSeeds()).notebook;
  const site=profiles.find(s=>s.id===id),footer=result.blocks.find(b=>b.preset?.brandId==='site:'+id);
  assert.equal(footer.text,'['+site.name+']('+site.origin+') · '+site.slogan);assert.deepEqual(note,original);assert.equal(result.blocks[0].text,'保留正文');
  assert.equal(brandEndnoteText(result.mounts.brands[0],{text:footer.text}),footer.text);
 }
});
test('published standard brand endnotes render new names and slogans without rewriting prose or the source',()=>{
 const source='正文中提到 [学术门户](https://enter.scholay.com)，这段原话保留。\n\n## 参考文献\n\n1. 论文. https://example.org/paper\n2. [学术门户](https://enter.scholay.com)\n3. [智能法案](https://legis.wiki/)\n';
 const rendered=renderArticleParts(source,{site:profiles.find(s=>s.id==='enter')});
 assert.match(rendered.body,/学术门户/);assert.match(rendered.endnotes,/学术之门<\/a> · 学者的智能时代生活指南/);assert.match(rendered.endnotes,/犀术智法<\/a> · 法律，是游戏规则的艺术/);
 assert.match(source,/2\. \[学术门户\]/);assert.equal(siteBrandLine('[学术门户](https://evil.invalid/)'),null);assert.equal(siteBrandLine('[其他署名](https://enter.scholay.com/)'),null);
});
test('connected desktop spaces persist renamed metadata without moving workspaces or changing tokens and receipts',async t=>{
 const data=await folder(t),site={...profiles.find(s=>s.id==='enter'),name:'学术门户',author:'学术门户'},state=join(data,'spaces',site.spaceId),workspace=join(state,'workspace');
 await mkdir(workspace,{recursive:true});await writeFile(join(data,'spaces.json'),JSON.stringify({version:1,activeSpaceId:site.spaceId,sites:[site]}));await writeFile(join(workspace,'.site.json'),JSON.stringify(site));await writeFile(join(workspace,'receipt.json'),'original request and topic IDs');await writeFile(join(state,'publish-token'),'original token');
 const ctx=spaceContext(data);assert.equal(ctx.site.name,'学术之门');assert.equal(ctx.workspaceRoot,workspace);assert.equal(JSON.parse(await readFile(join(workspace,'.site.json'),'utf8')).author,'学术之门');
 assert.equal(await readFile(join(workspace,'receipt.json'),'utf8'),'original request and topic IDs');assert.equal(await readFile(join(state,'publish-token'),'utf8'),'original token');
 const before=(await stat(join(state,'site.json'))).mtimeMs;spaceContext(data);assert.equal((await stat(join(state,'site.json'))).mtimeMs,before);
});
test('RSS refreshes standard brand labels while retaining full image URLs, literal examples and item identity',()=>{
 const markdown='正文\n\n![图](./figure.png)\n\n## 参考文献\n\n```md\n[学术门户](https://enter.scholay.com)\n```\n\n> [智能法案](https://legis.wiki)\n\n1. [学术门户](https://enter.scholay.com)\n2. [智能法案](https://legis.wiki)';
 const result=renderRssFeed(profiles.find(s=>s.id==='enter'),[{title:'测试',route:'/news/example/',category:'软件网站',date:'2026-10-21',markdown}]);
 assert.match(result,/学术之门<\/a> · 学者的智能时代生活指南/);assert.match(result,/犀术智法<\/a> · 法律，是游戏规则的艺术/);
 assert.match(result,/src="https:\/\/enter\.scholay\.com\/news\/example\/figure.png"/);
 assert.match(result,/<code class="language-md">\[学术门户\]/);assert.match(result,/<blockquote>\n<p><a href="https:\/\/legis.wiki\/"[^>]*>智能法案<\/a><\/p>/);
 assert.match(result,/<guid isPermaLink="true">https:\/\/enter.scholay.com\/news\/example\/<\/guid>/);
});
test('RSS also recognizes the legacy plain brand paragraphs at the end of an article',()=>{
 const site=profiles.find(s=>s.id==='enter'),markdown='正文中提到学术门户，这句原话保留。\n\n[学术门户](https://enter.scholay.com)\n\n信息由 [Scholay 学术一站式平台](https://www.scholay.com/t/M4ZZW8KRE5) 整理并发表，如有侵权请反馈下架。\n\n信息同步发表于[恩特学术](https://enterscholar.com)，智能时代的学者社区';
 const result=renderRssFeed({...site,name:site.name+' · 软件网站'},[{title:'旧尾注',route:'/news/old-endnotes/',category:'软件网站',date:'2026-10-21',markdown}]);
 assert.match(result,/学术之门<\/a> · 学者的智能时代生活指南/);assert.match(result,/正文中提到学术门户，这句原话保留/);assert.doesNotMatch(result,/>学术门户<\/a>/);
});
