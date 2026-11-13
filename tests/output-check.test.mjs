import test from 'node:test';
import assert from 'node:assert/strict';
import {editionRecord,checkArticle,fillItems,shorterTitle,vaultRecord,centerReader,buildReport,renderReport} from '../scripts/output-check.mjs';

const site={id:'metho',spaceId:'metho',name:'研究方法',author:'研究方法'};
const record={id:'one',locale:'zh-CN',sectionId:'methods',title:'标题',summary:'摘要',author:'作者',date:'2026-11-03',category:'方法百科',markdown:'# 标题\n\n## 一节\n\n![图](/article-media/a.png)\n',assets:[{path:'/article-media/a.png'}],version:2,publishedVersion:1};

test('an article is checked against the spec and every output format',()=>{
 const good=checkArticle(record,site);
 assert.deepEqual(good.findings.map(f=>f.code),['title_repeated_in_body']);
 assert.equal(good.fields['wechat-official-account'].cover,'/article-media/a.png');
 const bare=checkArticle({...record,author:'',category:'',markdown:'正文 ![](x.png)',assets:[],title:'长'.repeat(70)},site);
 assert.deepEqual(bare.findings.map(f=>(f.destination?f.destination+':':'')+f.code),['image_without_alt','author_from_site','category_from_section','no_chapters',
  'wechat-official-account:title_shortened','wechat-official-account:missing_cover','xiaohongshu:title_shortened','xiaohongshu:missing_cover','title_longer_than_wechat_api']);
 assert.equal(bare.fields['wechat-official-account'].author,'研究方法');
 assert.deepEqual(checkArticle({id:'x'},site).fields,{});
});
test('the fill list proposes values that already exist and says where each comes from',()=>{
 assert.deepEqual(fillItems(record,site),[]);
 const items=fillItems({...record,author:'',category:'',title:'一个短标题：'+'长'.repeat(70),markdown:'![](a.png)\n\n*图 1 样本分布*\n\n![](b.png)\n\n正文'},site);
 // Author and category come from the site and section at output, so they are not listed.
 assert.deepEqual(items.map(i=>[i.field,i.proposed]),[['image alt','图 1 样本分布'],['image alt',''],['title (WeChat only)','一个短标题']]);
 assert.match(items[1].from,/needs writing/);
 assert.deepEqual(fillItems({...record,author:'',sectionId:'gone',category:''},{id:'none'}).map(i=>[i.field,i.proposed]),[['author',''],['category','']]);
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
 let refusals=0;const failing=centerReader({origin:'https://center.example',token,sleep:async()=>{},fetcher:async()=>{refusals++;return {ok:false,status:403,json:async()=>({code:'forbidden',message:'No'})};}});
 await assert.rejects(failing('/registry'),error=>error.code==='forbidden'&&!error.message.includes(token));assert.equal(refusals,1);
 // A gateway page, an empty body or a dropped connection is retried, then reported without the credential.
 const answers=[()=>({ok:true,status:200,json:async()=>{throw Error('html');}}),()=>{throw Error('reset');},()=>({ok:true,status:200,json:async()=>({items:[]})})];
 const flaky=centerReader({origin:'https://center.example',token,sleep:async()=>{},fetcher:async()=>answers.shift()()});
 assert.deepEqual(await flaky('/x'),{items:[]});
 const broken=centerReader({origin:'https://center.example',token,sleep:async()=>{},fetcher:async()=>({ok:true,status:200,json:async()=>null})});
 await assert.rejects(broken('/x'),error=>error.code==='invalid_response'&&!error.message.includes(token));
});
test('a report has a per-site summary, a per-finding list and a fill list',async()=>{
 async function* source(){yield {site,record};yield {site,record:{...record,id:'two',locale:'en',author:'',title:'一个短标题：'+'长'.repeat(70)}};yield {site,unreadable:{articleId:'three',locale:'zh-CN',code:'media_limit',message:'Too large'}};}
 const report=await buildReport(source(),{source:'test',createdAt:'2026-11-11T00:00:00.000Z'});
 assert.deepEqual(report.sites,[{siteId:'metho',name:'研究方法',works:2,byLocale:{'zh-CN':1,en:1},unreadable:1,codes:{title_repeated_in_body:1,author_from_site:1,'wechat-official-account:title_shortened':1,'xiaohongshu:title_shortened':1,title_longer_than_wechat_api:1}}]);
 assert.deepEqual(report.fill.map(f=>[f.articleId,f.locale,f.items[0].field]),[['two','en','title (WeChat only)']]);
 const {summary,csv,fill}=renderReport(report);
 assert.match(summary,/\| metho \| 2 \| 1 \| 1 \| 1 \| 1 \| 1 \| 1 \| 1 \|/);assert.equal(csv.trim().split('\n').length,7);assert.match(csv,/"three","zh-CN".*"media_limit"/);
 assert.match(fill,/## title \(WeChat only\) \(1\)[\s\S]*\| metho \| two \| en \| methods \|[^\n]*一个短标题 \|/);
});
test('a Center edition becomes the same source record the editorial view would give',()=>{
 const work={id:'w1',sectionId:'methods'};
 const edition={locale:'en',revision:3,createdAt:'2026-11-01T08:00:00.000Z',payload:{locale:'en',title:'T',summary:'S',bodyMarkdown:'# T',media:[{id:'m1',alt:''}],metadata:{author:'A',category:'C',stableId:'s1'}}};
 assert.deepEqual(editionRecord(work,edition),{id:'s1',workId:'w1',locale:'en',sectionId:'methods',kind:'news',title:'T',summary:'S',author:'A',date:'2026-11-01',category:'C',markdown:'# T',media:['/api/rssd/v1/media/m1/raw'],version:3});
 assert.equal(editionRecord(work,{...edition,payload:{...edition.payload,metadata:{record:{kind:'year'}}}}).kind,'year');
 assert.equal(editionRecord(work,{...edition,payload:{...edition.payload,metadata:{}}}).id,'w1');
});
