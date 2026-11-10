#!/usr/bin/env node
// Identity-aware calendar-data records for 今日学术.
// Converts campus GrowSeeds (kind=year) and history entries (kind=history) into
// validated publication fields, then plans additive skips against a live public
// cluster. This module never writes, deploys or talks to the retired manage API.
import {validate} from '../admin/model.mjs';
import {recordMarkdown,recordFields} from './editorial-record.mjs';
import {SITE} from './site-config.mjs';
import {titleKey,similarity,validateEntry as validateHistoryShape} from './history-batch.mjs';

export {titleKey,similarity};
export const YEAR_SECTION='calendar';
export const HISTORY_SECTION='history';
export const CAMPUS_CLUSTER='培养节点';
const PREFIX=/^\[([^\]]+)\]\s*/;
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const DATE_KEY=/^\d{2}-\d{2}$/;
const CAMPUS_INSTRUMENTS=[
  [/毕业生教育|毕业典礼|办理离校|毕业离校/,'毕业离校'],
  [/中期答辩|中期考核|中期检查/,'中期答辩'],
  [/外审|匿名评审|匿名送审|盲审|论文送审|校外送审/,'外审'],
  [/预答辩/,'预答辩'],
  [/开题/,'开题'],
  [/答辩/,'答辩'],
  [/新生报到|报到注册|办理开学注册|学生注册/,'报到注册'],
  [/开学|正式上课|开始上课|正式行课/,'开学'],
  [/放假|寒假|暑假/,'放假'],
  [/期末考试|停课考试|复习考试/,'考试']
];

export function pad(n){return String(n).padStart(2,'0');}
export function isoDay(year,month,day){
  const value=`${year}-${pad(month)}-${pad(day)}`;
  const d=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)return null;
  return value;
}
function civil(year,month,day){
  const iso=isoDay(year,month,day);
  return iso?{year,month,day,iso}:null;
}
export function displayTitle(title){return String(title||'').replace(PREFIX,'').replace(/\s+/g,' ').trim();}
export function normalizeTitle(title){return displayTitle(title).replace(/\s+/g,'').toLowerCase();}
function canonicalUrl(raw){
  if(!raw)return null;
  try{const u=new URL(raw);u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_/i.test(key)||/^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href;}
  catch{return null;}
}
function stableIdHash(value){
  let left=2166136261,right=0x9e3779b9;
  for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);left=Math.imul(left^code,16777619);right=Math.imul(right^code,2246822519);}
  return `${(left>>>0).toString(36)}-${(right>>>0).toString(36)}`;
}
export function campusGrowId(seed){
  const origin=seed?.provenance?.origin||'rss';
  const article=seed?.article||{};
  const source=canonicalUrl(article.url)||`feed:${normalizeTitle(article.feedTitle)}`;
  const fallback=article.url?'':`\n${article.publishedAt||''}\n${article.id}`;
  return `year:${origin}:${stableIdHash(`${source}\n${normalizeTitle(article.title)}${fallback}`)}`;
}
export function campusInstrument(seed){
  const text=`${seed?.article?.title||''} ${seed?.article?.feedTitle||''} ${seed?.article?.snippet||''}`;
  for(const [pattern,name] of CAMPUS_INSTRUMENTS)if(pattern.test(text))return name;
  return seed?.lane==='培养节点'?'开学':'其他';
}

