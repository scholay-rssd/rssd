#!/usr/bin/env node
// Light batch publisher for 昔日学术 (kind=history) records on Scholay Today.
//
//   node scripts/history-batch.mjs validate <entries-dir> [--live <calendar-history.json>]
//   node scripts/history-batch.mjs publish  <entries-dir> --workspace <dir> [--gap 75] [--limit N]
//                                          [--state <file>] [--hold-unlisted-domains] [--pause 600]
//
// Each entry is one JSON file: {key,title,dateKey,year,domain,eventType,importance,
// preciseToDay,sources:[{label,url}],factSummary,historicalSignificance}.
// Entries are validated locally (record schema, at least two sources on two hosts,
// preciseToDay, the 事实摘要 / 学术意义 headings, duplicates against the live calendar),
// then published strictly one at a time through scripts/website-publication.mjs and
// read back on the public site. The token is read only by the publisher
// (SCHOLAY_TODAY_TOKEN_FILE) and never printed.
import {readFile,writeFile,readdir,mkdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {validate} from '../admin/model.mjs';
import {recordMarkdown,recordFields,recordHeadings} from './editorial-record.mjs';
import {SITE} from './site-config.mjs';
import {withFileLock} from './editorial-lock.mjs';

export const REQUIRED_HEADINGS=['事实摘要','学术意义'];
const FIELDS=['title','dateKey','year','domain','eventType','importance','factSummary','historicalSignificance','sources','preciseToDay'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/** Title key for duplicate detection: no punctuation, spaces or case. */
export function titleKey(title){return String(title||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');}
function bigrams(text){const s=titleKey(text),out=new Set();for(let i=0;i<s.length-1;i++)out.add(s.slice(i,i+2));return out;}
export function similarity(a,b){const x=bigrams(a),y=bigrams(b);if(!x.size||!y.size)return 0;let n=0;for(const g of x)if(y.has(g))n++;return n/Math.min(x.size,y.size);}

/** Group members declared by the public academic theme (web app.js `historyGroups`). */
export function groupedDomains(source){
  const block=/const historyGroups=\{([\s\S]*?)\n\};/.exec(source);if(!block)return new Set();
  const out=new Set();for(const m of block[1].matchAll(/:\[([^\]]*)\]/g))for(const d of m[1].matchAll(/'([^']+)'/g))out.add(d[1]);return out;
}

/** The Markdown that becomes the record (legacy Today headings: 事实摘要 / 学术意义). */
export function entryMarkdown(entry){return recordMarkdown('history',entry);}

/**
 * Validate one entry locally. Returns {ok, errors, warnings, fields, markdown}.
 * `live` is the public history list; `batch` is the rest of this batch.
 */
export function validateEntry(entry,{live=[],batch=[]}={}){
  const errors=[],warnings=[];
  if(!entry||typeof entry!=='object'||Array.isArray(entry))return {ok:false,errors:['条目不是对象'],warnings};
  if(typeof entry.key!=='string'||!entry.key.trim()||entry.key.length>200||['__proto__','constructor','prototype'].includes(entry.key))errors.push('条目 key 无效');
  for(const key of FIELDS)if(entry[key]===undefined||entry[key]===null||entry[key]==='')errors.push('缺少字段 '+key);
  let fields=null,markdown='';
  try{fields=validate('history',Object.fromEntries(FIELDS.map(k=>[k,entry[k]])),{id:'history:editor:local-check'});}catch(e){errors.push('记录校验失败：'+e.message);}
  if(entry.preciseToDay!==true)errors.push('preciseToDay 必须为 true（只收精确到日的事件）');
  const sources=Array.isArray(entry.sources)?entry.sources:[];
  const urls=new Set(),hosts=new Set();
  for(const s of sources){try{const u=new URL(s.url);urls.add(u.href);hosts.add(u.hostname.replace(/^www\./,''));}catch{errors.push('来源链接无效：'+(s&&s.url));}if(!s?.label)errors.push('来源缺少说明');}
  if(urls.size<2)errors.push('至少需要两个不同的来源链接');
  else if(hosts.size<2)errors.push('两个来源需来自不同网站');
  for(const s of sources)if(s?.url&&/^https?:\/\/[^/]+\/?$/.test(s.url))errors.push('来源不能是网站首页：'+s.url);
  if(fields){
    markdown=entryMarkdown(fields);
    const headings=[...markdown.matchAll(/^## (.+)$/gm)].map(m=>m[1].trim());
    for(const h of REQUIRED_HEADINGS)if(!headings.includes(h))errors.push('缺少二级标题“'+h+'”');
    if(SITE.legacy){try{const back=recordFields('history',{},markdown);if(back.factSummary!==fields.factSummary||back.historicalSignificance!==fields.historicalSignificance)errors.push('Markdown 无法还原记录字段');}catch(e){errors.push(e.message);}}
    else warnings.push('当前站点不是 Today（标题为 '+recordHeadings('history').join('/')+'）');
    if(/^#{1,2} /m.test(fields.factSummary+'\n'+fields.historicalSignificance))errors.push('正文内不能再有一级或二级标题');
  }
  const key=titleKey(entry.title);
  for(const item of live){
    if(titleKey(item.title)===key){errors.push('与线上条目重复：'+item.title+'（'+item.dateKey+'）');continue;}
    if(item.dateKey===entry.dateKey&&item.year===entry.year&&similarity(item.title,entry.title)>=0.5)errors.push('与线上同日同年条目疑似重复：'+item.title);
    else if(item.dateKey===entry.dateKey&&similarity(item.title,entry.title)>=0.7)warnings.push('与线上同日条目相近：'+item.title);
  }
  for(const other of batch){if(other!==entry&&(other.key===entry.key||titleKey(other.title)===key))errors.push('本批内重复：'+other.title);}
  return {ok:!errors.length,errors,warnings,fields,markdown};
}

export async function loadEntries(dir){
  const names=(await readdir(dir)).filter(n=>n.endsWith('.json')).sort();
  const out=[];for(const name of names){const entry=JSON.parse(await readFile(join(dir,name),'utf8'));entry.key??=name.replace(/\.json$/,'');out.push({...entry,file:join(dir,name)});}
  return out;
}

export async function liveHistory(origin=SITE.origin,fetcher=fetch){
  const index=await (await fetcher(origin+'/calendar-index.json',{signal:AbortSignal.timeout(30000)})).json();
  const response=await fetcher(origin+index.history,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('无法读取线上历史日历（HTTP '+response.status+'）');
  return response.json();
}
export async function liveDomains(origin=SITE.origin,fetcher=fetch){
  const html=await (await fetcher(origin+'/',{signal:AbortSignal.timeout(30000)})).text();
  const src=/src="(\/app\.js[^"]*)"/.exec(html)?.[1]||'/app.js';
  return groupedDomains(await (await fetcher(origin+src,{signal:AbortSignal.timeout(30000)})).text());
}

/** A minimal Today (legacy) workspace that keeps batch drafts out of the repository. */
export async function ensureWorkspace(root){
  await mkdir(join(root,'articles'),{recursive:true});await mkdir(join(root,'_ops/inventory'),{recursive:true});
  const index=join(root,'_ops/inventory/article-index.json');
  if(!existsSync(index))await writeFile(index,JSON.stringify({articles:{},cloudArticles:{},annexColumns:[]},null,2)+'\n');
  if(existsSync(join(root,'.site.json')))throw Error('批量工作区不应绑定其他站点');
  return root;
}

async function atomicJson(path,value){const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});await rename(tmp,path);}
async function optionalJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const fieldHash=fields=>createHash('sha256').update(JSON.stringify(fields)).digest('hex');
const shanghaiDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());

async function probe(origin,fetcher=fetch){const t=Date.now();try{const r=await fetcher(origin+'/',{signal:AbortSignal.timeout(20000)});await r.arrayBuffer();return r.ok?Date.now()-t:Infinity;}catch{return Infinity;}}

/** Additional public detail check after the publisher verifies the record version. */
export async function readBack(origin,url,fields,fetcher=fetch){
  const response=await fetcher(origin+url,{redirect:'error',signal:AbortSignal.timeout(30000)});const html=await response.text();
  const problems=[];
  if(!response.ok)problems.push('HTTP '+response.status);
  if(!html.includes('<link rel="canonical" href="'+origin+url+'">'))problems.push('canonical 不匹配');
  const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  if(!html.includes(fields.title)&&!html.includes(esc(fields.title)))problems.push('页面未出现标题');
  if(!html.includes(String(fields.year)))problems.push('页面未出现年份');
  for(const s of fields.sources)if(!html.includes(s.url)&&!html.includes(esc(s.url)))problems.push('页面缺少来源 '+s.url);
  return problems;
}

export async function publishEntries(entries,options={}){
  if(!SITE.legacy)throw Error('历史批量发布仅支持今日学术');
  if(!options.workspace)throw Error('批量发布需要 workspace');
  const workspace=await ensureWorkspace(resolve(options.workspace)),statePath=resolve(options.statePath||join(workspace,'history-batch-state.json'));
  await mkdir(join(statePath,'..'),{recursive:true,mode:0o700});
  for(const [name,value] of [['gapMs',options.gapMs??75000],['pauseMs',options.pauseMs??600000]])if(!Number.isFinite(value)||value<0)throw Error(name+' 必须为非负数');
  if(options.limit!==undefined&&options.limit!==Infinity&&(!Number.isSafeInteger(options.limit)||options.limit<0))throw Error('limit 必须为非负整数');
  return withFileLock(statePath+'.lock',()=>runEntries(entries,{...options,workspace,statePath}));
}

async function runEntries(entries,{workspace,statePath,gapMs=75000,pauseMs=600000,limit=Infinity,holdDomains=null,live=[],log=console.log,publisher,fetcher=fetch,wait=sleep}={}){
  const root=await ensureWorkspace(resolve(workspace));
  const {createDraft,readDraft}=await import('./editorial-workspace.mjs');
  const {createWebsitePublisher}=await import('./website-publication.mjs');
  const {publicationDirectory}=await import('./site-config.mjs');
  const client=publisher||createWebsitePublisher({root,fetcher});
  const conn=await client.connection();if(!conn.configured)throw Error(conn.message);
  const origin=conn.origin;
  const state=existsSync(statePath)?JSON.parse(await readFile(statePath,'utf8')):{entries:{}};
  if(state.workspace&&state.workspace!==root||state.siteId&&state.siteId!==SITE.id)throw Error('批次状态属于其他工作空间或站点');
  state.workspace=root;state.siteId=SITE.id;
  const save=()=>atomicJson(statePath,state);
  await save();
  let baseline=await probe(origin,fetcher),done=0,first=true;
  for(const entry of entries){
    if(typeof entry?.key!=='string'||!entry.key.trim()||entry.key.length>200||['__proto__','constructor','prototype'].includes(entry.key))throw Error('条目 key 无效');
    const s=state.entries[entry.key]||={};
    if(s.status==='published')continue;
    if(done>=limit)break;
    // A resumed publication may already be visible in the live calendar. Its
    // original receipt, rather than the duplicate detector, settles the task.
    const priorReceipt=s.id?await optionalJson(join(publicationDirectory(root),s.id,'receipt.json')):null;
    const check=validateEntry(entry,{live:priorReceipt?.requestKey?[]:live,batch:entries});
    if(!check.ok){s.status='invalid';s.errors=check.errors;await save();log(entry.key,'invalid',check.errors.join('; '));continue;}
    if(holdDomains&&!holdDomains.has(entry.domain)){s.status='held';s.reason='domain not on live site: '+entry.domain;await save();log(entry.key,'held',entry.domain);continue;}
    if(!first){await wait(gapMs);}
    first=false;
    for(let tries=0;;tries++){const t=await probe(origin,fetcher);if(t!==Infinity&&t<=Math.max(2*baseline,1500))break;log('site slow ('+t+'ms, baseline '+baseline+'ms); pausing');if(tries>=3)throw Error('站点持续变慢，已停止');await wait(pauseMs);}
    s.id||=('record-'+randomUUID());await save();
    const id=s.id,dir=join(publicationDirectory(root),id);
    try{
      const fingerprint=fieldHash(check.fields);
      if(s.fieldsSha&&s.fieldsSha!==fingerprint)throw Error('条目已修改，不能复用原发布任务');
      const priorRecord=await optionalJson(join(dir,'record.json'));
      if(priorRecord&&fieldHash(validate('history',priorRecord.fields,{id:'history:editor:local-check'}))!==fingerprint)throw Error('条目与已有稿件不同，保留原稿与回执');
      s.fieldsSha=fingerprint;await save();
      if(!s.created){
        if(priorRecord){await readDraft(id,root);}else await createDraft({id,title:check.fields.title,column:SITE.columns[4],markdown:check.markdown,archiveCategory:SITE.columns[4],record:{kind:'history',fields:check.fields}},root);
        await mkdir(dir,{recursive:true,mode:0o700});
        await writeFile(join(dir,'metadata.json'),JSON.stringify({date:shanghaiDay(),summary:check.fields.factSummary.slice(0,600),author:SITE.author,category:SITE.columns[4]},null,2),{mode:0o600});
        s.created=true;await save();
      }
      const savedReceipt=await optionalJson(join(dir,'receipt.json'));
      if(!savedReceipt?.requestKey){
        const frozen=s.submitted?await client.inspect(id):null;
        if(s.submitted&&!frozen?.prepared)throw Error('找不到原冻结发布包，请核对后恢复');
        const prepared=frozen||await client.prepare(id);
        s.submitted=true;await save();
        await client.publish(id,{packetSha256:prepared.prepared.packetSha256});
      }
      let result;
      for(let i=0;i<40;i++){result=await client.status(id);if(['published','failed','rejected','prepared','unknown'].includes(result.stage))break;await wait(6000);}
      s.stage=result.stage;s.url=result.receipt?.url?origin+result.receipt.url:s.url;
      if(result.stage!=='published'){s.status='unconfirmed';s.error=result.receipt?.readbackError||result.receipt?.job?.error||result.stage;await save();log(entry.key,'unconfirmed',s.error);continue;}
      const problems=await readBack(origin,result.receipt.url,check.fields,fetcher);
      s.readback=problems.length?problems:'ok';s.status=problems.length?'published-readback-issue':'published';s.publishedAt=new Date().toISOString();await save();
      done++;log(entry.key,s.status,s.url);
      const t=await probe(origin,fetcher);if(t!==Infinity&&baseline!==Infinity)baseline=Math.min(Math.max(baseline,200),Math.round((baseline*3+t)/4));
    }catch(e){s.status='error';s.error=e.message;await save();log(entry.key,'error',e.message);if(e.statusCode>=500||e.statusCode===429)await wait(pauseMs);}
  }
  return state;
}

function arg(argv,name,fallback){const i=argv.indexOf(name);return i>=0?argv[i+1]:fallback;}
async function main(argv){
  const [command,dir]=argv;if(!['validate','publish'].includes(command)||!dir)throw Error('Usage: history-batch.mjs validate|publish <entries-dir> [options]');
  const entries=await loadEntries(dir);
  const live=arg(argv,'--live')?JSON.parse(await readFile(arg(argv,'--live'),'utf8')):await liveHistory();
  if(command==='validate'){
    let bad=0;const domains=argv.includes('--hold-unlisted-domains')?await liveDomains():null;
    for(const e of entries){const r=validateEntry(e,{live,batch:entries});if(!r.ok)bad++;console.log(JSON.stringify({key:e.key,ok:r.ok,held:domains?!domains.has(e.domain):undefined,errors:r.errors,warnings:r.warnings}));}
    if(bad)process.exitCode=1;return;
  }
  const workspace=arg(argv,'--workspace');if(!workspace)throw Error('publish 需要 --workspace（批量稿件目录，不放在仓库里）');
  const state=await publishEntries(entries,{workspace,statePath:arg(argv,'--state',join(workspace,'history-batch-state.json')),gapMs:Number(arg(argv,'--gap',75))*1000,pauseMs:Number(arg(argv,'--pause',600))*1000,limit:Number(arg(argv,'--limit',Infinity)),holdDomains:argv.includes('--hold-unlisted-domains')?await liveDomains():null,live,log:(...a)=>console.log(new Date().toISOString(),...a)});
  const counts={};for(const s of Object.values(state.entries))counts[s.status]=(counts[s.status]||0)+1;console.log(JSON.stringify(counts));
  if(Object.values(state.entries).some(s=>['invalid','error','unconfirmed','published-readback-issue'].includes(s.status)))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))import('./publication-queue-client.mjs').then(({useSharedPublicationQueue})=>{useSharedPublicationQueue();return main(process.argv.slice(2));}).catch(e=>{console.error(e.message);process.exitCode=1;});
