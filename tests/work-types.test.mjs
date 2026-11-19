import test from 'node:test';
import assert from 'node:assert/strict';
import {WORK_TYPES,CHOSEN_WORK_TYPES,DEFAULT_WORK_TYPES,CARD_STATES,MAX_CARD_PAGES,MAX_WORK_TAGS,workTypeLabel,sectionWorkPolicy,workTypeOf,validateAdaptedFrom,validateCardSet,validateWorkTags,adaptationIndex,articleCardState,workPages,cardsRoute} from '../contracts/work-types.mjs';
import {organizeContent} from '../web/engine/site-organization.mjs';
import {SITE_SECTIONS,validateSectionCatalog} from '../contracts/site-sections.mjs';
import {adaptPublishedSnapshot} from '../web/engine/published-content.mjs';
import {profiles} from '../scripts/site-config.mjs';

const refused=(fn,pattern)=>assert.throws(fn,error=>error.statusCode===400&&pattern.test(error.message));

test('four work types: writers choose between article and note, record kinds fix the rest',()=>{
 assert.deepEqual(Object.keys(WORK_TYPES),['article','note','event','resource']);
 assert.deepEqual(CHOSEN_WORK_TYPES,['article','note']);
 assert.deepEqual(DEFAULT_WORK_TYPES,['article']);
 assert.deepEqual(CARD_STATES,['waived','absent','pending','stale','present']);
 assert.equal(workTypeLabel('note'),'笔记');
 assert.equal(workTypeLabel('note','en'),'Note');
 assert.equal(workTypeLabel('article','ja'),'Article');
 refused(()=>workTypeLabel('video'),/Unknown work type/);
});

test('a section that declares nothing takes articles only and has no card page',()=>{
 for(const section of [undefined,null,{},{id:'daily-cat',name:'每日一猫'}])
  assert.deepEqual(sectionWorkPolicy(section),{workTypes:['article'],defaultType:'article',articleCards:false});
 assert.deepEqual(sectionWorkPolicy({workTypes:['note','article'],articleCards:true}),{workTypes:['note','article'],defaultType:'note',articleCards:true});
});

test('readers drop what they do not know; authors are told what is wrong',()=>{
 // A newer catalog may name a type this client does not know: keep what is known, never refuse the catalog.
 assert.deepEqual(sectionWorkPolicy({workTypes:['video','note']}).workTypes,['note']);
 assert.deepEqual(sectionWorkPolicy({workTypes:['video']}).workTypes,['article']);
 assert.equal(sectionWorkPolicy({articleCards:'yes'}).articleCards,false);
 assert.equal(sectionWorkPolicy({workTypes:['note'],articleCards:true}).articleCards,false);
 const strict={strict:true};
 refused(()=>sectionWorkPolicy({workTypes:[]},strict),/at least one/);
 refused(()=>sectionWorkPolicy({workTypes:'note'},strict),/at least one/);
 refused(()=>sectionWorkPolicy({workTypes:['video']},strict),/only list article and note/);
 refused(()=>sectionWorkPolicy({workTypes:['note','note']},strict),/each once/);
 refused(()=>sectionWorkPolicy({articleCards:'yes'},strict),/true or false/);
 refused(()=>sectionWorkPolicy({workTypes:['note'],articleCards:true},strict),/takes articles/);
});

test('a work takes its section default, keeps a type the section takes, and is never silently retyped',()=>{
 const both=sectionWorkPolicy({workTypes:['article','note']}),notes=sectionWorkPolicy({workTypes:['note']});
 assert.equal(workTypeOf({kind:'news'}),'article');
 assert.equal(workTypeOf({}),'article');
 assert.equal(workTypeOf({kind:'news'},notes),'note');
 assert.equal(workTypeOf({kind:'news',workType:'note'},both),'note');
 assert.equal(workTypeOf({kind:'news',workType:null},both),'article');
 refused(()=>workTypeOf({kind:'news',workType:'note'}),/does not take notes/);
 refused(()=>workTypeOf({kind:'news',workType:'article'},notes),/does not take articles/);
 refused(()=>workTypeOf({kind:'news',workType:'event'},both),/Unknown work type/);
 assert.equal(workTypeOf({kind:'year'},notes),'event');
 assert.equal(workTypeOf({kind:'history'}),'event');
 assert.equal(workTypeOf({kind:'openSource',workType:'resource'}),'resource');
 refused(()=>workTypeOf({kind:'history',workType:'note'}),/always of type event/);
 refused(()=>workTypeOf({kind:'podcast'}),/Unknown record kind/);
});

