import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeRecords,collectPages,safeLink,publicationCall,manuscriptBindings} from '../desktop/scripts/publication-center.mjs';
import {buildSeoSite} from '../scripts/build-seo.mjs';

const page=(id,rev=1,more=false)=>({fields:['文章标题','源稿编号','平台','发布状态','作品链接'],data:[['测试文章','source','平台',['已发布'],'[作品](https://example.org/a)']],record_id_list:[id],rev,has_more:more});
test('manuscript links reuse package identity mappings, including legacy RSS IDs',()=>{
  const result=manuscriptBindings({canonical:{shortTitle:'母稿'}},{dated:{stableSlug:'canonical'}},{dated:'RSS-old'});
  assert.deepEqual(result[0].sourceIds,['canonical','dated','RSS-old']);
  assert.throws(()=>manuscriptBindings({one:{},two:{}},{one:{stableSlug:'two'}}),/冲突映射/);
});
test('publication adapter normalizes actual CLI cells and refuses unsafe links and mutation commands',async()=>{
  const [record]=normalizeRecords(page('one'));
  assert.equal(record.status,'已发布');assert.equal(record.url,'https://example.org/a');assert.equal(record.sourceId,'source');
  assert.equal(safeLink('javascript:alert(1)'),'');assert.equal(safeLink('https://user:pass@example.org'),'');
  assert.throws(()=>normalizeRecords({...page('one'),record_id_list:[]}),/结构/);
  await assert.rejects(publicationCall('publish'),/Unknown/);
});
test('Feishu pagination is complete and stable before allowing any cache replacement',async()=>{
  const offsets=[];
  const records=await collectPages(async offset=>{offsets.push(offset);return page(offset?'two':'one',1,!offset);});
  assert.equal(records.length,2);assert.deepEqual(offsets,[0,200]);
  await assert.rejects(collectPages(async offset=>page(offset?'two':'one',offset?2:1,!offset)),/发生变化/);
  await assert.rejects(collectPages(async offset=>page('one',1,!offset)),/重复/);
  await assert.rejects(collectPages(async offset=>{if(offset)throw Error('offline');return page('one',1,true);}),/offline/);
});
test('public catalog includes non-SEO calendar records, whitelists public metadata, and retains dates on rebuild',async t=>{
  const root=await mkdtemp(join(tmpdir(),'scholay-catalog-')),output=join(root,'out');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await cp(new URL('../web/themes/academic/public/index.html',import.meta.url),join(root,'index.html'));
  const verified={id:'verified',title:'已核验',start:'2026-01-01',end:'2026-01-02',sourceUrl:'https://example.org',category:'会议',provenance:'已核验官网',summary:'可公开摘要'};
  await writeFile(join(root,'data.json'),JSON.stringify({year:[verified,{...verified,id:'unverified',provenance:'未核验',privateNote:'SECRET',body:'not part of catalog'}],history:[{id:'history',title:'历史记录',dateKey:'02-29',year:2000,domain:'科学史',sources:[{url:'https://example.org/history'}]}]}));
  await writeFile(join(root,'open-source.json'),JSON.stringify({items:[{title:'项目',url:'https://example.org/tool',date:'2026-01-01'}]}));
  await writeFile(join(root,'news.json'),JSON.stringify({items:[{id:'published-news',title:'已发布新闻',date:'2026-10-02',summary:'公开摘要',category:'学术新闻',author:'Scholay',markdown:'# 正文\n\n正文不进入目录',assets:[]}]}));
  await buildSeoSite({root,output,now:'2026-10-02T00:00:00Z'});
  const raw=await readFile(join(output,'content-catalog.json'),'utf8'),catalog=JSON.parse(raw);
  assert.equal(catalog.items.length,5);
  assert.equal(catalog.items.find(x=>x.key==='year:verified').detailPage,true);
  const unverified=catalog.items.find(x=>x.key==='year:unverified');
  assert.equal(unverified.detailPage,false);assert.equal(unverified.url,'https://today.scholay.com/#/year/unverified');assert.equal(unverified.lastmod,null);
  assert.equal(catalog.items.find(x=>x.kind==='news').articleId,'published-news');
  assert(!raw.includes('SECRET'));assert(!raw.includes('markdown'));assert(!raw.includes('正文不进入目录'));assert(!raw.includes('assets'));
  await buildSeoSite({root,output,now:'2026-10-03T00:00:00Z'});
  assert.equal(await readFile(join(output,'content-catalog.json'),'utf8'),raw);
});
