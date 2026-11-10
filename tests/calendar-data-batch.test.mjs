import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {SITE,publicationDirectory} from '../scripts/site-config.mjs';
import {snapshotForPackets} from '../receiver/build.mjs';
import {publication} from '../contracts/rssd-publication.cjs';
import {writeCalendarData} from '../web/themes/academic/calendar-data.mjs';
import {
  parseCampusPlacement,campusToYearFields,campusGrowId,displayTitle,planBatch,planItem,
  assertLiveBaseline,matchLiveYear,yearReadBackProblems,yearCluster,historyCluster,CAMPUS_CLUSTER
} from '../scripts/calendar-data-records.mjs';
import {
  assertCenterEditorial,assertPublisherUsesCenter,publishPlanned,summarizePlan,runCommand,interruptibleWait,
  STATUS_POLL_LIMIT
} from '../scripts/calendar-data-batch.mjs';

const academicWorkspace={id:'academic',siteId:'scholay-today',writable:true,sections:[{id:'calendar',enabled:true,writable:true},{id:'history',enabled:true,writable:true}]};

const root=dirname(fileURLToPath(import.meta.url));
const campusFile=join(root,'fixtures/calendar-data-batch/campus.json');
const historyFile=join(root,'fixtures/calendar-data-batch/history.json');
const campus=JSON.parse(await readFile(campusFile,'utf8'));
const history=JSON.parse(await readFile(historyFile,'utf8'));
const originalCampus=campus[0];
const addedCampus=campus.slice(1);
const goodHistory=history[0];

const liveYearOriginal={
  id:'year:web_search:fixture:2024-09-02',
  title:'北京大学2024—2025学年研究生新生报到',
  category:CAMPUS_CLUSTER,tags:[CAMPUS_CLUSTER,'报到注册'],
  start:'2024-09-02',end:null,dateBasis:'标题日期',
  summary:originalCampus.article.snippet,sourceName:'北京大学',provenance:'已核验官网'
};
const liveHistoryNoise={id:'hist-live',title:'费希尔论文发表',dateKey:'01-01',year:1922,domain:'统计学史',eventType:'论文发表',importance:'A',factSummary:'已有条目。',historicalSignificance:'已有意义。',sources:[{label:'Crossref',url:'https://api.crossref.org/works/10.1098/rsta.1922.0009'}],preciseToDay:true};
const bulkyLiveYear=Array.from({length:1000},(_,i)=>({id:'keep-year-'+i,title:'既有日程'+i,category:'学术会议',start:'2026-01-01',sourceName:'Fixture'}));
const bulkyLiveHistory=Array.from({length:400},(_,i)=>({id:'keep-history-'+i,title:'既有史事'+i,dateKey:'06-01',year:1900+i%100}));

test('campus seeds become year records in the 培养节点 cluster with start dates',()=>{
  const placed=parseCampusPlacement(originalCampus);
  assert.equal(placed.start,'2024-09-02');assert.equal(placed.end,null);
  const fields=campusToYearFields(originalCampus);
  assert.equal(yearCluster(fields),CAMPUS_CLUSTER);
  assert.equal(fields.title,'北京大学2024—2025学年研究生新生报到');
  assert.equal(fields.start,'2024-09-02');
  assert.equal(fields.sourceUrl,originalCampus.article.url);
  assert.ok(fields.tags.includes('报到注册'));
  const span=campusToYearFields(campus[2]);
  assert.equal(span.start,'2026-01-13');assert.equal(span.end,'2026-02-16');
  assert.equal(displayTitle(campus[2].article.title),'示例大学学生寒假');
});

test('invalid calendar dates are rejected before any write',()=>{
  const badDay={...originalCampus,article:{...originalCampus.article,title:'[2026年2月30日] 不存在的日期',id:1}};
  const year=planItem('year',badDay,{live:[],batch:[badDay]});
  assert.equal(year.status,'invalid');assert.match(year.errors.join(),/日期/);
  const badKey={...goodHistory,key:'bad-date',dateKey:'02-30',title:'无效月日'};
  const hist=planItem('history',badKey,{live:[],batch:[badKey]});
  assert.equal(hist.status,'invalid');assert.match(hist.errors.join(),/记录校验失败|日期/);
});

