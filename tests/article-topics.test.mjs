import test from 'node:test';
import assert from 'node:assert/strict';
import {articleTopics,TOPIC_SITES} from '../web/engine/browser-export/topics.mjs';
import {createFeedIndex,feedCard} from '../web/engine/content-feed.mjs';

const picture='/article-media/'+'a'.repeat(64)+'.webp';

test('the topics row shows the section first, then bound tags, without duplicates or guesses',()=>{
 assert.deepEqual([...TOPIC_SITES],['pets']);
 assert.equal(articleTopics({sectionId:'daily-cat',sectionName:'每日一猫',sectionRoute:'/archive/daily-cat/',tags:['缅因猫','每日一猫',' ','<b>']}),
  '<p class="rssd-topics" data-section="daily-cat"><a href="/archive/daily-cat/">#每日一猫</a><span>#缅因猫</span><span>#&lt;b&gt;</span></p>');
 assert.equal(articleTopics({sectionName:'Daily cat',sectionRoute:'',tags:[]}),'<p class="rssd-topics"><span>#Daily cat</span></p>');
 assert.equal(articleTopics({sectionName:'',tags:[]}),'');
});

test('feed cards reserve each cover at its real shape when the ratio is known',()=>{
 const record=(id,src)=>({id,title:id,route:'/news/'+id+'/',collectionId:'daily-cat',summary:'s',publication:{date:'2026-11-0'+id.length},...(src?{media:[{src,alt:''}]}:{})});
 const content={siteId:'pets',collections:[{id:'daily-cat',name:'每日一猫',route:'/archive/daily-cat/'}],records:[record('a',picture),record('bb','/article-media/'+'c'.repeat(64)+'.png'),record('ccc')]};
 const index=createFeedIndex(content,{ratio:src=>src===picture?0.75:undefined});
 const byId=Object.fromEntries(index.records.map(r=>[r.id,r]));
 assert.deepEqual(byId.a.cover,{src:picture,alt:'',ratio:.75});
 assert.equal(byId.bb.cover.ratio,undefined);
 assert.match(feedCard(byId.a,index),/class="feed-cover"[^>]*style="--ar:0\.75"><img[^>]*width="640" height="853"/);
 assert.match(feedCard(byId.bb,index),/<a class="feed-cover"[^>]*aria-hidden="true"><img[^>]*height="400"/);
 assert.doesNotMatch(feedCard(byId.ccc,index),/feed-cover/);
 assert.deepEqual(createFeedIndex(content).records.find(r=>r.id==='a').cover,{src:picture,alt:''});
});
