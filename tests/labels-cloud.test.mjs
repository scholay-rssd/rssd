import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,secret} from '../admin/server.mjs';
import {digest} from '../admin/model.mjs';
import {openLabelsStore,labelMonth,labelBudget,labelsFeed,configureLabelPlatforms,reserveLabelRequest,completeLabelRequest,uncertainLabelRequest,recoverLabelRequests,seedLabelSpend,LABEL_MONTH_LIMIT_MICROS} from '../admin/labels-store.mjs';
import {createLabelsCollector} from '../admin/labels-collector.mjs';
import {LABEL_ENDPOINTS,createTikHubProvider,decodeTikHubLabels} from '../admin/labels-provider.mjs';

const start=Date.parse('2026-10-05T00:00:00Z');
const endpoint=(extra={})=>({id:'fixture-bilibili',platformId:'bilibili',boardLabel:'测试关键词',maxCostMicros:1000,intervalMs:60_000,...extra});
const result=(term='科研')=>({period:'平台当前榜单',rows:[{term,kind:'搜索关键词',rank:1,metric:{label:'热度',value:'1200',unit:'平台指数'},url:'https://www.bilibili.com/search',cookie:'never-project'}],token:'never-project'});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'scholay-labels-cloud-'));const path=join(dir,'labels.sqlite');const db=openLabelsStore(path);t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});return {db,path,dir};}

