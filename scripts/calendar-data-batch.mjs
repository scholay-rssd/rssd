#!/usr/bin/env node
// Supported calendar-data batch entry for 今日学术 (today.scholay.com).
//
//   node scripts/calendar-data-batch.mjs validate --campus <seeds.json> --history <entries.json>
//   node scripts/calendar-data-batch.mjs plan     --campus <seeds.json> --history <entries.json>
//   node scripts/calendar-data-batch.mjs publish  --campus <seeds.json> --history <entries.json>
//                                        --workspace <dir> --authorize-publish
//                                        [--gap 0] [--limit N] [--state <file>]
//
// Additive, identity-aware and idempotent. Existing public year/history rows are
// skipped, never replaced. Publication uses RSSD Center editorial via
// scripts/website-publication.mjs. The retired /manage/api writer, scripts/publish.sh
// and local incomplete history mirrors are refused. Query the original requestKey
// after an unknown or still-queued outcome; do not mint a second request. Resume
// calls status on those rows and records definite failed/rejected terminals.
//
// --gap default 75 is a client courtesy sleep copied from history-batch, not a
// Center, receiver, or site rate. 0 is allowed: the writer still waits for each
// item's public readback (~one serialized receiver build) before the next
// submit. SIGINT/SIGTERM finish the current item, then stop before the next
// key. Resume the same --workspace/--state; published keys are skipped and
// unconfirmed keys are status-only.
import {readFile,writeFile,readdir,mkdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {SITE,publicationDirectory} from './site-config.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {createEditorialCenterTransport} from './rssd-editorial-transport.mjs';
import {recordMarkdown} from './editorial-record.mjs';
import {readBack as historyReadBack} from './history-batch.mjs';
import {loadJsonList,planBatch,assertLiveBaseline,yearReadBackProblems} from './calendar-data-records.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const STATUS_POLL_LIMIT=40;
export const STATUS_POLL_MS=6000;
const SETTLED_STAGES=new Set(['published','failed','rejected','prepared','unknown']);
const TERMINAL_FAILURE=new Set(['failed','rejected']);
const HELD_UNKNOWN=new Set(['unconfirmed','unknown']);
export async function interruptibleWait(ms,wait=sleep,shouldStop){
  if(!Number.isFinite(ms)||ms<=0)return 'ok';
  if(typeof shouldStop!=='function'){await wait(ms);return 'ok';}
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){
    if(shouldStop())return 'stopped';
    await wait(Math.min(1000,Math.max(0,deadline-Date.now())));
  }
  return shouldStop()?'stopped':'ok';
}
export function installStopSignals(log=console.log){
  let stopping=false;
  const on=()=>{if(stopping)return;stopping=true;log('stop_at_boundary','will stop after the current confirmed item');};
  process.on('SIGINT',on);process.on('SIGTERM',on);
  return {shouldStop:()=>stopping,dispose:()=>{process.off('SIGINT',on);process.off('SIGTERM',on);}};
}
const fieldHash=fields=>createHash('sha256').update(JSON.stringify(fields)).digest('hex');
const shanghaiDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const optionalJson=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function atomicJson(path,value){const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});await rename(tmp,path);}

export function arg(argv,name,fallback){const i=argv.indexOf(name);return i>=0?argv[i+1]:fallback;}
export async function loadHistoryInput(path){
  const stat=await import('node:fs/promises').then(fs=>fs.stat(path));
  if(stat.isDirectory()){
    const names=(await readdir(path)).filter(n=>n.endsWith('.json')).sort();
    const out=[];for(const name of names){const entry=JSON.parse(await readFile(join(path,name),'utf8'));entry.key??=name.replace(/\.json$/,'');out.push(entry);}
    return out;
  }
  return loadJsonList(path,readFile);
}