test('only a note names the article and revision it was rewritten from',()=>{
 assert.equal(validateAdaptedFrom(undefined,{type:'note'}),undefined);
 assert.deepEqual(validateAdaptedFrom({articleId:'maine-coon',revision:3},{type:'note',articleId:'maine-coon-cards'}),{articleId:'maine-coon',revision:3});
 refused(()=>validateAdaptedFrom({articleId:'maine-coon',revision:3},{type:'article'}),/Only a note/);
 refused(()=>validateAdaptedFrom({articleId:'maine-coon'},{type:'note'}),/revision/);
 refused(()=>validateAdaptedFrom({articleId:'maine-coon',revision:0},{type:'note'}),/revision/);
 refused(()=>validateAdaptedFrom({articleId:'Bad ID',revision:1},{type:'note'}),/article ID/);
 refused(()=>validateAdaptedFrom({articleId:'maine-coon',revision:1,sha256:'x'},{type:'note'}),/names an article/);
 refused(()=>validateAdaptedFrom('maine-coon',{type:'note'}),/names an article/);
 refused(()=>validateAdaptedFrom({articleId:'maine-coon',revision:1},{type:'note',articleId:'maine-coon'}),/itself/);
});

test('a work names its own tags: short phrases without #, each once, at most ten',()=>{
 assert.equal(validateWorkTags(undefined),undefined);
 assert.equal(validateWorkTags([]),undefined);
 assert.deepEqual(validateWorkTags(['缅因猫','长毛猫']),['缅因猫','长毛猫']);
 refused(()=>validateWorkTags('缅因猫'),/at most 10 tags/);
 refused(()=>validateWorkTags(Array.from({length:MAX_WORK_TAGS+1},(_,i)=>'tag'+i)),/at most 10 tags/);
 for(const tag of ['#缅因猫',' 缅因猫','','猫'.repeat(41),'a\nb',3])refused(()=>validateWorkTags([tag]),/up to 40 characters/);
 refused(()=>validateWorkTags(['缅因猫','缅因猫']),/once/);
});

test('tags bound in the organization file come first, then the work\'s own, each once',()=>{
 const content={siteId:'pets',collections:[{id:'daily-cat',name:'每日一猫',route:'/archive/daily-cat/'}],
  records:[{id:'news:a',collectionId:'daily-cat',sectionId:'daily-cat',tags:['缅因猫','长毛猫']},{id:'news:b',collectionId:'daily-cat',sectionId:'daily-cat',tags:['缅因猫']}]};
 const organization={version:1,siteId:'pets',sections:[{id:'daily-cat',name:'每日一猫',description:'每天认识一只猫'}],hubs:[],bindings:[{recordId:'news:a',sectionId:'daily-cat',tags:['猫咪品种','缅因猫'],related:[]}]};
 const organized=organizeContent(content,organization);
 assert.deepEqual(organized.records[0].tags,['猫咪品种','缅因猫','长毛猫']);
 assert.deepEqual(organized.records[1].tags,['缅因猫']);
});

test('only a long article has a card set, made of pictures in the site media store',()=>{
 const card='/article-media/'+'a'.repeat(64)+'.webp',cover='/article-media/'+'b'.repeat(64)+'.jpg';
 assert.equal(validateCardSet(undefined,{type:'article'}),undefined);
 assert.deepEqual(validateCardSet({revision:2,pages:[{src:card,width:1080,height:1440},{src:card}],cover:{src:cover}},{type:'article'}),
  {revision:2,pages:[{src:card,width:1080,height:1440},{src:card}],cover:{src:cover}});
 refused(()=>validateCardSet({pages:[{src:card}]},{type:'note'}),/Only a long article/);
 refused(()=>validateCardSet({pages:[]},{type:'article'}),/1 to 500 pages/);
 refused(()=>validateCardSet({pages:Array.from({length:MAX_CARD_PAGES+1},()=>({src:card}))},{type:'article'}),/1 to 500 pages/);
 refused(()=>validateCardSet({pages:[{src:'https://example.com/card.webp'}]},{type:'article'}),/Card 1 must be a picture/);
 refused(()=>validateCardSet({pages:[{src:card,width:1080}]},{type:'article'}),/whole width and height/);
 refused(()=>validateCardSet({pages:[{src:card}],cover:{src:'/cover.png'}},{type:'article'}),/The cover must be a picture/);
 refused(()=>validateCardSet({pages:[{src:card}],revision:0},{type:'article'}),/revision/);
 refused(()=>validateCardSet({pages:[{src:card}],variant:'model'},{type:'article'}),/has pages/);
});

test('article and note link both ways; a newer article revision marks the note outdated; nothing is guessed',()=>{
 const {notesOf,missing}=adaptationIndex([
  {articleId:'maine-coon',type:'article',revision:4},
  {articleId:'maine-coon-cards',type:'note',adaptedFrom:{articleId:'maine-coon',revision:4}},
  {articleId:'maine-coon-short',type:'note',adaptedFrom:{articleId:'maine-coon',revision:2}},
  {articleId:'from-a-note',type:'note',adaptedFrom:{articleId:'maine-coon-cards',revision:1}},
  {articleId:'from-nothing',type:'note',adaptedFrom:{articleId:'unpublished',revision:1}},
 ]);
 assert.deepEqual(notesOf.get('maine-coon'),[{articleId:'maine-coon-cards',outdated:false},{articleId:'maine-coon-short',outdated:true}]);
 assert.equal(notesOf.size,1);
 assert.deepEqual(missing,[{articleId:'from-a-note',adaptedFrom:'maine-coon-cards'},{articleId:'from-nothing',adaptedFrom:'unpublished'}]);
});

