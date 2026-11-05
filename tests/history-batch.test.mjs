import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishEntries} from '../scripts/history-batch.mjs';
import {publicationDirectory,SITE} from '../scripts/site-config.mjs';
import {readFileSync} from 'node:fs';
import {validateEntry,groupedDomains,titleKey,entryMarkdown,readBack} from '../scripts/history-batch.mjs';

const good={key:'1019-1910-chandrasekhar',title:'钱德拉塞卡出生',dateKey:'10-19',year:1910,domain:'天文学史',eventType:'人物诞生',importance:'A',preciseToDay:true,
  factSummary:'1910 年 10 月 19 日，钱德拉塞卡出生于拉合尔。',historicalSignificance:'他给出白矮星质量上限。',
  sources:[{label:'Nobel Prize 传记',url:'https://www.nobelprize.org/prizes/physics/1983/chandrasekhar/biographical/'},{label:'Britannica',url:'https://www.britannica.com/biography/Subrahmanyan-Chandrasekhar'}]};

test('a complete history entry passes and renders the fixed headings',()=>{
  const r=validateEntry(good);
  assert.equal(r.ok,true,r.errors.join('; '));
  assert.match(r.markdown,/^## 事实摘要$/m);
  assert.match(r.markdown,/^## 学术意义$/m);
  assert.equal(entryMarkdown(r.fields),r.markdown);
});

test('entries need two sources on two sites, a precise day and a real date',()=>{
  assert.match(validateEntry({...good,sources:good.sources.slice(0,1)}).errors.join(),/两个不同的来源/);
  assert.match(validateEntry({...good,sources:[good.sources[0],{label:'x',url:'https://www.nobelprize.org/other'}]}).errors.join(),/不同网站/);
  assert.match(validateEntry({...good,sources:[good.sources[0],{label:'home',url:'https://example.org/'}]}).errors.join(),/首页/);
  assert.match(validateEntry({...good,preciseToDay:false}).errors.join(),/preciseToDay/);
  assert.match(validateEntry({...good,dateKey:'02-30'}).errors.join(),/记录校验失败/);
  assert.match(validateEntry({...good,importance:'C'}).errors.join(),/记录校验失败/);
  assert.match(validateEntry({...good,factSummary:'a\n\n## 学术意义\n\nb'}).errors.join(),/标题/);
});

test('duplicates against the live calendar and inside the batch are rejected',()=>{
  const live=[{title:'钱德拉塞卡 出生！',dateKey:'10-19',year:1910}];
  assert.match(validateEntry(good,{live}).errors.join(),/重复/);
  assert.match(validateEntry(good,{live:[{title:'钱德拉塞卡在拉合尔出生',dateKey:'10-19',year:1910}]}).errors.join(),/疑似重复/);
  assert.equal(validateEntry(good,{live:[{title:'卢瑟福逝世',dateKey:'10-19',year:1937}]}).ok,true);
  assert.match(validateEntry(good,{batch:[good,{...good,key:'other'}]}).errors.join(),/本批内重复/);
  assert.equal(titleKey('A, b《c》'),'abc');
});

test('the public theme declares every group domain, including 人文与社会',()=>{
  const domains=groupedDomains(readFileSync(new URL('../web/themes/academic/public/app.js',import.meta.url),'utf8'));
  for(const d of ['统计学史','航天史','经济学史','法学史','文学史','教育史'])assert.ok(domains.has(d),d);
  assert.ok(!domains.has('人文与社会'));
});

test('public readback checks canonical, title, year and sources',async()=>{
  const r=validateEntry(good),url='/history/1019-x/';
  const page='<link rel="canonical" href="https://today.scholay.com'+url+'"><h1>钱德拉塞卡出生</h1>1910'+good.sources.map(s=>'<a href="'+s.url+'">').join('');
  const fetcher=async()=>({ok:true,status:200,text:async()=>page});
  assert.deepEqual(await readBack('https://today.scholay.com',url,r.fields,fetcher),[]);
  const broken=async()=>({ok:true,status:200,text:async()=>page.replace('1910','')});
  assert.deepEqual(await readBack('https://today.scholay.com',url,r.fields,broken),['页面未出现年份']);
});

async function recoveryFixture(t){
 const root=await mkdtemp(join(tmpdir(),'history-batch-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const statePath=join(root,'state.json'),calls={prepare:0,publish:0,status:0,inspect:0},server={fail:'after-receipt'},url='/history/recovery/';
 const page='<link rel="canonical" href="'+SITE.origin+url+'"><h1>'+good.title+'</h1>'+good.year+good.sources.map(s=>s.url).join('');
 const options={workspace:root,statePath,gapMs:0,pauseMs:0,log:()=>{},wait:async()=>{},fetcher:async()=>new Response(page),publisher:{
  connection:async()=>({configured:true,origin:SITE.origin}),
  prepare:async()=>{calls.prepare++;return {prepared:{packetSha256:'original-packet'}};},
  inspect:async()=>{calls.inspect++;return {prepared:{packetSha256:'original-packet'}};},
  publish:async(id,{packetSha256})=>{calls.publish++;assert.equal(packetSha256,'original-packet');if(server.fail==='before-receipt')throw Error('interrupted before request');await writeFile(join(publicationDirectory(root),id,'receipt.json'),JSON.stringify({requestKey:'original-request'}));if(server.fail==='after-receipt')throw Error('uncertain transport');},
  status:async()=>{calls.status++;return {stage:'published',receipt:{url,requestKey:'original-request'}};}
 }};
 return {root,statePath,options,calls,server};
}

test('uncertain history publication queries its original receipt even after the entry goes live',async t=>{
 const f=await recoveryFixture(t),first=await publishEntries([good],f.options);
 assert.equal(first.entries[good.key].status,'error');assert.equal(f.calls.publish,1);
 f.server.fail=null;const resumed=await publishEntries([good],{...f.options,live:[good]});
 assert.equal(resumed.entries[good.key].status,'published');assert.equal(f.calls.publish,1);assert.equal(f.calls.prepare,1);assert.equal(f.calls.status,1);
});

test('an interrupted submission without a receipt reuses the frozen package, never re-prepares',async t=>{
 const f=await recoveryFixture(t);f.server.fail='before-receipt';await publishEntries([good],f.options);
 f.server.fail=null;const resumed=await publishEntries([good],f.options);
 assert.equal(resumed.entries[good.key].status,'published');assert.equal(f.calls.inspect,1);assert.equal(f.calls.prepare,1);assert.equal(f.calls.publish,2);
});

test('history batch recovery rejects changed input and a different workspace',async t=>{
 const f=await recoveryFixture(t);await publishEntries([good],f.options);f.server.fail=null;
 const changed=await publishEntries([{...good,factSummary:good.factSummary+'新的内容。'}],f.options);
 assert.equal(changed.entries[good.key].status,'error');assert.match(changed.entries[good.key].error,/条目已修改/);assert.equal(f.calls.publish,1);
 await assert.rejects(publishEntries([good],{...f.options,workspace:join(f.root,'other')}),/其他工作空间/);
 const stored=JSON.parse(await readFile(f.statePath,'utf8'));assert.equal(stored.entries[good.key].id,changed.entries[good.key].id);
});

test('history batch refuses ambiguous keys and invalid pacing',async t=>{
 assert.match(validateEntry(good,{batch:[good,{...good}]}).errors.join(),/本批内重复/);
 assert.equal(validateEntry({...good,key:'__proto__'}).ok,false);
 const f=await recoveryFixture(t);
 await assert.rejects(publishEntries([good],{...f.options,gapMs:NaN}),/gapMs/);
 await assert.rejects(publishEntries([good],{...f.options,limit:-1}),/limit/);
 assert.equal(f.calls.publish,0);
});