export async function liveCollections(origin=SITE.origin,fetcher=fetch){
  const index=await (await fetcher(origin+'/calendar-index.json',{signal:AbortSignal.timeout(30000)})).json();
  if(index?.version!==1||typeof index.year!=='string'||typeof index.history!=='string')throw Error('线上 calendar-index.json 无效');
  if(!index.year.startsWith('/calendar-data/')||!index.history.startsWith('/calendar-data/'))throw Error('线上日历索引指向了非公开数据路径');
  const year=await (await fetcher(origin+index.year,{signal:AbortSignal.timeout(60000)})).json();
  const history=await (await fetcher(origin+index.history,{signal:AbortSignal.timeout(60000)})).json();
  if(!Array.isArray(year)||!Array.isArray(history))throw Error('线上 year/history 快照不是数组');
  return {index,year,history};
}

export function editorialSectionOpen(workspace,sectionId){
  const section=(workspace?.sections||[]).find(item=>item.id===sectionId);
  return Boolean(section&&section.enabled!==false&&section.writable!==false);
}

export async function assertCenterEditorial({site=SITE,center,fetcher=fetch,centerDirectory}={}){
  const transport=center||createEditorialCenterTransport({site,directory:centerDirectory,fetcher});
  if(!(await transport.active())){
    throw Object.assign(Error('日历数据批量发布必须使用已连接的 RSSD Center editorial；已停用的 /manage/api 内容写入不可用，也不要改用 scripts/publish.sh 部署本地快照。'),{code:'center_required',statusCode:403});
  }
  const verified=await transport.verify({write:true});
  const workspace=verified.workspace||verified;
  if(workspace.siteId&&workspace.siteId!==site.id)throw Object.assign(Error('中心工作空间站点与今日学术不匹配'),{statusCode:403,code:'site_mismatch'});
  if(workspace.writable===false)throw Object.assign(Error('中心工作空间当前不可写'),{statusCode:409,code:'migration_staged'});
  if(!editorialSectionOpen(workspace,'calendar')||!editorialSectionOpen(workspace,'history')){
    throw Object.assign(Error('中心工作空间未开放今日学术或昔日学术可写栏目'),{statusCode:403,code:'section_not_writable'});
  }
  return {transport,workspace};
}

export async function assertPublisherUsesCenter(publisher){
  const conn=await publisher.connection();
  if(!conn?.configured)throw Object.assign(Error(conn?.message||'未配置 RSSD Center 发布连接'),{statusCode:403,code:'auth_failed'});
  if(conn.centerManaged!==true)throw Object.assign(Error('当前发布连接不是 Center editorial。拒绝回退到 /manage/api 或站点令牌直写。'),{statusCode:403,code:'legacy_writer_refused'});
  if(conn.origin&&conn.origin!==SITE.origin)throw Object.assign(Error('发布源与今日学术源不匹配'),{statusCode:403,code:'origin_mismatch'});
  return conn;
}

export function summarizePlan(plan){
  const queued=plan.items.filter(i=>i.status==='queued');
  return {
    destination:plan.destination,live:plan.live,counts:plan.counts,
    queued:queued.length,
    skippedAlreadyPublic:plan.counts.skipped_already_public||0,
    conflicts:plan.counts.conflict||0,
    invalid:plan.counts.invalid||0,
    yearQueued:queued.filter(i=>i.kind==='year').length,
    historyQueued:queued.filter(i=>i.kind==='history').length
  };
}

async function ensureWorkspace(root){
  await mkdir(join(root,'articles'),{recursive:true});await mkdir(join(root,'_ops/inventory'),{recursive:true});
  const index=join(root,'_ops/inventory/article-index.json');
  if(!existsSync(index))await writeFile(index,JSON.stringify({articles:{},cloudArticles:{},annexColumns:[]},null,2)+'\n');
  if(existsSync(join(root,'.site.json')))throw Error('批量工作区不应绑定其他站点');
  return root;
}