export function parseCampusPlacement(seed){
  const title=String(seed?.article?.title||'');
  const published=String(seed?.article?.publishedAt||'');
  const fallbackYear=/^(\d{4})/.exec(published)?.[1]||/(\d{4})年/.exec(title)?.[1];
  const year=Number(fallbackYear);
  const span=/(\d{4})年(\d{1,2})月(\d{1,2})日\s*[-–—至到]+\s*(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/.exec(title);
  if(span){
    const start=civil(Number(span[1]),Number(span[2]),Number(span[3]));
    const end=civil(Number(span[4]||span[1]),Number(span[5]),Number(span[6]));
    if(!start||!end||end.iso<start.iso)return null;
    const days=Math.round((Date.parse(end.iso+'T00:00:00Z')-Date.parse(start.iso+'T00:00:00Z'))/86400000)+1;
    if(seed?.lane==='培养节点'&&days>90&&/学期|教学安排|校历/.test(title))return {start:start.iso,end:null,dateBasis:'开学节点'};
    return {start:start.iso,end:end.iso,dateBasis:'标题日期'};
  }
  const point=/(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(title)||/^\[(\d{4})-(\d{1,2})-(\d{1,2})\]/.exec(title);
  if(point){
    const start=civil(Number(point[1]),Number(point[2]),Number(point[3]));
    return start?{start:start.iso,end:null,dateBasis:'标题日期'}:null;
  }
  if(Number.isInteger(year)){
    const short=/(\d{1,2})月(\d{1,2})日/.exec(title);
    if(short){
      const start=civil(year,Number(short[1]),Number(short[2]));
      return start?{start:start.iso,end:null,dateBasis:'标题日期'}:null;
    }
  }
  return null;
}

export function campusToYearFields(seed){
  const placed=parseCampusPlacement(seed);
  if(!placed)throw Error('无法从校历条目解析有效日期');
  const article=seed.article||{};
  const title=displayTitle(article.title);
  const instrument=campusInstrument(seed);
  const tags=[...new Set([CAMPUS_CLUSTER,instrument].filter(Boolean))];
  const summary=String(article.snippet||title).trim();
  const sourceUrl=article.url;
  const body=summary+(sourceUrl?`\n\n原始来源：[${article.feedTitle||'来源'}](${sourceUrl})`:'');
  const verified=seed.provenance?.sourceTier==='official'&&seed.provenance?.verification==='verified';
  return {
    title,category:seed.lane==='培养节点'?CAMPUS_CLUSTER:seed.lane||CAMPUS_CLUSTER,tags,
    start:placed.start,end:placed.end,dateBasis:placed.dateBasis,summary,body,bodyTruncated:Boolean(article.bodyTruncated),
    sourceName:String(article.feedTitle||'').trim(),sourceUrl,provenance:verified?'已核验官网':'原文资料',
    reviewedAt:verified?(seed.provenance.reviewedAt||null):null
  };
}

export function campusKey(seed){
  const id=seed?.article?.id;
  if(Number.isSafeInteger(id)&&id>0)return 'campus-'+id;
  const title=displayTitle(seed?.article?.title);
  const url=canonicalUrl(seed?.article?.url)||'';
  return 'campus-'+stableIdHash(`${url}\n${title}`).replace(/[^a-z0-9-]/g,'');
}

export function historyKey(entry){return String(entry?.key||'').trim();}

export function validateCampusSeed(seed,{live=[],batch=[]}={}){
  const errors=[],warnings=[];
  if(!seed||typeof seed!=='object'||Array.isArray(seed))return {ok:false,errors:['校历条目不是对象'],warnings};
  if(!seed.article||typeof seed.article!=='object')errors.push('缺少 article');
  const key=campusKey(seed);
  if(!key||key.length>200||['__proto__','constructor','prototype'].includes(key))errors.push('校历条目 key 无效');
  let fields=null,markdown='',placement=null;
  try{placement=parseCampusPlacement(seed);if(!placement)errors.push('日期无效或无法从标题解析 YYYY-MM-DD');}catch(e){errors.push(e.message);}
  if(!errors.length){
    try{
      const raw=campusToYearFields(seed);
      fields=validate('year',raw,{id:campusGrowId(seed)+':'+raw.start});
      markdown=recordMarkdown('year',fields);
      const back=recordFields('year',{},markdown);
      if(back.summary!==fields.summary||back.title!==fields.title)errors.push('Markdown 无法还原记录字段');
    }catch(e){errors.push('记录校验失败：'+e.message);}
  }
  if(fields?.sourceUrl&&/^https?:\/\/[^/]+\/?$/.test(fields.sourceUrl))errors.push('来源不能是网站首页：'+fields.sourceUrl);
  for(const other of batch){if(other!==seed&&campusKey(other)===key)errors.push('本批内重复：'+key);}
  const match=fields?matchLiveYear(fields,{live,growId:campusGrowId(seed)}):{status:null};
  return {ok:!errors.length,errors,warnings,fields,markdown,key,kind:'year',sectionId:YEAR_SECTION,placement,match,cluster:fields?.category};
}

export function validateHistoryItem(entry,{live=[],batch=[]}={}){
  const shape=validateHistoryShape(entry,{live:[],batch});
  const key=historyKey(entry);
  const match=shape.fields?matchLiveHistory(shape.fields,{live}):{status:null};
  return {...shape,key,kind:'history',sectionId:HISTORY_SECTION,match,cluster:shape.fields?.dateKey,markdown:shape.markdown};
}

export function matchLiveYear(fields,{live=[],growId}={}){
  const start=fields.start,title=titleKey(fields.title),source=canonicalUrl(fields.sourceUrl);
  const expectedId=growId&&start?growId+':'+start:null;
  for(const item of live){
    if(!item||typeof item!=='object')continue;
    if(expectedId&&item.id===expectedId)return {status:'already_public',reason:'id',item};
    if(growId&&typeof item.id==='string'&&item.id.startsWith(growId+':')&&item.start===start)return {status:'already_public',reason:'grow-id',item};
    if(item.start===start&&titleKey(item.title)===title){
      if(source&&canonicalUrl(item.sourceUrl)&&canonicalUrl(item.sourceUrl)!==source)return {status:'conflict',reason:'same-title-date-different-source',item};
      return {status:'already_public',reason:'title-start',item};
    }
    if(source&&canonicalUrl(item.sourceUrl)===source&&item.start===start)return {status:'already_public',reason:'source-start',item};
    if(item.start===start&&similarity(item.title,fields.title)>=0.7)return {status:'conflict',reason:'similar-same-day',item};
  }
  return {status:'new'};
}

export function matchLiveHistory(fields,{live=[]}={}){
  const title=titleKey(fields.title);
  for(const item of live){
    if(!item||typeof item!=='object')continue;
    if(titleKey(item.title)===title&&item.dateKey===fields.dateKey&&item.year===fields.year)return {status:'already_public',reason:'title-date',item};
    if(item.dateKey===fields.dateKey&&item.year===fields.year&&similarity(item.title,fields.title)>=0.5)return {status:'conflict',reason:'similar-same-day',item};
    if(item.dateKey===fields.dateKey&&similarity(item.title,fields.title)>=0.7)return {status:'conflict',reason:'similar-same-dateKey',item};
  }
  return {status:'new'};
}

export function plannedStatus(result){
  if(!result.ok)return 'invalid';
  if(result.match?.status==='already_public')return 'skipped_already_public';
  if(result.match?.status==='conflict')return 'conflict';
  return 'queued';
}

export function planItem(kind,source,{live=[],batch=[]}={}){
  const result=kind==='year'?validateCampusSeed(source,{live,batch}):validateHistoryItem(source,{live,batch});
  const status=plannedStatus(result);
  return {
    key:result.key,kind,sectionId:result.sectionId,status,cluster:result.cluster,
    errors:result.errors,warnings:result.warnings,fields:result.fields,markdown:result.markdown,
    match:result.match,source
  };
}

function snapshotCount(value){return Array.isArray(value)?value.length:0;}
export function assertLiveBaseline(live,{minYear=1000,minHistory=400}={}){
  const year=snapshotCount(live.year),history=snapshotCount(live.history);
  if(year<minYear)throw Error('线上 year 快照过小（'+year+' < '+minYear+'），拒绝把不完整镜像当作公开基线');
  if(history<minHistory)throw Error('线上 history 快照过小（'+history+' < '+minHistory+'），拒绝把不完整镜像当作公开基线');
  return {year,history};
}

export function planBatch({campus=[],history=[],liveYear=[],liveHistory=[],minYear=0,minHistory=0}={}){
  if(minYear||minHistory)assertLiveBaseline({year:liveYear,history:liveHistory},{minYear,minHistory});
  const yearItems=campus.map(seed=>planItem('year',seed,{live:liveYear,batch:campus}));
  const historyItems=history.map(entry=>planItem('history',entry,{live:liveHistory,batch:history}));
  const items=[...yearItems,...historyItems];
  const counts={queued:0,skipped_already_public:0,conflict:0,invalid:0};
  for(const item of items)counts[item.status]=(counts[item.status]||0)+1;
  const liveYearIds=new Set(liveYear.map(x=>x.id).filter(Boolean));
  const liveHistoryIds=new Set(liveHistory.map(x=>x.id).filter(Boolean));
  return {
    destination:{siteId:SITE.id,origin:SITE.origin,workspaceId:SITE.spaceId,yearSection:YEAR_SECTION,historySection:HISTORY_SECTION},
    live:{year:liveYear.length,history:liveHistory.length,yearIds:liveYearIds.size,historyIds:liveHistoryIds.size},
    counts,items,preserved:{yearIds:[...liveYearIds],historyIds:[...liveHistoryIds]}
  };
}

export async function loadJsonList(path,readFile){
  const value=JSON.parse(await readFile(path,'utf8'));
  if(!Array.isArray(value))throw Error(path+' 必须是 JSON 数组');
  return value;
}

export function yearReadBackProblems(origin,url,fields,html,ok=true,status=200){
  const problems=[];
  if(!ok)problems.push('HTTP '+status);
  if(!html.includes('<link rel="canonical" href="'+origin+url+'">'))problems.push('canonical 不匹配');
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  if(!html.includes(fields.title)&&!html.includes(esc(fields.title)))problems.push('页面未出现标题');
  if(!html.includes(fields.start))problems.push('页面未出现开始日期');
  if(fields.sourceUrl&&!html.includes(fields.sourceUrl)&&!html.includes(esc(fields.sourceUrl)))problems.push('页面缺少来源 '+fields.sourceUrl);
  if(fields.category===CAMPUS_CLUSTER&&!html.includes(CAMPUS_CLUSTER)&&!html.includes(esc(CAMPUS_CLUSTER)))problems.push('页面未出现培养节点栏目');
  return problems;
}

export function historyCluster(fields){
  if(!DATE_KEY.test(fields?.dateKey||''))throw Error('history dateKey 必须是 MM-DD');
  if(!ISO.test('2000-'+fields.dateKey))throw Error('history dateKey 不是有效月日');
  return fields.dateKey;
}
export function yearCluster(fields){
  if(!SITE.yearCategories.includes(fields?.category))throw Error('year category 不在公开栏目簇中');
  if(!ISO.test(fields?.start||''))throw Error('year start 必须是 YYYY-MM-DD');
  return fields.category;
}
