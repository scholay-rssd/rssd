import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedIndex,renderFeed,feedCard} from '../web/engine/content-feed.mjs';

const record=(id,{type='article',media,cards,revision,date='2026-11-'+String(30-Number(id.replace(/\D/g,''))).padStart(2,'0')}={})=>({id,type,title:'作品 '+id,summary:'摘要',route:'/news/'+id+'/',collectionId:'methods',publication:{date},...(media?{media}:{}),...(cards?{cards}:{}),...(revision?{revision}:{})});
const content=records=>({siteId:'metho',collections:[{id:'methods',name:'方法百科',route:'/archive/methods/'}],records});
const palette=id=>id==='methods'?{paper:'#fbfaf6',ink:'#15181c',accent:'#8a5a00',width:720}:undefined;

test('a cover is the first card of the current card set, else the first picture, else a text cover in the section colours',()=>{
 const index=createFeedIndex(content([
  record('w1',{revision:2,cards:{revision:2,pages:[{src:'/article-media/card.webp',width:1080,height:1440}]},media:[{src:'/article-media/pic.png'}]}),
  record('w2',{revision:3,cards:{revision:2,pages:[{src:'/article-media/old.webp',width:1080,height:1440}]},media:[{src:'/article-media/pic2.png'}]}),
  record('w3'),
 ]),{palette});
 const [w1,w2,w3]=index.records;
 assert.deepEqual(w1.cover,{src:'/article-media/card.webp',alt:'',ratio:0.75});
 assert.equal(w2.cover.src,'/article-media/pic2.png','a card set made for an older revision is not the cover');
 assert.equal(w3.cover,undefined);
 assert.deepEqual(index.sections[0].cover,{paper:'#fbfaf6',ink:'#15181c',accent:'#8a5a00'});
 const card=feedCard(w3,index);
 assert.match(card,/<a class="feed-cover feed-cover-text" href="\/news\/w3\/" tabindex="-1" aria-hidden="true" style="--tc-paper:#fbfaf6;--tc-ink:#15181c;--tc-accent:#8a5a00"><span>方法百科<\/span><strong>作品 w3<\/strong><\/a>/);
 // A colour that is not a plain hex value never reaches the style attribute.
 assert.equal(createFeedIndex(content([record('w4')]),{palette:()=>({paper:'red;background:url(x)'})}).sections[0].cover,undefined);
});

test('a listing is laid out as a waterfall, rows, or a lead row of four above rows; notes on a page share one row of covers',()=>{
 const items=['a1','n2','a3','a4','n5','a6','a7','n8','a9'].map(id=>record(id,{type:id[0]==='n'?'note':'article',media:[{src:'/article-media/'+id+'.png'}]}));
 const index=createFeedIndex(content(items));
 const entries=html=>html.match(/<div id="feed-entries">([\s\S]*?)<\/div><div id="feed-pagination">/)[1];
 const order=html=>[...html.matchAll(/<div class="(feed-lead|feed-notes)">|href="\/news\/([a-z0-9]+)\/" tabindex/g)].map(m=>m[1]||m[2]);
 const waterfall=renderFeed(index,{label:'目录'}).body;
 assert.match(waterfall,/data-feed-layout="waterfall"/);assert.doesNotMatch(entries(waterfall),/feed-lead|feed-notes/);
 const list=renderFeed(index,{label:'目录',layout:'list'}).body;
 assert.match(list,/data-feed-layout="list"/);
 assert.deepEqual(order(entries(list)),['a1','feed-notes','n2','n5','n8','a3','a4','a6','a7','a9']);
 const mixed=renderFeed(index,{label:'目录',layout:'mixed'}).body;
 assert.deepEqual(order(entries(mixed)),['feed-lead','a1','n2','a3','a4','feed-notes','n5','n8','a6','a7','a9']);
 assert.doesNotMatch(entries(renderFeed(index,{label:'目录',layout:'mixed',page:2}).body),/feed-lead/);
 assert.throws(()=>renderFeed(index,{label:'目录',layout:'grid'}),/Unknown feed layout/);
});