test('labels GET is read-only, shares existing scopes, and leaves manuscript state independent',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'scholay-labels-api-'));
  const app=await createApp({dbPath:join(dir,'admin.sqlite'),labelsDbPath:join(dir,'labels.sqlite'),origin:'https://today.scholay.com'});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const token=scope=>{const raw=secret();app.db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run(secret(),'fixture',digest(raw),scope,start);return raw;};
  assert.equal((await app.inject('/manage/api/labels')).statusCode,401);
  for(const scope of ['editorial_draft','news_publish','editorial_publish']){
    const response=await app.inject({url:'/manage/api/labels?refresh=1',headers:{authorization:'Bearer '+token(scope)}});
    assert.equal(response.statusCode,200,response.body);const data=response.json();
    assert.equal(data.schemaVersion,1);assert.equal(data.platforms.length,7);assert.equal(data.latest.length,0);assert.equal(data.history.length,0);
    assert(data.platforms.every(item=>item.status==='pending'));assert.equal(data.budget.limitMicros,5_000_000);
  }
  assert.equal((await app.inject({url:'/manage/api/labels',headers:{authorization:'Bearer '+token('ingest')}})).statusCode,403);
  assert.equal((await app.inject({url:'/manage/api/labels',method:'POST',headers:{authorization:'Bearer '+token('editorial_publish')},payload:{collect:true}})).statusCode,404);
  assert.equal(app.labelsDb.prepare('SELECT count(*) AS n FROM label_requests').get().n,0);
  assert.equal(app.labelsDb.prepare('SELECT count(*) AS n FROM label_budget_months').get().n,0);
  assert.equal(app.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'label_%'").get().n,0);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
});
test('provider runs only after a durable reservation, successful snapshots keep stable server identity',async t=>{
  const f=await fixture(t);let now=start,calls=0;
  const collector=createLabelsCollector({db:f.db,endpoints:[endpoint()],clock:()=>now,provider:{async collect(_endpoint,{requestId}){
    calls++;const request=f.db.prepare('SELECT * FROM label_requests WHERE id=?').get(requestId);assert.equal(request.state,'reserved');assert.equal(labelBudget(f.db,now).reservedMicros,1000);
    now+=1234;return result();
  }}});
  const first=await collector.runOnce();assert.equal(first[0].status,'success');assert.equal(calls,1);
  const feed=labelsFeed(f.db,now);assert.equal(feed.latest[0].observedAt,new Date(now).toISOString());assert.equal(feed.latest[0].id,feed.history[0].id);
  assert.equal(feed.latest[0].rows[0].metric.label,'热度');assert(!JSON.stringify(feed).includes('never-project'));
  const duplicate=await collector.runOnce();assert.equal(duplicate[0].status,'already_requested');assert.equal(calls,1);
  assert.deepEqual(labelsFeed(f.db,now).latest,feed.latest);assert.equal(labelBudget(f.db,now).spentMicros,1000);assert.equal(labelBudget(f.db,now).reservedMicros,0);
  const reopened=openLabelsStore(f.path);try{assert.deepEqual(labelsFeed(reopened,now).latest,feed.latest);}finally{reopened.close();}
});
test('endpoint outside whitelist cannot reserve or invoke provider',async t=>{
  const {db}=await fixture(t);let calls=0;
  const collector=createLabelsCollector({db,endpoints:[endpoint()],clock:()=>start,provider:{async collect(){calls++;return result();}}});
  await assert.rejects(collector.collect('unconfirmed-price'),/白名单/);assert.equal(calls,0);assert.equal(db.prepare('SELECT count(*) AS n FROM label_requests').get().n,0);
  assert.throws(()=>createLabelsCollector({db,endpoints:[endpoint({maxCostMicros:0})],provider:{collect(){}}}),/费用/);
});
test('budget is a cross-connection hard cap; rejected requests never run paid work',async t=>{
  const f=await fixture(t);const other=openLabelsStore(f.path);
  try{
  const costly=endpoint({maxCostMicros:2_000_000});configureLabelPlatforms(f.db,[costly]);
  const a=reserveLabelRequest(f.db,costly,start),b=reserveLabelRequest(other,costly,start+60_000);
  assert(a.accepted&&b.accepted);
  const c=reserveLabelRequest(f.db,costly,start+120_000);assert.equal(c.reason,'budget_exhausted');assert.equal(labelBudget(other,start).reservedMicros,4_000_000);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM label_requests').get().n,2);
  completeLabelRequest(f.db,a.request.id,result(),{now:start+120_000});
  assert.equal(labelBudget(other,start).spentMicros+labelBudget(other,start).reservedMicros,4_000_000);
  assert.throws(()=>completeLabelRequest(other,b.request.id,result(),{chargedMicros:2_000_001}),/上限/);
  }finally{other.close();}
});
test('monthly cap stops exactly at five dollars and cache remains available',async t=>{
  const {db}=await fixture(t);const costly=endpoint({maxCostMicros:1_000_000});configureLabelPlatforms(db,[costly]);
  for(let i=0;i<5;i++){const accepted=reserveLabelRequest(db,costly,start+i*60_000);assert(accepted.accepted);completeLabelRequest(db,accepted.request.id,result('科研'+i),{now:start+i*60_000+1});}
  const before=labelsFeed(db,start+300_000);assert.equal(before.budget.spentMicros,LABEL_MONTH_LIMIT_MICROS);assert.equal(before.budget.blocked,true);
  assert.equal(reserveLabelRequest(db,costly,start+300_000).reason,'budget_exhausted');
  assert.deepEqual(labelsFeed(db,start+300_000).latest,before.latest);assert.equal(labelsFeed(db,start+300_000).history.length,5);
});
test('crash and uncertain transport retain reservations across restart and month boundaries',async t=>{
  const f=await fixture(t);const accepted=reserveLabelRequest(f.db,endpoint(),start);assert(accepted.accepted);
  const reopened=openLabelsStore(f.path);try{
    recoverLabelRequests(reopened,start+120_001);assert.equal(reopened.prepare('SELECT state FROM label_requests').get().state,'uncertain');
    assert.equal(labelBudget(reopened,start+120_001).reservedMicros,1000);assert.equal(labelsFeed(reopened,start).latest.length,0);
    const november=Date.parse('2026-11-01T00:00:00Z');assert.equal(labelBudget(reopened,november).remainingMicros,5_000_000);
    completeLabelRequest(reopened,accepted.request.id,result(),{now:november});
    assert.equal(labelBudget(reopened,start).spentMicros,1000);assert.equal(labelBudget(reopened,start).reservedMicros,0);assert.equal(labelBudget(reopened,november).spentMicros,0);
  }finally{reopened.close();}
  assert.equal(labelMonth(Date.parse('2026-10-31T15:59:59Z')),'2026-10');assert.equal(labelMonth(Date.parse('2026-10-31T16:00:00Z')),'2026-11');
});
test('failed/invalid collections keep previous snapshot and do not manufacture history',async t=>{
  const {db}=await fixture(t);let now=start,fail=false;
  const collector=createLabelsCollector({db,endpoints:[endpoint()],clock:()=>now,provider:{async collect(){if(fail)throw Error('private-key-never-report');return result();}}});
  await collector.runOnce();const old=labelsFeed(db,now).latest[0];fail=true;now+=60_000;
  assert.equal((await collector.runOnce())[0].status,'uncertain');const feed=labelsFeed(db,now);
  assert.deepEqual(feed.latest[0],old);assert.equal(feed.history.length,1);assert.equal(feed.budget.reservedMicros,1000);assert(!JSON.stringify(feed).includes('private-key'));
  now+=60_000;const request=reserveLabelRequest(db,endpoint(),now).request;
  assert.throws(()=>completeLabelRequest(db,request.id,{rows:[{term:'bad',kind:'bad',metric:null,url:'http://127.0.0.1/'}]},{now}),/链接/);
  uncertainLabelRequest(db,request.id,now);assert.equal(labelsFeed(db,now).history.length,1);assert.equal(labelBudget(db,now).reservedMicros,2000);
});
test('timeout returns uncertain without releasing the fee reservation',async t=>{
  const {db}=await fixture(t);
  const collector=createLabelsCollector({db,endpoints:[endpoint()],clock:()=>start,timeoutMs:2,provider:{collect(){return new Promise(()=>{});}}});
  assert.equal((await collector.runOnce())[0].status,'uncertain');assert.equal(labelBudget(db,start).reservedMicros,1000);assert.equal(labelsFeed(db,start).history.length,0);
});
test('history keeps sixty real observations and complete latest snapshots share their IDs',async t=>{
  const {db}=await fixture(t);const tiny=endpoint({maxCostMicros:1});configureLabelPlatforms(db,[tiny]);
  for(let i=0;i<65;i++){const now=start+i*60_000,request=reserveLabelRequest(db,tiny,now).request;completeLabelRequest(db,request.id,result('科研'+i),{now:now+1});}
  const feed=labelsFeed(db,start+65*60_000);assert.equal(feed.history.length,60);assert.equal(new Set(feed.history.map(item=>item.id)).size,60);assert.equal(feed.latest[0].id,feed.history[0].id);
  assert.equal(feed.latest[0].rows[0].term,'科研64');assert(Buffer.byteLength(JSON.stringify(feed))<2*1024*1024);
});
test('successful completion is idempotent and rejects oversized public snapshots',async t=>{
  const {db}=await fixture(t);const first=reserveLabelRequest(db,endpoint(),start).request;
  const saved=completeLabelRequest(db,first.id,result(),{now:start+1});
  assert.deepEqual(completeLabelRequest(db,first.id,result('other'),{now:start+2000}),saved);assert.equal(labelBudget(db,start).spentMicros,1000);
  const next=reserveLabelRequest(db,endpoint(),start+60_000).request;
  const tooLarge={rows:Array.from({length:100},(_,i)=>({term:'文'.repeat(230)+i,kind:'关键词',metric:null,url:null}))};
  assert.throws(()=>completeLabelRequest(db,next.id,tooLarge,{now:start+60_001}),/上限/);assert.equal(labelBudget(db,start).reservedMicros,1000);assert.equal(labelsFeed(db,start).history.length,1);
});
test('slot-aligned scheduling tolerates timer jitter without skipping the next collection',async t=>{
  const {db}=await fixture(t);const fourHours=endpoint({intervalMs:4*3600_000});
  const a=reserveLabelRequest(db,fourHours,start+3000);completeLabelRequest(db,a.request.id,result(),{now:start+3500});
  assert.equal(Date.parse(labelsFeed(db,start).platforms[0].nextDueAt),start+4*3600_000);
  assert.equal(reserveLabelRequest(db,fourHours,start+4*3600_000+1000).accepted,true);
});
test('earlier verified label charges can be imported exactly once without resetting reservations',async t=>{
  const {db}=await fixture(t);reserveLabelRequest(db,endpoint(),start);
  const prior={id:'label-diagnostics-202610',month:'2026-10',costMicros:43000};
  assert.equal(seedLabelSpend(db,prior).imported,true);assert.equal(seedLabelSpend(db,prior).imported,false);
  assert.equal(labelBudget(db,start).spentMicros,43000);assert.equal(labelBudget(db,start).reservedMicros,1000);
  assert.throws(()=>seedLabelSpend(db,{...prior,costMicros:42000}),/另一条账目/);
});
// Minimal public-field fixtures preserve the verified 2026-10-05 upstream
// structures. No request traces, cache URLs, signed links, cookies or keys.
const officialBodies={
  bilibili:{code:200,data:{code:0,data:{trending:{list:[{keyword:'科研新闻',heat_score:1200}]}}}},
  douyin:{code:200,data:{status_code:0,item_list:[{title:'科研分享',hot_score:1800,play_count:2300,publish_count:4}]}},
  kuaishou:{code:200,data:{result:1,hots:[{keyword:'学术交流',hotValue:1500,linkUrl:'kwai://must-not-project',viewCount:0}]}},
  xiaohongshu:{code:200,data:{ok:true,success:true,code:1000,data:{sug_items:[{type:'top_note',text:'科研绘图',search_type:'notes'}]}}},
  weibo:{code:200,data:{total:2,data:[{rank:0,is_top:true,keyword:'置顶',heat:''},{rank:1,is_top:false,keyword:'学术会议',heat:'1200'}]}},
  toutiao:{code:200,data:{BaseResp:{StatusCode:0},hot_words:[{keyword:'科研',index:'100',growth:'50',growth_rate:50}]}},
  zhihu:{code:200,data:{data:[{type:'search_result',object:{id:'19556895',name:'<em>科研</em>',type:'topic',followers_count:100}},{type:'search_result',object:{id:'invalid',name:'不接受问题',type:'question'}}]}},
};
test('seven fixed official adapters preserve topic semantics, null rank and suspicious metric exclusion',()=>{
  assert.equal(LABEL_ENDPOINTS.length,7);assert.equal(LABEL_ENDPOINTS.reduce((sum,item)=>sum+item.maxCostMicros,0),16500);
  assert.equal(31*6*LABEL_ENDPOINTS.reduce((sum,item)=>sum+item.maxCostMicros,0),3_069_000);
  for(const item of LABEL_ENDPOINTS){assert.equal(item.intervalMs,4*3600_000);const out=item.decode(officialBodies[item.platformId]);assert.equal(out.rows.length,1);}
  const xhs=decodeTikHubLabels('xiaohongshu',officialBodies.xiaohongshu),zhihu=decodeTikHubLabels('zhihu',officialBodies.zhihu),toutiao=decodeTikHubLabels('toutiao',officialBodies.toutiao);
  assert.equal(xhs.rows[0].rank,null);assert.equal(xhs.rows[0].metric,null);assert.equal(xhs.period,null);
  assert.equal(zhihu.rows[0].rank,null);assert.equal(zhihu.rows[0].term,'科研');assert.equal(zhihu.period,null);
  assert.equal(toutiao.rows[0].metric,null);assert(!JSON.stringify(toutiao).includes('growth'));
  assert.throws(()=>decodeTikHubLabels('xiaohongshu',{code:200,data:{ok:true,success:true,code:1000,data:{word_request_id:'not-a-list'}}}),/结构/);
  assert.throws(()=>decodeTikHubLabels('douyin',{code:200,data:{status_code:1,item_list:[]}}),/未成功/);
  assert.throws(()=>decodeTikHubLabels('bilibili',{code:500,data:officialBodies.bilibili.data}),/未成功/);
});
test('anonymous price verification blocks raised/unknown prices before reserve or paid credential use',async t=>{
  const {db}=await fixture(t);const item=LABEL_ENDPOINTS[0];
  for(const body of [{code:200,data:{endpoint_uri:item.path,endpoint_cost:0.002}},{code:200,data:{endpoint_uri:item.path,endpoint_cost:0.0010004}},{code:200,data:{endpoint_uri:'wrong',endpoint_cost:0.001}},{code:200,data:{endpoint_uri:item.path,endpoint_cost:null}},{code:500,data:{endpoint_uri:item.path,endpoint_cost:0.001}}]){
    let paid=0,anonymous=0;
    const provider=createTikHubProvider({db,token:'fixture-never-real',fetcher:async(url,options)=>{
      if(options.headers?.Authorization){paid++;return Response.json(officialBodies.bilibili);}
      anonymous++;assert.equal(new URL(url).pathname,'/api/v1/tikhub/user/get_endpoint_info');return Response.json(body);
    }});
    const collector=createLabelsCollector({db,endpoints:[item],clock:()=>start,provider});
    assert.equal((await collector.collect(item.id)).status,'price_unavailable');assert.equal(paid,0);assert.equal(anonymous,1);
  }
  const unavailable=createTikHubProvider({db,token:'fixture',fetcher:async()=>{throw Error('network-down');}});
  assert.equal((await createLabelsCollector({db,endpoints:[item],clock:()=>start,provider:unavailable}).collect(item.id)).status,'price_unavailable');
  assert.equal(labelBudget(db,start).reservedMicros,0);assert.equal(db.prepare('SELECT count(*) AS n FROM label_requests').get().n,0);
});
test('accepted official price authorizes one paid request and charges fixed cap despite discounts',async t=>{
  const {db}=await fixture(t);const item=LABEL_ENDPOINTS[4];let paid=0,anonymous=0,now=start;
  const provider=createTikHubProvider({db,token:'fixture-never-real',fetcher:async(url,options)=>{
    assert.equal(new URL(url).hostname,'api.tikhub.io');assert.equal(options.redirect,'error');
    if(options.headers?.Authorization){paid++;assert.equal(labelBudget(db,start).reservedMicros,1500);return Response.json(officialBodies.weibo);}
    anonymous++;assert.equal(new URL(url).searchParams.get('endpoint'),item.path);
    return Response.json({code:200,data:{endpoint_uri:item.path,endpoint_cost:0.0015,allow_discount:true,allow_free_credit:true}});
  }});
  const collector=createLabelsCollector({db,endpoints:[item],clock:()=>now,provider});assert.equal((await collector.collect(item.id)).status,'success');assert.equal(paid,1);assert.equal(anonymous,1);assert.equal(labelBudget(db,start).spentMicros,1500);
  now+=item.intervalMs;assert.equal((await collector.collect(item.id)).status,'success');assert.equal(anonymous,2);assert.equal(paid,2);assert.equal(labelBudget(db,start).spentMicros,3000);
  const request=db.prepare('SELECT id FROM label_requests ORDER BY created DESC LIMIT 1').get();
  await assert.rejects(provider.collect(item,{requestId:request.id,signal:new AbortController().signal}),/费用预留/);assert.equal(paid,2);
});
