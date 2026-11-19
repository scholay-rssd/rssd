import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import p from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {publication,packetMedia,contentKey,CHOSEN_WORK_TYPES as PACKET_TYPES,MAX_WORK_TAGS as PACKET_TAGS,MAX_TAG_LENGTH as PACKET_TAG_LENGTH,WORK_TYPES_CAPABILITY} from '../contracts/rssd-publication.cjs';
import {CHOSEN_WORK_TYPES,MAX_WORK_TAGS,MAX_TAG_LENGTH} from '../contracts/work-types.mjs';
import {SITE_SECTIONS} from '../contracts/site-sections.mjs';
import {snapshotForPackets,buildAndActivate} from '../receiver/build.mjs';
import {createReceiver} from '../receiver/server.mjs';
import {validateNews,newsFingerprint} from '../admin/news.mjs';
import {profiles,validateSite} from '../scripts/site-config.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYZkAAAAASUVORK5CYII=','base64');
// Different bytes for a second and third picture: the same image, two and three pixels wide.
const variant=width=>{const bytes=Buffer.from(PNG);bytes.writeUInt32BE(width,16);return bytes;};
const pictures=[PNG,variant(2),variant(3)].map(bytes=>({bytes,manifest:media.imageManifest(bytes)}));
const [picture,second,cardOnly]=pictures.map(x=>x.manifest);
const base={version:1,siteId:'pets',workspaceId:'pets',sectionId:'daily-cat',locale:'zh-CN',revision:1,contentHash:'a'.repeat(64)};
const article={...base,requestId:'article-1',workId:'maine-coon',route:'/news/maine-coon/',assets:[picture],
 content:{locale:'zh-CN',title:'缅因猫',bodyMarkdown:`第一段。\n\n![配图](${picture.path})\n\n第二段。`,metadata:{date:'2026-11-18',workType:'article'}},
 cards:{revision:1,pages:[{...picture,width:1,height:1},{...cardOnly,width:1,height:1}],cover:cardOnly}};
const note={...base,requestId:'note-1',workId:'maine-coon-signs',route:'/news/maine-coon-signs/',assets:[picture,second],
 content:{locale:'zh-CN',title:'缅因猫的 5 个特征',bodyMarkdown:`![第一张](${picture.path})\n\n![第二张](${second.path})\n\n耳尖簇毛、胸前领毛。`,metadata:{date:'2026-11-19',workType:'note',adaptedFrom:{workId:'maine-coon',revision:1},tags:['缅因猫','长毛猫']}}};

test('the packet carries a work type, a note link and a card set only when the work states them',()=>{
 assert.deepEqual(PACKET_TYPES,CHOSEN_WORK_TYPES);
 assert.deepEqual([PACKET_TAGS,PACKET_TAG_LENGTH],[MAX_WORK_TAGS,MAX_TAG_LENGTH]);
 const plain={...base,requestId:'plain',workId:'plain',route:'/news/plain/',content:{locale:'zh-CN',title:'普通',bodyMarkdown:'正文',metadata:{author:'A',privateNotes:'never ships'}}};
 assert.deepEqual(Object.keys(publication(plain)).sort(),Object.keys({...plain}).filter(k=>k!=='cards').sort());
 assert.deepEqual(publication(plain).content.metadata,{author:'A'});
 const sent=publication(note);
 assert.deepEqual(sent.content.metadata,{date:'2026-11-19',workType:'note',adaptedFrom:{workId:'maine-coon',revision:1},tags:['缅因猫','长毛猫']});
 const cards=publication(article).cards;
 assert.equal(cards.revision,1);
 assert.deepEqual(cards.pages.map(page=>[page.path,page.width,page.height]),[[picture.path,1,1],[cardOnly.path,1,1]]);
 assert.deepEqual(packetMedia(publication(article)).map(m=>m.path),[picture.path,picture.path,cardOnly.path,cardOnly.path]);
 const meta=metadata=>({...plain,content:{...plain.content,metadata}});
 assert.throws(()=>publication(meta({tags:['#缅因猫']})),/Invalid work tags/);
 assert.throws(()=>publication(meta({tags:['缅因猫','缅因猫']})),/Invalid work tags/);
 assert.deepEqual(publication(meta({tags:[]})).content.metadata,{});
 assert.throws(()=>publication(meta({workType:'event'})),/Unsupported work type/);
 assert.throws(()=>publication(meta({adaptedFrom:{workId:'maine-coon',revision:1}})),/Only a note/);
 assert.throws(()=>publication(meta({workType:'note',adaptedFrom:{workId:'maine-coon'}})),/adaptedFrom revision/);
 assert.throws(()=>publication({...article,cards:{...article.cards,revision:2}}),/published revision/);
 assert.throws(()=>publication({...note,cards:article.cards}),/Only a long article/);
 assert.throws(()=>publication({...article,cards:{revision:1,pages:[]}}),/needs pages/);
 assert.throws(()=>publication({...article,cards:{revision:1,pages:[picture]}}),/card width/);
});