test('both campus and history batches skip already-public rows and queue only additions',()=>{
  const liveYear=[liveYearOriginal,...bulkyLiveYear.slice(0,2)];
  const liveHistory=[liveHistoryNoise];
  const plan=planBatch({campus,history,liveYear,liveHistory});
  assert.equal(plan.items.find(i=>i.key==='campus-981000').status,'skipped_already_public');
  assert.equal(plan.items.find(i=>i.key==='campus-981358').status,'queued');
  assert.equal(plan.items.find(i=>i.key==='campus-981359').status,'queued');
  assert.equal(plan.items.find(i=>i.key==='history-1801-01-01-ceres').status,'queued');
  assert.equal(plan.items.find(i=>i.key==='history-2019-01-03-change4').status,'queued');
  assert.equal(plan.items.find(i=>i.kind==='history').cluster,'01-01');
  assert.equal(historyCluster(plan.items.find(i=>i.key==='history-2019-01-03-change4').fields),'01-03');
  const summary=summarizePlan(plan);
  assert.equal(summary.skippedAlreadyPublic,1);
  assert.equal(summary.yearQueued,2);
  assert.equal(summary.historyQueued,2);
  assert.equal(liveYear.length,3);assert.equal(liveHistory.length,1);
});

test('already-public matching uses grow identity as well as title+start',()=>{
  const fields=campusToYearFields(originalCampus);
  const growId=campusGrowId(originalCampus);
  const live=[{id:growId+':'+fields.start,title:'其他标题',start:fields.start}];
  assert.equal(matchLiveYear(fields,{live,growId}).status,'already_public');
});

test('same-day similar titles are conflicts, not overwrites',()=>{
  const fields=campusToYearFields(addedCampus[0]);
  const live=[{id:'other',title:'示例大学2026级研究生开学报到注册',start:fields.start,sourceUrl:'https://other.example/x'}];
  assert.equal(matchLiveYear(fields,{live}).status,'conflict');
  const hist=planItem('history',goodHistory,{live:[{title:'皮亚齐发现谷神星（修订）',dateKey:'01-01',year:1801}]});
  assert.equal(hist.status,'conflict');
});

test('incomplete local history/year mirrors are refused as a live baseline',()=>{
  assert.throws(()=>assertLiveBaseline({year:new Array(1000),history:new Array(100)}),/history 快照过小/);
  assert.throws(()=>assertLiveBaseline({year:new Array(50),history:new Array(500)}),/year 快照过小/);
  const ok=assertLiveBaseline({year:bulkyLiveYear,history:bulkyLiveHistory});
  assert.equal(ok.year,1000);assert.equal(ok.history,400);
});

test('authorized publish refuses a local live snapshot substitute',async()=>{
  await assert.rejects(runCommand('publish',{
    campusPath:campusFile,historyPath:historyFile,
    liveYear:bulkyLiveYear,liveHistory:bulkyLiveHistory,
    skipLiveMin:true,authorizePublish:true,dryRun:false,workspace:'/tmp/calendar-data-batch-refused'
  }),/线上 calendar-index/);
});

test('Center editorial is required and the legacy writer is refused',async()=>{
  await assert.rejects(assertCenterEditorial({center:{active:async()=>false}}),/RSSD Center editorial/);
  await assert.rejects(assertPublisherUsesCenter({connection:async()=>({configured:true,origin:SITE.origin,centerManaged:false})}),/不是 Center editorial/);
  await assert.rejects(assertPublisherUsesCenter({connection:async()=>({configured:false,message:'missing'})}),/missing/);
  await assert.rejects(assertCenterEditorial({center:{active:async()=>true,verify:async()=>({workspace:{id:'academic',siteId:'scholay-today',writable:true}})}}),/可写栏目/);
  const ok=await assertCenterEditorial({center:{active:async()=>true,verify:async()=>({workspace:academicWorkspace})}});
  assert.equal(ok.workspace.siteId,'scholay-today');
});