test('an article edition shows its card page only while a card set for its current revision exists',()=>{
 const cards=sectionWorkPolicy({workTypes:['article','note'],articleCards:true});
 assert.equal(articleCardState({type:'article',revision:2}),'waived');
 assert.equal(articleCardState({type:'note',policy:cards,revision:2,sets:[{revision:2}]}),'waived');
 assert.equal(articleCardState({type:'article',policy:cards,revision:2}),'absent');
 assert.equal(articleCardState({type:'article',policy:cards,revision:2,pending:true}),'pending');
 assert.equal(articleCardState({type:'article',policy:cards,revision:2,sets:[{revision:1}]}),'stale');
 assert.equal(articleCardState({type:'article',policy:cards,revision:2,sets:[{revision:1}],pending:true}),'pending');
 assert.equal(articleCardState({type:'article',policy:cards,revision:2,sets:[{revision:1},{revision:2}]}),'present');
 assert.deepEqual(workPages({type:'article',cardState:'present'}),['article','cards']);
 for(const cardState of ['waived','absent','pending','stale'])assert.deepEqual(workPages({type:'article',cardState}),['article']);
 assert.deepEqual(workPages({type:'note'}),['note']);
 assert.deepEqual(workPages({type:'event'}),['article']);
 assert.equal(cardsRoute('/news/maine-coon/'),'/news/maine-coon/cards/');
 assert.equal(cardsRoute('/en/news/maine-coon/'),'/en/news/maine-coon/cards/');
 for(const route of ['/news/maine-coon','news/x/','//evil/','/news/../x/',null])refused(()=>cardsRoute(route),/article route/);
});

test('the section catalog carries work settings only when a section declares them',()=>{
 const sections=[{id:'daily-cat',name:'每日一猫'},{id:'daily-dog',name:'每日一狗',workTypes:['article','video','note'],articleCards:true}];
 const catalog=validateSectionCatalog({version:1,revision:'r1',sections});
 assert.deepEqual(Object.keys(catalog.sections[0]).sort(),['enabled','id','name','order','writable']);
 assert.deepEqual(catalog.sections[1].workTypes,['article','note']);
 assert.equal(catalog.sections[1].articleCards,true);
 // A client that knows nothing new still reads a catalog whose only section names an unknown type.
 assert.deepEqual(validateSectionCatalog({version:1,revision:'r2',sections:[{id:'x',name:'X',workTypes:['video']}]}).sections[0].workTypes,['article']);
});

test('every bundled section setting passes the strict check',()=>{
 for(const [siteId,sections] of Object.entries(SITE_SECTIONS))for(const section of sections)
  assert.doesNotThrow(()=>sectionWorkPolicy(section,{strict:true}),siteId+'/'+section.id);
});

test('every site takes notes and gives long articles a card page somewhere, and keeps long articles the default',()=>{
 // The owner's settings of 2026-11-19: notes and card pages on every site, chosen per section.
 for(const [siteId,sections] of Object.entries(SITE_SECTIONS)){
  const policies=sections.filter(section=>section.enabled!==false).map(section=>sectionWorkPolicy(section,{strict:true}));
  assert.ok(policies.some(policy=>policy.workTypes.includes('note')),siteId+' takes notes');
  assert.ok(policies.some(policy=>policy.articleCards),siteId+' has card pages');
  // Works saved before types existed state none and take the default, so they must stay long articles.
  assert.ok(policies.every(policy=>policy.defaultType==='article'),siteId+' keeps long articles the default');
 }
});

test('the site publishes a note where its section takes notes and stops where it does not',()=>{
 const pets=profiles.find(site=>site.id==='pets');
 const site={...pets,sections:[{id:'daily-cat',name:'每日一猫',workTypes:['article','note']},{id:'daily-dog',name:'每日一狗'}]};
 const news=(id,sectionId,workType)=>({id,title:id,sectionId,date:'2026-11-19',markdown:'# '+id+'\n\nA short body.',...(workType?{workType}:{})});
 const snapshot=(...items)=>({news:items,data:{year:[],history:[]},openSource:{items:[]},permalinks:{}});
 const content=adaptPublishedSnapshot(snapshot(news('cat-note','daily-cat','note'),news('cat-article','daily-cat'),news('dog-article','daily-dog')),site);
 assert.deepEqual(content.records.map(r=>[r.id,r.type]),[['news:cat-note','note'],['news:cat-article','article'],['news:dog-article','article']]);
 assert.throws(()=>adaptPublishedSnapshot(snapshot(news('dog-note','daily-dog','note')),site),/does not take notes/);
});
