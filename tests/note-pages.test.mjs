import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {SITE_SECTIONS} from '../contracts/site-sections.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
// A 1×1 PNG: enough for the media store, picture sizes and the gallery shape.
const PNG=Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'+'1f15c4890000000d49444154789c636000020000050001e9fadcd80000000049454e44ae426082','hex');
// A second, different picture: the same image two pixels wide.
const PNG2=Buffer.from(PNG);PNG2.writeUInt32BE(2,16);
const missing=async file=>{try{await access(file);return false;}catch{return true;}};

test('notes get a gallery page, articles a linked card page, and the feed says which is which',async t=>{
 const root=await mkdtemp(join(tmpdir(),'note-pages-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const previous=join(root,'previous'),target=join(root,'site');
 const media=bytes=>'/article-media/'+createHash('sha256').update(bytes).digest('hex')+'.png';
 const picture=media(PNG),second=media(PNG2);
 await mkdir(join(previous,'article-media'),{recursive:true});await writeFile(join(previous,picture.slice(1)),PNG);await writeFile(join(previous,second.slice(1)),PNG2);
 const assets=[{path:picture,fromPublished:true}],noteAssets=[...assets,{path:second,fromPublished:true}];
 const pets=profiles.find(site=>site.id==='pets');
 const policy={'daily-cat':{workTypes:['article','note'],articleCards:true},'daily-dog':{workTypes:['article','note']}};
 // This test sets each section's settings itself instead of using the bundled ones.
 const site={...pets,sections:SITE_SECTIONS.pets.map(({workTypes,articleCards,...section})=>({...section,...policy[section.id]}))};
 const cards=revision=>({revision,pages:[{src:picture,width:1,height:1},{src:picture,width:1,height:1}]});
 const article=(id,sectionId,extra={})=>({id,title:'长文 '+id,sectionId,date:'2026-11-18',summary:'长文摘要',markdown:`# 长文 ${id}\n\n第一段正文。\n\n![配图](${picture})\n\n第二段正文。`,assets,...extra});
 const news=[
  article('maine-coon','daily-cat',{revision:2,cards:cards(2)}),
  article('stale-cards','daily-cat',{revision:2,cards:cards(1)}),
  article('dog-article','daily-dog',{cards:cards(1)}),
  {id:'maine-coon-signs',title:'缅因猫的 5 个特征',sectionId:'daily-cat',date:'2026-11-19',summary:'一眼认出缅因猫',workType:'note',adaptedFrom:{articleId:'maine-coon',revision:1},
   markdown:`# 缅因猫的 5 个特征\n\n![第一张](${picture})\n\n![第二张](${second})\n\n耳尖簇毛、胸前领毛、大脚掌。`,assets:noteAssets},
 ];
 const snapshot={news,data:{year:[],history:[]},openSource:{items:[]},permalinks:{}};
 const manifest=await buildSiteRelease({site,source:ROOT,target,previousRoot:previous,job:{id:'note-pages',snapshot,snapshot_hash:'note-pages'}});
 assert.equal(manifest.browserExports.notes,1);
 assert.equal(manifest.browserExports.cardPages,1);

 // The note: pictures in a gallery beside its text, its #tags, and the way back to the article it came from.
 const note=await readFile(join(target,'news/maine-coon-signs/index.html'),'utf8');
 assert.match(note,/<article class="rssd-article rssd-note-article"/);
 assert.equal((note.match(/<figure class="rssd-note-slide"/g)||[]).length,2);
 assert.doesNotMatch(note.slice(note.indexOf('rssd-note-text')),/<img[^>]+article-media/);
 assert.match(note,/<a href="\/news\/maine-coon\/">改写自《长文 maine-coon》<\/a><span class="rssd-outdated">原文已更新<\/span>/);
 assert.match(note,/<p class="rssd-tags" data-section="daily-cat"><a href="\/archive\/daily-cat\/">#每日一猫<\/a><\/p>/);
 assert.match(note,/assets\/rssd-export\/v1\/note\.css/);
 assert.match(note,/assets\/rssd-export\/v1\/note\.mjs/);

 // The article keeps its single column and links to its card page and to the note rewritten from it.
 const page=await readFile(join(target,'news/maine-coon/index.html'),'utf8');
 assert.match(page,/<article class="rssd-article" data-article-template=/);
 assert.match(page,/<a class="rssd-cards-link" href="\/news\/maine-coon\/cards\/">[^]*?<span>卡片版 · 2 张<\/span><\/a>/);
 assert.match(page,/<a href="\/news\/maine-coon-signs\/">图文笔记《缅因猫的 5 个特征》<\/a>/);
 assert.match(page,/<div class="article-body">[^]*?<img[^>]+article-media/);

 // The card page: the article's own address as canonical, the set in a gallery, no share panel, a way back.
 const cardPage=await readFile(join(target,'news/maine-coon/cards/index.html'),'utf8');
 assert.match(cardPage,/<title>卡片版 · /);
 assert.match(cardPage,new RegExp(`<link rel="canonical" href="${pets.origin.replace(/[.]/g,'\\.')}/news/maine-coon/">`));
 assert.match(cardPage,/<a class="back" href="\/news\/maine-coon\/">← 阅读全文<\/a>/);
 assert.equal((cardPage.match(/<figure class="rssd-note-slide"/g)||[]).length,2);
 assert.match(cardPage,/alt="第 2 张，共 2 张"/);
 assert.doesNotMatch(cardPage,/rssd-share/);
 assert.ok(manifest.hashes['news/maine-coon/cards/index.html']);

 // No card page from cards of an older revision, nor in a section without card pages.
 assert.ok(await missing(join(target,'news/stale-cards/cards/index.html')));
 assert.ok(await missing(join(target,'news/dog-article/cards/index.html')));
 assert.doesNotMatch(await readFile(join(target,'news/stale-cards/index.html'),'utf8'),/rssd-cards-link/);

 // The feed mixes both, and marks each card.
 const index=JSON.parse(await readFile(join(target,'content-feed-index.json'),'utf8'));
 assert.equal(index.mixed,true);
 assert.deepEqual(index.records.find(r=>r.id==='news:maine-coon-signs'),{...index.records.find(r=>r.id==='news:maine-coon-signs'),type:'note',pictures:2});
 const feed=await readFile(join(target,'archive/daily-cat/index.html'),'utf8');
 assert.match(feed,/<article class="feed-entry" data-section="daily-cat" data-type="note">/);
 // The mark is a picture; its name and the number of pictures are read out and shown on hover.
 assert.match(feed,/<span class="feed-type" data-type="note" role="img" aria-label="笔记 · 2 图" title="笔记 · 2 图"><svg[^>]*aria-hidden="true"[^>]*>[^]*?<\/svg><\/span>/);
 assert.match(feed,/<span class="feed-type" data-type="article" role="img" aria-label="长文" title="长文"><svg[^>]*>[^]*?<\/svg><\/span>/);

 // The published record keeps what the page was built from.
 const content=JSON.parse(await readFile(join(target,'published-content.json'),'utf8'));
 const record=id=>content.records.find(r=>r.id==='news:'+id);
 assert.deepEqual(record('maine-coon-signs').adaptedFrom,{articleId:'maine-coon',revision:1});
 assert.equal(record('maine-coon').cards.pages.length,2);
 assert.equal(record('maine-coon').revision,2);
});

test('a site with no notes and no card sets builds its pages and feed as before, whatever its sections allow',async t=>{
 const root=await mkdtemp(join(tmpdir(),'note-pages-plain-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const site={...profiles.find(s=>s.id==='pets')};
 const snapshot={news:[{id:'plain-article',title:'普通长文',sectionId:'daily-cat',date:'2026-11-18',summary:'摘要',markdown:'# 普通长文\n\n正文。'}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}};
 const manifest=await buildSiteRelease({site,source:ROOT,target:join(root,'site'),job:{id:'plain',snapshot,snapshot_hash:'plain'}});
 assert.equal(manifest.browserExports.notes,undefined);
 assert.equal(manifest.browserExports.cardPages,undefined);
 const page=await readFile(join(root,'site/news/plain-article/index.html'),'utf8');
 assert.doesNotMatch(page,/rssd-note|rssd-work-links|note\.css/);
 assert.ok(await missing(join(root,'site/assets/rssd-export/v1/note.css')));
 const index=JSON.parse(await readFile(join(root,'site/content-feed-index.json'),'utf8'));
 assert.equal(index.mixed,undefined);
 assert.doesNotMatch(await readFile(join(root,'site/archive/daily-cat/index.html'),'utf8'),/feed-type/);
});