async function publisherFixture(t,{fail}={}){
  const workspace=await mkdtemp(join(tmpdir(),'calendar-data-batch-'));
  t.after(()=>rm(workspace,{recursive:true,force:true}));
  const statePath=join(workspace,'state.json');
  const calls={prepare:0,publish:0,status:0,inspect:0};
  const pages=new Map();
  const fetcher=async url=>{
    const path=new URL(url,'https://today.scholay.com').pathname;
    const page=pages.get(path)||'<html></html>';
    return new Response(page,{status:200});
  };
  const publisher={
    connection:async()=>({configured:true,origin:SITE.origin,centerManaged:true,centerOrigin:'https://center.test'}),
    prepare:async()=>{calls.prepare++;return {prepared:{packetSha256:'packet',requestKey:'req-1'}};},
    inspect:async()=>{calls.inspect++;return {prepared:{packetSha256:'packet',requestKey:'req-1'}};},
    publish:async(id,{packetSha256})=>{
      calls.publish++;assert.equal(packetSha256,'packet');
      if(fail==='auth')throw Object.assign(Error('unauthorized'),{statusCode:401});
      if(fail==='before-receipt')throw Error('interrupted before request');
      await mkdir(join(publicationDirectory(workspace),id),{recursive:true});
      await writeFile(join(publicationDirectory(workspace),id,'receipt.json'),JSON.stringify({requestKey:'req-1'}));
      if(fail==='after-receipt')throw Error('uncertain transport');
    },
    status:async id=>{
      calls.status++;
      if(fail==='unknown')return {stage:'unknown',receipt:{requestKey:'req-1'}};
      const item=currentItem;
      const url=item.kind==='year'?'/calendar/'+item.fields.start+'-x/':'/history/'+item.fields.dateKey.replace('-','')+'-'+item.fields.year+'-x/';
      const sources=item.kind==='year'?item.fields.sourceUrl:item.fields.sources.map(s=>s.url).join('');
      pages.set(url,'<link rel="canonical" href="'+SITE.origin+url+'"><h1>'+item.fields.title+'</h1>'+(item.fields.start||item.fields.year)+sources+(item.fields.category||''));
      return {stage:'published',receipt:{url,requestKey:'req-1'}};
    }
  };
  let currentItem=null;
  const center={active:async()=>true,verify:async()=>({workspace:academicWorkspace})};
  return {workspace,statePath,calls,publisher,center,fetcher,setItem:item=>{currentItem=item;},fail};
}

test('dry-run does not call the publisher and keeps existing public ids',async t=>{
  const f=await publisherFixture(t);
  const liveYear=[liveYearOriginal];
  const plan=planBatch({campus,history,liveYear,liveHistory:[liveHistoryNoise]});
  const preserved=plan.preserved.yearIds.slice();
  const result=await publishPlanned(plan,{...f,dryRun:true,authorizePublish:true});
  assert.equal(result.dryRun,true);assert.equal(f.calls.publish,0);
  assert.deepEqual(plan.preserved.yearIds,preserved);
  assert.ok(preserved.includes(liveYearOriginal.id));
});

test('publish requires explicit authorization',async t=>{
  const f=await publisherFixture(t);
  const plan=planBatch({campus:addedCampus.slice(0,1),history:[],liveYear:[],liveHistory:[]});
  await assert.rejects(publishPlanned(plan,{workspace:f.workspace,publisher:f.publisher,center:f.center,fetcher:f.fetcher,gapMs:0,pauseMs:0}),/authorize-publish/);
});