test('the receiver maps types, revisions, note links and card sets into the site snapshot',()=>{
 const snapshot=snapshotForPackets([publication(article),publication(note)],{sections:SITE_SECTIONS.pets,columns:['a','b','c','d','e'],author:'A'});
 const item=workId=>snapshot.news.find(x=>x.id==='rssd-'+contentKey({workId,locale:'zh-CN'}).slice(0,32));
 assert.equal(item('maine-coon').workType,'article');
 assert.equal(item('maine-coon').revision,1);
 assert.deepEqual(item('maine-coon').cards,{revision:1,pages:[{src:picture.path,width:1,height:1},{src:cardOnly.path,width:1,height:1}],cover:{src:cardOnly.path}});
 assert.equal(item('maine-coon-signs').workType,'note');
 assert.deepEqual(item('maine-coon-signs').adaptedFrom,{articleId:item('maine-coon').id,revision:1});
 assert.deepEqual(item('maine-coon-signs').tags,['缅因猫','长毛猫']);
 assert.equal(item('maine-coon').tags,undefined);
});

test('a receiver builds the note page and the card page, and refuses a note where the section takes none',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-work-types-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const policy={'daily-cat':{workTypes:['article','note'],articleCards:true}};
 // This test sets each section's settings itself: daily-dog takes no notes here.
 const site={...profiles.find(s=>s.id==='pets'),origin:'http://127.0.0.1:9',languages:['zh-CN','en'],sections:SITE_SECTIONS.pets.map(({workTypes,articleCards,...s})=>({...s,...policy[s.id]}))};
 const token='fixture-site-credential-not-real-1234567890',headers={authorization:'Bearer '+token};
 const receiver=await createReceiver({config:{home:join(dir,'state'),source:ROOT,sites:[{site,publicRoot:join(dir,'public'),tokenHash:p.hash(token)}]},build:options=>buildAndActivate({...options,verify:async()=>{}})});
 t.after(()=>receiver.app.close());
 const api='/api/rssd-receiver/v1/sites/pets';
 assert.ok((await receiver.app.inject({url:api+'/status',headers})).json().capabilities.includes(WORK_TYPES_CAPABILITY));
 for(const {bytes,manifest} of pictures)assert.equal((await receiver.app.inject({method:'POST',url:api+'/media/'+manifest.sha256,headers,payload:{...manifest,data:bytes.toString('base64')}})).statusCode,200);
 const publish=async packet=>{const sent=await receiver.app.inject({method:'POST',url:api+'/submissions',headers,payload:packet});assert.equal(sent.statusCode,200,sent.body);await receiver.tick();return (await receiver.app.inject({url:api+'/submissions/'+packet.requestId,headers})).json();};
 assert.equal((await publish(article)).state,'success');
 assert.equal((await publish(note)).state,'success');
 const current=join(dir,'public','current'),page=async route=>readFile(join(current,route.slice(1),'index.html'),'utf8');
 const notePage=await page(note.route),articlePage=await page(article.route),cardPage=await page('/news/maine-coon/cards/');
 assert.match(notePage,/<article class="rssd-article rssd-note-article"/);
 assert.match(notePage,/<a href="\/news\/maine-coon\/">改写自《缅因猫》<\/a>/);
 assert.match(notePage,/<p class="rssd-topics" data-section="daily-cat"><a href="\/archive\/daily-cat\/">#每日一猫<\/a><span>#缅因猫<\/span><span>#长毛猫<\/span><\/p>/);
 assert.match(articlePage,/<a class="rssd-cards-link" href="\/news\/maine-coon\/cards\/">/);
 assert.match(articlePage,/<a href="\/news\/maine-coon-signs\/">图文笔记《缅因猫的 5 个特征》<\/a>/);
 assert.equal((cardPage.match(/<figure class="rssd-note-slide"/g)||[]).length,2);
 await access(join(current,cardOnly.path.slice(1)));
 // A section that takes no notes: the build stops and says why; the live site stays as it was.
 const refused=await publish({...note,requestId:'note-dog',workId:'dog-note',sectionId:'daily-dog',route:'/news/dog-note/',content:{...note.content,metadata:{date:'2026-11-19',workType:'note'}}});
 assert.equal(refused.state,'failed');
 assert.match(refused.error,/does not take notes/);
 await assert.rejects(access(join(current,'news/dog-note/index.html')));
});

test('the site server keeps a stated work type and note link, and fingerprints old articles as before',()=>{
 const input={id:'maine-coon-signs',title:'缅因猫的 5 个特征',summary:'一眼认出',markdown:'# 缅因猫的 5 个特征\n\n正文。',date:'2026-11-19',category:'每日一猫'};
 assert.equal(newsFingerprint(input),newsFingerprint({...input,workType:undefined,adaptedFrom:undefined}));
 const saved=validateNews({...input,workType:'note',adaptedFrom:{articleId:'maine-coon',revision:2}});
 assert.equal(saved.workType,'note');
 assert.deepEqual(saved.adaptedFrom,{articleId:'maine-coon',revision:2});
 assert.equal(validateNews(input).workType,undefined);
 assert.throws(()=>validateNews({...input,workType:'event'}),error=>error.statusCode===400&&/长文或笔记/.test(error.message));
 assert.throws(()=>validateNews({...input,adaptedFrom:{articleId:'maine-coon',revision:2}}),error=>error.statusCode===400&&/Only a note/.test(error.message));
});

test('a site configuration with a misspelled section setting is refused when it loads',()=>{
 const pets=profiles.find(s=>s.id==='pets');
 assert.doesNotThrow(()=>validateSite({...pets,sections:SITE_SECTIONS.pets.map(s=>s.id==='daily-cat'?{...s,workTypes:['article','note'],articleCards:true}:s)}));
 assert.throws(()=>validateSite({...pets,sections:SITE_SECTIONS.pets.map(s=>s.id==='daily-cat'?{...s,workTypes:['notes']}:s)}),/daily-cat 的作品设置无效/);
});
