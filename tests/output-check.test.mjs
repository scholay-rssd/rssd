import test from 'node:test';
import assert from 'node:assert/strict';
import {checkArticle,fillItems,shorterTitle,vaultRecord,centerReader,buildReport,renderReport} from '../scripts/output-check.mjs';

const site={id:'metho',spaceId:'metho',name:'研究方法',author:'研究方法'};
const record={id:'one',locale:'zh-CN',sectionId:'methods',title:'标题',summary:'摘要',author:'作者',date:'2026-11-03',category:'方法百科',markdown:'# 标题\n\n## 一节\n\n![图](/article-media/a.png)\n',assets:[{path:'/article-media/a.png'}],version:2,publishedVersion:1};

test('an article is checked against the spec and every output format',()=>{
 const good=checkArticle(record,site);
 assert.deepEqual(good.findings.map(f=>f.code),['title_repeated_in_body']);
 assert.equal(good.fields['wechat-official-account'].cover,'/article-media/a.png');
 const bare=checkArticle({...record,author:'',category:'',markdown:'正文 ![](x.png)',assets:[],title:'长'.repeat(70)},site);
 assert.deepEqual(bare.findings.map(f=>(f.destination?f.destination+':':'')+f.code),['missing_author','missing_category','image_without_alt','no_chapters',
  'wechat-official-account:title_shortened','wechat-official-account:missing_cover','xiaohongshu:title_shortened','xiaohongshu:missing_cover','title_longer_than_wechat_api']);
 assert.equal(bare.fields['wechat-official-account'].author,'研究方法');
 assert.deepEqual(checkArticle({id:'x'},site).fields,{});
});
test('the fill list proposes values that already exist and says where each comes from',()=>{
 assert.deepEqual(fillItems(record,site),[]);
 const items=fillItems({...record,author:'',category:'',title:'一个短标题：'+'长'.repeat(70),markdown:'![](a.png)\n\n*图 1 样本分布*\n\n![](b.png)\n\n正文'},site);
 assert.deepEqual(items.map(i=>[i.field,i.proposed]),[['author','研究方法'],['category','方法百科'],['image alt','图 1 样本分布'],['image alt',''],['title (WeChat only)','一个短标题']]);
 assert.match(items[3].from,/needs writing/);
 assert.equal(fillItems({...record,author:'',sectionId:'gone',category:''},{id:'none'}).every(i=>i.proposed===''),true);
 assert.deepEqual(fillItems({...record,author:'名'.repeat(17)},site).map(i=>[i.field,i.proposed]),[['author (WeChat only)','研究方法']]);
 assert.match(shorterTitle('长'.repeat(70),64).from,/needs an editor/);
});
test('a vault note becomes a source record; other notes are skipped',()=>{
 const note='---\ntitle: "引号: 标题"\nsummary: >-\n  摘\n  要\nrssd-id: draft-1\nrssd-section: methods\nrssd-locale: en\nrssd-kind: news\nrssd-version: 2\nrssd-published-version: \n---\n# T\n\n![a](article-media/a.png)\n';
 assert.deepEqual(vaultRecord(note),{id:'draft-1',locale:'en',sectionId:'methods',kind:'news',title:'引号: 标题',summary:'摘 要',author:'',date:'',category:'',markdown:'# T\n\n![a](article-media/a.png)\n',media:['article-media/a.png'],version:2,publishedVersion:null});
 assert.equal(vaultRecord('# plain note'),null);assert.equal(vaultRecord('---\ntitle: x\n---\nbody'),null);
});
test('the Center reader only sends GET and refuses a missing credential',async()=>{
 const token='rssd_device_'+'a'.repeat(48),calls=[];
 const get=centerReader({origin:'https://center.example',token,fetcher:async(url,options)=>{calls.push([url,options.method,options.body]);return {ok:true,status:200,json:async()=>({ok:1})};}});
 assert.deepEqual(await get('/registry'),{ok:1});assert.deepEqual(calls,[['https://center.example/api/rssd/v1/registry','GET',undefined]]);
 assert.throws(()=>centerReader({origin:'https://center.example',token:''}),/RSSD_CENTER_TOKEN/);
 assert.throws(()=>centerReader({origin:'http://center.example',token}),/HTTPS/);
 const failing=centerReader({origin:'https://center.example',token,fetcher:async()=>({ok:false,status:403,json:async()=>({code:'forbidden',message:'No'})})});
 await assert.rejects(failing('/registry'),error=>error.code==='forbidden'&&!error.message.includes(token));
});
test('a report has a per-site summary, a per-finding list and a fill list',async()=>{
 async function* source(){yield {site,record};yield {site,record:{...record,id:'two',locale:'en',author:''}};yield {site,unreadable:{articleId:'three',locale:'zh-CN',code:'media_limit',message:'Too large'}};}
 const report=await buildReport(source(),{source:'test',createdAt:'2026-11-11T00:00:00.000Z'});
 assert.deepEqual(report.sites,[{siteId:'metho',name:'研究方法',works:2,byLocale:{'zh-CN':1,en:1},unreadable:1,codes:{title_repeated_in_body:2,missing_author:1}}]);
 assert.deepEqual(report.fill.map(f=>[f.articleId,f.locale,f.items[0].field]),[['two','en','author']]);
 const {summary,csv,fill}=renderReport(report);
 assert.match(summary,/\| metho \| 2 \| 1 \| 1 \| 1 \| 2 \|/);assert.equal(csv.trim().split('\n').length,5);assert.match(csv,/"three","zh-CN".*"media_limit"/);
 assert.match(fill,/## author \(1\)[\s\S]*\| metho \| two \| en \| methods \| 研究方法 \|/);
});