test('queued campus and history items publish once with per-item receipts',async t=>{
  const f=await publisherFixture(t);
  const plan=planBatch({campus:[originalCampus,addedCampus[0]],history:[history[1]],liveYear:[liveYearOriginal],liveHistory:[liveHistoryNoise]});
  const queued=plan.items.filter(i=>i.status==='queued');
  assert.equal(queued.length,2);
  assert.equal(plan.items.find(i=>i.key==='campus-981000').status,'skipped_already_public');
  let index=0;
  const publisher={...f.publisher,status:async()=>{const item=queued[Math.min(index,queued.length-1)];f.setItem(item);index++;return f.publisher.status(item.key);}};
  const state=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  const published=Object.values(state.entries).filter(s=>s.status==='published');
  assert.equal(published.length,2);
  assert.equal(state.entries['campus-981000'].status,'skipped_already_public');
  assert.equal(f.calls.prepare,2);assert.equal(f.calls.publish,2);
});

test('auth failure is recorded per item and does not mint a second request',async t=>{
  const f=await publisherFixture(t,{fail:'auth'});
  const plan=planBatch({campus:addedCampus.slice(0,1),history:[],liveYear:[],liveHistory:[]});
  f.setItem(plan.items.find(i=>i.status==='queued'));
  const state=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher:f.publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  const row=state.entries['campus-981358'];
  assert.equal(row.status,'auth_failed');assert.equal(f.calls.publish,1);
  const resumed=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher:f.publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  assert.equal(resumed.entries['campus-981358'].id,row.id);
});

test('unknown outcomes are held and not retried',async t=>{
  const f=await publisherFixture(t,{fail:'unknown'});
  const plan=planBatch({campus:addedCampus.slice(0,1),history:[],liveYear:[],liveHistory:[]});
  f.setItem(plan.items.find(i=>i.status==='queued'));
  const first=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher:f.publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  assert.equal(first.entries['campus-981358'].status,'unconfirmed');
  const statusBefore=f.calls.status;
  const second=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher:f.publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  assert.equal(second.entries['campus-981358'].status,'unconfirmed');
  assert.equal(f.calls.publish,1);
  assert.ok(f.calls.status>statusBefore);
});

test('queued past the poll budget becomes published on resume without a second submit',async t=>{
  const f=await publisherFixture(t);
  const plan=planBatch({campus:addedCampus.slice(0,1),history:[],liveYear:[],liveHistory:[]});
  const queued=plan.items.find(i=>i.status==='queued');
  f.setItem(queued);
  let statusCalls=0;
  const publisher={...f.publisher,status:async id=>{
    statusCalls++;
    f.setItem(queued);
    if(statusCalls<=STATUS_POLL_LIMIT)return {stage:'queued',receipt:{requestKey:'req-1'}};
    return f.publisher.status(id);
  }};
  const wait=async()=>{};
  const first=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,wait,log(){}});
  assert.equal(first.entries['campus-981358'].status,'unconfirmed');
  assert.equal(first.entries['campus-981358'].error,'queued');
  assert.equal(f.calls.publish,1);
  assert.equal(statusCalls,STATUS_POLL_LIMIT);
  const resumed=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,wait,log(){}});
  assert.equal(resumed.entries['campus-981358'].status,'published');
  assert.equal(resumed.entries['campus-981358'].id,first.entries['campus-981358'].id);
  assert.equal(f.calls.publish,1);
  assert.ok(statusCalls>STATUS_POLL_LIMIT);
});

test('failed and rejected stages are terminal and are not submitted again',async t=>{
  const f=await publisherFixture(t);
  const plan=planBatch({campus:addedCampus.slice(0,1),history:[],liveYear:[],liveHistory:[]});
  f.setItem(plan.items.find(i=>i.status==='queued'));
  const publisher={...f.publisher,status:async()=>({stage:'failed',receipt:{requestKey:'req-1',job:{error:'receiver failed'}}})};
  const first=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  assert.equal(first.entries['campus-981358'].status,'failed');
  assert.equal(first.entries['campus-981358'].error,'receiver failed');
  const resumed=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher:{...publisher,publish:async()=>{throw Error('must not resubmit');},status:async()=>{throw Error('must not poll terminal failure');}},center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  assert.equal(resumed.entries['campus-981358'].status,'failed');
  assert.equal(resumed.entries['campus-981358'].id,first.entries['campus-981358'].id);
  assert.equal(f.calls.publish,1);
});