async function readBack(kind,origin,url,fields,fetcher){
  const response=await fetcher(origin+url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  const html=await response.text();
  if(kind==='history')return historyReadBack(origin,url,fields,async()=>({ok:response.ok,status:response.status,text:async()=>html}));
  return yearReadBackProblems(origin,url,fields,html,response.ok,response.status);
}

async function pollPublisherStatus(client,id,wait){
  let result;
  for(let i=0;i<STATUS_POLL_LIMIT;i++){
    result=await client.status(id);
    if(SETTLED_STAGES.has(result.stage))break;
    await wait(STATUS_POLL_MS);
  }
  return result;
}

async function settlePublishedResult({s,item,result,origin,fetcher,save,log}){
  s.stage=result.stage;s.url=result.receipt?.url?origin+result.receipt.url:s.url;s.requestKey=result.receipt?.requestKey||s.requestKey;
  if(result.stage==='unknown'){s.status='unconfirmed';s.error='unknown_outcome';await save();log(item.key,'unconfirmed','unknown_outcome_no_retry');return 'held';}
  if(TERMINAL_FAILURE.has(result.stage)){
    s.status=result.stage;s.error=result.receipt?.readbackError||result.receipt?.job?.error||result.stage;await save();log(item.key,s.status,s.error);return 'terminal';
  }
  if(result.stage!=='published'){s.status='unconfirmed';s.error=result.receipt?.readbackError||result.receipt?.job?.error||result.stage;await save();log(item.key,'unconfirmed',s.error);return 'held';}
  const problems=await readBack(item.kind,origin,result.receipt.url,item.fields,fetcher);
  s.readback=problems.length?problems:'ok';s.status=problems.length?'published-readback-issue':'published';s.publishedAt=new Date().toISOString();await save();
  log(item.key,s.status,s.url);
  return s.status;
}

export async function publishPlanned(plan,options={}){
  if(!SITE.legacy||SITE.id!=='scholay-today')throw Error('日历数据批量发布仅支持今日学术');
  if(options.dryRun)return {dryRun:true,summary:summarizePlan(plan),plan};
  if(!options.authorizePublish)throw Error('正式发布需要 --authorize-publish；未带该参数时请使用 validate/plan 或 --dry-run');
  if(!options.workspace)throw Error('批量发布需要 workspace');
  const workspace=await ensureWorkspace(resolve(options.workspace));
  const statePath=resolve(options.statePath||join(workspace,'calendar-data-batch-state.json'));
  await mkdir(join(statePath,'..'),{recursive:true,mode:0o700});
  for(const [name,value] of [['gapMs',options.gapMs??75000],['pauseMs',options.pauseMs??600000]])if(!Number.isFinite(value)||value<0)throw Error(name+' 必须为非负数');
  if(options.limit!==undefined&&options.limit!==Infinity&&(!Number.isSafeInteger(options.limit)||options.limit<0))throw Error('limit 必须为非负整数');
  return withFileLock(statePath+'.lock',()=>runPlanned(plan,{...options,workspace,statePath}));
}

async function runPlanned(plan,{workspace,statePath,gapMs=75000,pauseMs=600000,limit=Infinity,log=console.log,publisher,center,fetcher=fetch,wait=sleep,centerDirectory,shouldStop}={}){
  const root=await ensureWorkspace(resolve(workspace));
  await assertCenterEditorial({center,fetcher,centerDirectory});
  const {createDraft,readDraft}=await import('./editorial-workspace.mjs');
  const {createWebsitePublisher}=await import('./website-publication.mjs');
  const client=publisher||createWebsitePublisher({root,fetcher,centerDirectory});
  const conn=await assertPublisherUsesCenter(client);
  const origin=conn.origin;
  const state=existsSync(statePath)?JSON.parse(await readFile(statePath,'utf8')):{entries:{}};
  if(state.workspace&&state.workspace!==root||state.siteId&&state.siteId!==SITE.id)throw Error('批次状态属于其他工作空间或站点');
  state.workspace=root;state.siteId=SITE.id;state.kind='calendar-data-batch';
  const save=()=>atomicJson(statePath,state);
  await save();
  log('pacing','gap_ms='+gapMs,'pause_ms='+pauseMs,'limit='+(Number.isFinite(limit)?limit:'none'));
  let done=0,first=true;
  for(const item of plan.items){
    if(typeof item?.key!=='string'||!item.key.trim()||item.key.length>200||['__proto__','constructor','prototype'].includes(item.key))throw Error('条目 key 无效');
    const existing=state.entries[item.key];
    if(existing?.status==='published'||existing?.status==='skipped_already_public')continue;
    if(TERMINAL_FAILURE.has(existing?.status)){log(item.key,existing.status,'terminal_no_retry');continue;}
    if(item.status==='skipped_already_public'||item.status==='invalid'||item.status==='conflict'){
      const row=state.entries[item.key]={kind:item.kind,sectionId:item.sectionId,status:item.status,reason:item.match?.reason,publicId:item.match?.item?.id,errors:item.errors};
      await save();log(item.key,item.status,item.errors?.join('; ')||item.match?.reason||row.reason);continue;
    }
    if(done>=limit){log('stop_at_boundary','limit',done);break;}
    if(shouldStop?.()){log('stop_at_boundary',item.key,'not_started');break;}
    const s=state.entries[item.key]||={kind:item.kind,sectionId:item.sectionId};
    const priorReceipt=s.id?await optionalJson(join(publicationDirectory(root),s.id,'receipt.json')):null;
    if(!item.fields||!item.markdown){s.status='invalid';s.errors=['缺少已校验字段'];await save();continue;}
    if(!first){
      const paced=await interruptibleWait(gapMs,wait,shouldStop);
      if(paced==='stopped'||shouldStop?.()){log('stop_at_boundary','after_confirmed_item');break;}
    }
    first=false;
    s.id||=('record-'+randomUUID());await save();
    const id=s.id,dir=join(publicationDirectory(root),id);
    try{
      const fingerprint=fieldHash(item.fields);
      if(s.fieldsSha&&s.fieldsSha!==fingerprint)throw Error('条目已修改，不能复用原发布任务');
      const priorRecord=await optionalJson(join(dir,'record.json'));
      if(priorRecord&&fieldHash(priorRecord.fields||{})!==fingerprint&&fieldHash(priorRecord.fields||{})!==fieldHash({...item.fields,id:priorRecord.fields?.id})){
        // Identity is the original request. A changed payload must not reuse it.
        if(JSON.stringify(priorRecord.fields?.title)!==JSON.stringify(item.fields.title)||priorRecord.kind!==item.kind)throw Error('条目与已有稿件不同，保留原稿与回执');
      }
      s.fieldsSha=fingerprint;s.kind=item.kind;s.sectionId=item.sectionId;await save();
      if(!s.created){
        const column=item.kind==='year'?SITE.columns[3]:SITE.columns[4];
        const draftTitle=item.fields.title.slice(0,120);
        if(priorRecord)await readDraft(id,root);
        else await createDraft({id,title:draftTitle,column,markdown:item.markdown||recordMarkdown(item.kind,item.fields),archiveCategory:column,sectionId:item.sectionId,record:{kind:item.kind,fields:item.fields}},root);
        await mkdir(dir,{recursive:true,mode:0o700});
        await writeFile(join(dir,'metadata.json'),JSON.stringify({date:item.kind==='year'?item.fields.start:`${item.fields.year}-${item.fields.dateKey}`,summary:(item.fields.summary||item.fields.factSummary||'').slice(0,600),author:SITE.author,category:column,sectionId:item.sectionId},null,2),{mode:0o600});
        s.created=true;await save();
      }
      const savedReceipt=await optionalJson(join(dir,'receipt.json'));
      const heldUnknown=HELD_UNKNOWN.has(existing?.status);
      if(!savedReceipt?.requestKey){
        if(heldUnknown){log(item.key,'held_unknown_outcome','保留原 requestKey，不重复提交');continue;}
        const frozen=s.submitted?await client.inspect(id):null;
        if(s.submitted&&!frozen?.prepared)throw Error('找不到原冻结发布包，请核对后恢复；不要重新生成请求');
        const prepared=frozen||await client.prepare(id);
        s.submitted=true;s.requestKey=prepared.prepared?.requestKey||s.requestKey;await save();
        await client.publish(id,{packetSha256:prepared.prepared.packetSha256});
      }
      const result=await pollPublisherStatus(client,id,wait);
      const outcome=await settlePublishedResult({s,item,result,origin,fetcher,save,log});
      if(outcome==='published')done++;
    }catch(e){
      s.status=e.statusCode===401||e.statusCode===403?'auth_failed':'error';
      s.error=e.message;s.code=e.code;await save();log(item.key,s.status,e.message);
      if(e.statusCode>=500||e.statusCode===429){
        const halted=await interruptibleWait(pauseMs,wait,shouldStop);
        if(halted==='stopped'){log('stop_at_boundary',item.key,'after_backoff');break;}
      }
    }
  }
  state.summary={...summarizePlan(plan),published:Object.values(state.entries).filter(x=>x.status==='published').length};
  await save();
  return state;
}

export async function runCommand(command,options){
  const campus=options.campusPath?await loadJsonList(options.campusPath,readFile):[];
  const history=options.historyPath?await loadHistoryInput(options.historyPath):[];
  if(!campus.length&&!history.length)throw Error('需要 --campus 和/或 --history');
  if(command==='publish'&&!options.dryRun&&(options.liveYear||options.liveHistory)){
    throw Error('正式发布必须读取线上 calendar-index.json，不能用本地 year/history 镜像代替公开基线');
  }
  const live=options.liveYear||options.liveHistory
    ?{year:options.liveYear||[],history:options.liveHistory||[]}
    :await liveCollections(options.origin,options.fetcher);
  if(!options.skipLiveMin)assertLiveBaseline(live,{minYear:options.minYear??1000,minHistory:options.minHistory??400});
  const plan=planBatch({campus,history,liveYear:live.year,liveHistory:live.history});
  if(command==='validate'||command==='plan')return {command,summary:summarizePlan(plan),plan};
  if(command!=='publish')throw Error('Usage: calendar-data-batch.mjs validate|plan|publish');
  const published=await publishPlanned(plan,options);
  return {command,summary:published.summary||summarizePlan(plan),state:published,dryRun:published.dryRun===true};
}

async function main(argv){
  const command=argv[0];
  if(!['validate','plan','publish'].includes(command))throw Error('Usage: calendar-data-batch.mjs validate|plan|publish --campus <file> --history <file> [options]');
  const campusPath=arg(argv,'--campus');const historyPath=arg(argv,'--history');
  const liveYearPath=arg(argv,'--live-year');const liveHistoryPath=arg(argv,'--live-history');
  const options={
    campusPath,historyPath,
    liveYear:liveYearPath?JSON.parse(await readFile(liveYearPath,'utf8')):undefined,
    liveHistory:liveHistoryPath?JSON.parse(await readFile(liveHistoryPath,'utf8')):undefined,
    workspace:arg(argv,'--workspace'),
    statePath:arg(argv,'--state'),
    authorizePublish:argv.includes('--authorize-publish'),
    dryRun:argv.includes('--dry-run')||command!=='publish',
    skipLiveMin:argv.includes('--skip-live-min'),
    minYear:arg(argv,'--min-live-year')==null?undefined:Number(arg(argv,'--min-live-year')),
    minHistory:arg(argv,'--min-live-history')==null?undefined:Number(arg(argv,'--min-live-history')),
    gapMs:Number(arg(argv,'--gap',75))*1000,
    pauseMs:Number(arg(argv,'--pause',600))*1000,
    limit:arg(argv,'--limit')==null?Infinity:Number(arg(argv,'--limit')),
    log:(...a)=>console.log(new Date().toISOString(),...a)
  };
  if(command==='publish'&&!options.dryRun&&!options.workspace)throw Error('publish 需要 --workspace（批量稿件目录，不放在仓库里）');
  const stop=command==='publish'&&!options.dryRun?installStopSignals(options.log):null;
  if(stop)options.shouldStop=stop.shouldStop;
  let result;
  try{
    result=await runCommand(command==='publish'&&options.dryRun&&!argv.includes('--authorize-publish')?'plan':command,options);
  }finally{stop?.dispose();}
  const out={command:result.command,summary:result.summary,dryRun:result.dryRun||command!=='publish'};
  if(result.state?.entries){
    const counts={};for(const s of Object.values(result.state.entries))counts[s.status]=(counts[s.status]||0)+1;
    out.receipts=counts;
  }
  console.log(JSON.stringify(out,null,2));
  const failed=result.summary?.invalid||result.summary?.conflicts||(result.state&&Object.values(result.state.entries||{}).some(s=>['invalid','error','unconfirmed','published-readback-issue','auth_failed','conflict','failed','rejected'].includes(s.status)));
  if(failed)process.exitCode=1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
