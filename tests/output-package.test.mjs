import test from 'node:test';
import assert from 'node:assert/strict';
import {OUTPUT_SPEC_VERSION,OUTPUT_FORMATS,OUTPUT_DESTINATIONS,outputProfile,sourceRecord,checkSource,fitText,characters,outputFields,outputManifest,manifestProblems,isCurrent} from '../contracts/output-package.mjs';

const source={id:'one',locale:'zh-CN',sectionId:'methods',title:'标题',summary:'摘要',author:'作者',date:'2026-11-03',category:'方法',markdown:'# 标题\n\n正文\n\n## 一节\n\n![图](/article-media/a.png)\n',media:['a.png'],version:2,publishedVersion:1};
const hash='a'.repeat(64);
const manifest=(over={})=>outputManifest({format:'wechat-article',source,site:{id:'metho',name:'研究方法'},style:'site',sourceHash:hash,engine:{name:'test',version:'1'},createdAt:'2026-11-11T00:00:00.000Z',
 files:[{path:'body.html',role:'body',type:'text/html',bytes:10,sha256:hash}],fields:{title:'标题'},...over});

test('a source record is normalized and its gaps are sorted by what they block',()=>{
 assert.deepEqual(sourceRecord({id:' one ',title:' T ',markdown:'x',media:['a.png',null,''],version:'2'}),
  {id:'one',locale:'zh-CN',sectionId:'',kind:'news',title:'T',summary:'',author:'',date:'',category:'',markdown:'x',media:['a.png'],version:null,publishedVersion:null});
 assert.throws(()=>sourceRecord(null));
 assert.deepEqual(checkSource(source),{errors:[],warnings:[],notes:[{code:'title_repeated_in_body',message:'The body opens with the title; outputs leave that heading out'}]});
 const bare=checkSource({locale:'fr',markdown:'正文 ![](a.png) ![](b.png)',date:'11/03'});
 assert.deepEqual(bare.errors.map(e=>e.code),['missing_id','invalid_locale','missing_section','missing_title']);
 assert.deepEqual(bare.warnings.map(w=>w.code),['missing_summary','missing_author','missing_category','invalid_date','image_without_alt']);
 assert.equal(bare.warnings.at(-1).count,2);assert.deepEqual(bare.notes.map(n=>n.code),['no_chapters']);
 assert.deepEqual(checkSource({...source,markdown:'正文',summary:'长'.repeat(121),date:''}).notes.map(n=>n.code),['no_chapters','no_images','summary_longer_than_digest']);
 assert.deepEqual(checkSource({...source,markdown:' '}).errors.map(e=>e.code),['missing_body']);
});
test('text is fitted to a platform limit by characters, not bytes',()=>{
 assert.equal(characters('汉😀a'),3);assert.equal(fitText('  短  文 ',10),'短 文');
 const fitted=fitText('一二三四五，六七八九十',6);assert.equal(fitted,'一二三四五…');assert.equal(characters(fitted),6);
 assert.equal(fitText('😀'.repeat(5),3),'😀😀…');assert.equal(fitText('abc',0),'abc');
});
test('platform fields are derived from the source and report what was shortened or is missing',()=>{
 const {fields,warnings}=outputFields('wechat-article',{...source,summary:'长'.repeat(200),author:'名'.repeat(20),media:[]});
 assert.equal(characters(fields.digest),OUTPUT_DESTINATIONS['wechat-official-account'].limits.digest);assert.equal(characters(fields.author),16);assert.equal(fields.cover,null);
 assert.deepEqual(warnings.map(w=>w.code),['digest_shortened','author_shortened','missing_cover']);
 assert.deepEqual(outputFields('wechat-article',source),{fields:{title:'标题',digest:'摘要',author:'作者',cover:'a.png'},warnings:[]});
 assert.equal(outputFields('wechat-article',source,{cover:'site.png'}).fields.cover,'site.png');
 assert.equal(outputFields('wechat-article',{...source,author:''},{site:{author:'研究方法'}}).fields.author,'研究方法');
 assert.equal(outputFields('wechat-article',source,{site:{author:'研究方法'}}).fields.author,'作者');
 assert.equal(outputFields('wechat-article',{...source,author:''}).fields.author,'');
 assert.deepEqual(sourceRecord({...source,media:undefined,assets:[{path:'/article-media/a.png',data:'AA=='},{},null]}).media,['/article-media/a.png']);
 assert.deepEqual(sourceRecord({...source,media:['a.png',{path:'b.png'}],assets:[{path:'c.png'}]}).media,['a.png','b.png']);
 assert.deepEqual(Object.keys(outputFields('cards',source,{destination:'xiaohongshu'}).fields),['title','caption','tags','cover']);
 // A format is named for what it is; the platform is a destination. The older platform-named id still works.
 assert.deepEqual(Object.keys(OUTPUT_FORMATS),['article','cards','plain']);
 assert.deepEqual(outputFields('article',{...source,title:'长'.repeat(70)}),{fields:{title:'长'.repeat(70)},warnings:[]});
 assert.deepEqual(outputFields('article',source,{destination:'wechat-official-account'}),outputFields('wechat-article',source));
 assert.deepEqual(outputProfile('wechat-article'),outputProfile('article','wechat-official-account'));
 assert.equal(outputProfile('article','xiaohongshu'),null);assert.equal(outputProfile('toString'),null);assert.equal(outputProfile('article','toString'),null);
 assert.throws(()=>outputFields('article',source,{destination:'xiaohongshu'}),/Unknown destination for article/);
 // Callers written before destinations existed keep their results.
 assert.deepEqual(outputFields('cards',source,{cover:'01.png'}),outputFields('cards',source,{cover:'01.png',destination:'xiaohongshu'}));
 assert.deepEqual(outputFields('cards',source,{destination:null}),{fields:{title:'标题'},warnings:[]});
 assert.deepEqual(manifestProblems(manifest({format:'cards',files:[{path:'01.png',role:'page',type:'image/png',bytes:1}],fields:{title:'标题',caption:'摘要',tags:[],cover:'01.png'}})),[]);
 assert.throws(()=>outputFields('fax',source),/Unknown output format/);
});
test('a manifest records what was exported and from which source',()=>{
 const m=manifest();
 assert.deepEqual(m,{spec:OUTPUT_SPEC_VERSION,format:'wechat-article',articleId:'one',locale:'zh-CN',sectionId:'methods',site:{id:'metho',name:'研究方法'},style:'site',
  source:{version:2,publishedVersion:1,hash},createdAt:'2026-11-11T00:00:00.000Z',engine:{name:'test',version:'1'},fields:{title:'标题'},
  files:[{path:'body.html',role:'body',type:'text/html',bytes:10,sha256:hash}],warnings:[]});
 assert.deepEqual(manifestProblems(m),[]);assert.deepEqual(manifestProblems(JSON.parse(JSON.stringify(m))),[]);
 assert.equal(isCurrent(m,hash),true);assert.equal(isCurrent(m,'b'.repeat(64)),false);assert.equal(isCurrent(null,hash),false);
});
test('an invalid manifest is refused with every reason',()=>{
 const refuse=(over,pattern)=>assert.throws(()=>manifest(over),error=>error.code==='invalid_manifest'&&pattern.test(error.message),JSON.stringify(over));
 refuse({format:'fax'},/Unknown format/);refuse({sourceHash:'nope'},/source\.hash/);refuse({createdAt:'yesterday'},/createdAt/);
 refuse({site:{name:'x'}},/site needs/);refuse({engine:{name:'x'}},/engine needs/);refuse({fields:{}},/fields\.title/);
 refuse({fields:{title:'T',caption:'c'}},/fields\.caption is not part of wechat-article/);refuse({files:[]},/at least one file/);
 refuse({files:[{path:'../body.html',role:'body',type:'text/html',bytes:1}]},/relative path/);
 refuse({files:[{path:'/etc/body.html',role:'body',type:'text/html',bytes:1}]},/relative path/);
 refuse({files:[{path:'body.txt',role:'text',type:'text/plain',bytes:1}]},/needs a body file/);
 refuse({files:[{path:'a.html',role:'body',type:'text/html',bytes:1},{path:'a.html',role:'body',type:'text/html',bytes:1}]},/Duplicate file/);
 refuse({files:[{path:'p.png',role:'page',type:'image/png',bytes:1},{path:'body.html',role:'body',type:'',bytes:-1,sha256:'x'}]},/role wechat-article does not use.*media type.*size in bytes.*invalid SHA-256/);
 refuse({warnings:[{code:'',message:'x'}]},/warnings/);refuse({source:{...source,locale:'fr'}},/locale/);
 assert.deepEqual(manifestProblems(null),['A manifest must be an object']);assert.ok(manifestProblems({}).length>8);
 const neutral=manifest({format:'article',destination:'wechat-official-account',fields:outputFields('article',source,{destination:'wechat-official-account'}).fields});
 assert.equal(neutral.format,'article');assert.equal(neutral.destination,'wechat-official-account');assert.deepEqual(manifestProblems(neutral),[]);
 assert.equal('destination' in manifest(),false);assert.deepEqual(manifestProblems(manifest({format:'article'})),[]);
 refuse({format:'article',fields:{title:'T',digest:'d'}},/fields\.digest is not part of article/);refuse({format:'article',destination:'xiaohongshu'},/destination is not one for article/);
 assert.deepEqual(manifestProblems(outputManifest({format:'cards',destination:'xiaohongshu',source,site:{id:'pets',name:''},sourceHash:hash,engine:{name:'t',version:'1'},createdAt:'2026-11-11T00:00:00Z',
  files:[{path:'01.jpg',role:'page',type:'image/jpeg',bytes:5}],fields:{title:'标题',caption:'摘要',tags:[],cover:null}})),[]);
});