test('partial failure publishes the successful item and keeps the failed one for recovery',async t=>{
  const f=await publisherFixture(t);
  const plan=planBatch({campus:addedCampus,history:[],liveYear:[],liveHistory:[]});
  const queued=plan.items.filter(i=>i.status==='queued');
  assert.equal(queued.length,2);
  let publishes=0;
  const publisher={...f.publisher,publish:async(id,args)=>{
    publishes++;
    if(publishes===2)throw Error('second item failed');
    return f.publisher.publish(id,args);
  },status:async id=>{f.setItem(queued[0]);return f.publisher.status(id);}};
  const state=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  const statuses=Object.fromEntries(Object.entries(state.entries).map(([k,v])=>[k,v.status]));
  assert.equal(statuses['campus-981358'],'published');
  assert.equal(statuses['campus-981359'],'error');
});

test('gap 0 stays sequential and does not insert the 75s courtesy sleep',async t=>{
  const f=await publisherFixture(t);
  const plan=planBatch({campus:addedCampus,history:[],liveYear:[],liveHistory:[]});
  const queued=plan.items.filter(i=>i.status==='queued');
  const waits=[];
  let index=0;
  const publisher={...f.publisher,status:async id=>{const item=queued[Math.min(index,queued.length-1)];f.setItem(item);index++;return f.publisher.status(id);}};
  const state=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,wait:async ms=>waits.push(ms),log(){}});
  assert.equal(Object.values(state.entries).filter(s=>s.status==='published').length,2);
  assert.equal(waits.includes(75000),false);
  assert.equal(f.calls.publish,2);
});

test('stop after a confirmed item does not start the next key; resume reuses the same ids',async t=>{
  const f=await publisherFixture(t);
  const plan=planBatch({campus:addedCampus,history:[],liveYear:[],liveHistory:[]});
  const queued=plan.items.filter(i=>i.status==='queued');
  assert.equal(queued.length,2);
  let stop=false,index=0;
  const publisher={...f.publisher,status:async id=>{const item=queued[Math.min(index,queued.length-1)];f.setItem(item);index++;return f.publisher.status(id);}};
  const first=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,shouldStop:()=>stop,log:(key,status)=>{if(status==='published')stop=true;}});
  assert.equal(first.entries['campus-981358'].status,'published');
  assert.equal(first.entries['campus-981359'],undefined);
  assert.equal(f.calls.publish,1);
  const firstId=first.entries['campus-981358'].id;
  stop=false;index=1;
  const resumed=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  assert.equal(resumed.entries['campus-981358'].id,firstId);
  assert.equal(resumed.entries['campus-981358'].status,'published');
  assert.equal(resumed.entries['campus-981359'].status,'published');
  assert.equal(f.calls.publish,2);
});

test('interruptible courtesy wait returns stopped without starting work',async()=>{
  const calls=[];
  const result=await interruptibleWait(5000,async ms=>calls.push(ms),()=>true);
  assert.equal(result,'stopped');
  assert.equal(calls.length,0);
});

test('replay after an uncertain transport reuses the original receipt',async t=>{
  const f=await publisherFixture(t,{fail:'after-receipt'});
  const plan=planBatch({campus:addedCampus.slice(0,1),history:[],liveYear:[],liveHistory:[]});
  f.setItem(plan.items.find(i=>i.status==='queued'));
  const first=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher:f.publisher,center:f.center,fetcher:f.fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  assert.equal(first.entries['campus-981358'].status,'error');
  f.fail=undefined;
  const publisher={...f.publisher,publish:async()=>{throw Error('must not resubmit');},status:async id=>{f.setItem(plan.items.find(i=>i.status==='queued'));return {stage:'published',receipt:{url:'/calendar/2026-09-01-x/',requestKey:'req-1'}};}};
  const page='<link rel="canonical" href="'+SITE.origin+'/calendar/2026-09-01-x/"><h1>示例大学2026级研究生开学报到</h1>2026-09-01https://example.org/graduate/calendar-2026.html培养节点';
  const fetcher=async()=>new Response(page);
  const resumed=await publishPlanned(plan,{workspace:f.workspace,statePath:f.statePath,publisher,center:f.center,fetcher,authorizePublish:true,gapMs:0,pauseMs:0,log(){}});
  assert.equal(resumed.entries['campus-981358'].status,'published');
  assert.equal(f.calls.publish,1);
});

test('year readback requires canonical, date, source and cluster label',()=>{
  const fields=campusToYearFields(addedCampus[0]);
  const url='/calendar/item/';
  const html='<link rel="canonical" href="'+SITE.origin+url+'"><h1>'+fields.title+'</h1>'+fields.start+fields.sourceUrl+CAMPUS_CLUSTER;
  assert.deepEqual(yearReadBackProblems(SITE.origin,url,fields,html),[]);
  assert.ok(yearReadBackProblems(SITE.origin,url,fields,html.replace(fields.start,'')).includes('页面未出现开始日期'));
});

test('receiver snapshot merge keeps existing year/history rows and places new ones in the right cluster',()=>{
  const yearFields=campusToYearFields(addedCampus[0]);
  const hist=history[1];
  const baseline={
    news:[],data:{
      year:[{id:'keep-year',title:'保留日程',category:'学术会议',start:'2026-03-01',summary:'旧',body:'旧正文',sourceName:'旧',sourceUrl:'https://example.org/old'}],
      history:[{id:'keep-history',title:'保留史事',dateKey:'05-01',year:1900,domain:'数学史',eventType:'发现',importance:'B',factSummary:'旧事实',historicalSignificance:'旧意义',sources:[{label:'a',url:'https://example.org/a'}],preciseToDay:true}]
    },
    openSource:{items:[]},permalinks:{'year:keep-year':'/calendar/old/','history:keep-history':'/history/old/'},
    editorialRecords:[{documentId:'doc-year',kind:'year',key:'year:keep-year'},{documentId:'doc-history',kind:'history',key:'history:keep-history'}]
  };
  const yearPacket=publication({version:1,requestId:'year-add',siteId:'scholay-today',workspaceId:'academic',sectionId:'calendar',workId:'work-year',locale:'zh-CN',revision:1,contentHash:'a'.repeat(64),route:'/calendar/2026-09-01-new/',content:{locale:'zh-CN',title:yearFields.title,summary:yearFields.summary,bodyMarkdown:'# '+yearFields.title+'\n\n## 摘要\n\n'+yearFields.summary+'\n\n## 正文\n\n'+yearFields.body,sources:[{title:yearFields.sourceName,url:yearFields.sourceUrl}],metadata:{date:yearFields.start,category:yearFields.category,record:{kind:'year',fields:{category:yearFields.category,tags:yearFields.tags,start:yearFields.start,end:yearFields.end,dateBasis:yearFields.dateBasis,sourceName:yearFields.sourceName,sourceUrl:yearFields.sourceUrl,provenance:yearFields.provenance}}}}});
  const historyPacket=publication({version:1,requestId:'history-add',siteId:'scholay-today',workspaceId:'academic',sectionId:'history',workId:'work-history',locale:'zh-CN',revision:1,contentHash:'b'.repeat(64),route:'/history/0103-2019-new/',content:{locale:'zh-CN',title:hist.title,summary:hist.factSummary,bodyMarkdown:'# '+hist.title+'\n\n## 事实摘要\n\n'+hist.factSummary+'\n\n## 学术意义\n\n'+hist.historicalSignificance,sources:hist.sources.map(s=>({title:s.label,url:s.url})),metadata:{date:'2019-01-03',record:{kind:'history',fields:{dateKey:hist.dateKey,year:hist.year,domain:hist.domain,eventType:hist.eventType,importance:hist.importance,sources:hist.sources,preciseToDay:true}}}}});
  const site={id:'scholay-today',spaceId:'academic',columns:SITE.columns,author:SITE.author,sections:[{id:'calendar',name:'今日学术'},{id:'history',name:'昔日学术'}]};
  const snapshot=snapshotForPackets([yearPacket,historyPacket],site,baseline);
  assert.equal(snapshot.data.year.length,2);assert.equal(snapshot.data.history.length,2);
  assert.equal(snapshot.data.year.find(x=>x.id==='keep-year').title,'保留日程');
  assert.equal(snapshot.data.history.find(x=>x.id==='keep-history').title,'保留史事');
  assert.equal(snapshot.data.year.find(x=>x.start==='2026-09-01').category,CAMPUS_CLUSTER);
  assert.equal(snapshot.data.history.find(x=>x.dateKey==='01-03').year,2019);
  assert.equal(snapshot.news.length,0);
});

test('theme calendar files keep history unchanged when only year is appended',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'calendar-data-theme-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const yearFields=campusToYearFields(addedCampus[0]);
  const hist=history[0];
  const data={year:[{id:'keep',title:'旧',category:'学术会议',tags:[],start:'2026-03-01',summary:'旧',body:'旧',sourceName:'旧',sourceUrl:'https://example.org/old'}],history:[{id:'h1',title:hist.title,dateKey:hist.dateKey,year:hist.year,domain:hist.domain,eventType:hist.eventType,importance:hist.importance,factSummary:hist.factSummary,historicalSignificance:hist.historicalSignificance,sources:hist.sources,preciseToDay:true}]};
  const first=await writeCalendarData(dir,data);
  const second=await writeCalendarData(dir,{...data,year:[...data.year,{id:'new',title:yearFields.title,category:yearFields.category,tags:yearFields.tags,start:yearFields.start,end:yearFields.end,summary:yearFields.summary,body:yearFields.body,sourceName:yearFields.sourceName,sourceUrl:yearFields.sourceUrl,provenance:yearFields.provenance}]});
  assert.equal(second.history,first.history);
  assert.notEqual(second.year,first.year);
});

test('full attached campus and history batches plan additively without writing',async t=>{
  const campusFilePath=process.env.RSSD_CALENDAR_CAMPUS_FIXTURE;
  const historyFilePath=process.env.RSSD_CALENDAR_HISTORY_FIXTURE;
  if(!campusFilePath||!historyFilePath||!existsSync(campusFilePath)||!existsSync(historyFilePath)){t.skip('operator campus/history fixtures not provided');return;}
  const fullCampus=JSON.parse(await readFile(campusFilePath,'utf8'));
  const fullHistory=JSON.parse(await readFile(historyFilePath,'utf8'));
  assert.equal(fullCampus.length,560);assert.equal(fullHistory.length,100);
  const originals=fullCampus.filter(seed=>Number(seed.article.id)>=981000&&Number(seed.article.id)<=981055);
  const liveYear=[];
  for(const seed of originals){
    try{const fields=campusToYearFields(seed);liveYear.push({id:campusGrowId(seed)+':'+fields.start,title:fields.title,start:fields.start,sourceName:fields.sourceName,category:fields.category});}
    catch{/* an original that cannot become a year record is not a public skip fixture */}
  }
  const plan=planBatch({campus:fullCampus,history:fullHistory,liveYear,liveHistory:[]});
  assert.ok(plan.counts.skipped_already_public>=50);
  assert.ok(plan.items.filter(i=>i.kind==='year'&&i.status==='queued').length>=490);
  assert.equal(plan.items.filter(i=>i.kind==='history'&&i.status==='queued').length,100);
  assert.equal(plan.items.filter(i=>i.status==='queued').every(i=>i.fields&&i.markdown),true);
  assert.equal(plan.items.some(i=>i.status==='conflict'&&i.kind==='year'),true);
});
