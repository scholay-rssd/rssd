import {publicationDirectory,siteForWorkspace} from '../../scripts/site-config.mjs';
// Read-only adapters for the native publication center. Never starts a publisher.
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {configuredWorkspace} from '../../scripts/editorial-location.mjs';
import {createWebsitePublisher} from '../../scripts/website-publication.mjs';
import {atomicJson} from '../../scripts/editorial-sync.mjs';
import {cachedRemoteRead,retryAfterMs} from '../../scripts/remote-read-cache.mjs';
import {readLegacyCalendar} from './legacy-calendar.mjs';

const run=promisify(execFile);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const editorial=configuredWorkspace();
const cacheRoot=join(editorial,'.local/publication-center');
const origin=siteForWorkspace(editorial).origin;
const fields=['任务编号','源稿编号','文章标识','文章标题','作品','平台','账号','语言','成稿版本','发布状态','作品链接','后台地址','发布时间','提交时间','最近核查','最后修改时间','证据地址','证据说明','异常说明','下一步','实际外链属性','外链方式','蓝链结果','域名植入结果','收录状态'];
export const cellText=value=>Array.isArray(value)?value.map(cellText).filter(Boolean).join('、'):value&&typeof value==='object'?cellText(value.text??value.name??value.url??value.link??''):value==null?'':String(value);
export function safeLink(value){
  const text=cellText(value).trim(),link=text.match(/^\[[^\]]*\]\((https?:\/\/[^\s]+)\)$/)?.[1]||text;
  try{const u=new URL(link);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
export function normalizeRecords(data){
  if(!Array.isArray(data.fields)||!Array.isArray(data.data)||!Array.isArray(data.record_id_list)||data.data.length!==data.record_id_list.length)throw Error('飞书记录结构发生变化，本地缓存未更新。');
  return data.data.map((row,i)=>{
    if(!Array.isArray(row)||row.length!==data.fields.length||!data.record_id_list[i])throw Error('飞书记录不完整，本地缓存未更新。');
    const f=Object.fromEntries(data.fields.map((name,j)=>[name,cellText(row[j])]));
    return {id:data.record_id_list[i],taskId:f['任务编号']||'',sourceId:f['源稿编号']||'',title:f['文章标题']||f['作品']||'未命名作品',platform:f['平台']||'未标注平台',account:f['账号']||'',language:f['语言']||'',version:f['成稿版本']||'',status:f['发布状态']||'未标注',url:safeLink(f['作品链接']),managerUrl:safeLink(f['后台地址']),publishedAt:f['发布时间']||'',submittedAt:f['提交时间']||'',checkedAt:f['最近核查']||'',modifiedAt:f['最后修改时间']||'',evidenceUrl:safeLink(f['证据地址']),evidence:(f['证据说明']||'').slice(0,3000),issue:(f['异常说明']||'').slice(0,1500),next:(f['下一步']||'').slice(0,1500),linkAttributes:(f['实际外链属性']||'').slice(0,1500),linkType:f['外链方式']||'',blueLink:f['蓝链结果']||'',domainResult:f['域名植入结果']||'',indexStatus:f['收录状态']||''};
  });
}
// All pages must succeed, with stable revision and distinct IDs, before commit.
export async function collectPages(readPage){
  const rows=[],seen=new Set();let revision;
  for(let page=0;page<100;page++){
    const data=await readPage(page*200);
    if(revision!==undefined&&data.rev!==undefined&&revision!==data.rev)throw Error('台账在刷新过程中发生变化，请重新刷新。');
    revision??=data.rev;
    const records=normalizeRecords(data);
    for(const item of records){if(seen.has(item.id))throw Error('飞书分页包含重复记录，请重新刷新。');seen.add(item.id);rows.push(item);}
    if(!data.has_more)return rows;
    if(!records.length)throw Error('飞书分页未完成，本地缓存未更新。');
  }
  throw Error('台账超过本次读取上限，本地缓存未更新。');
}
async function config(){try{return JSON.parse(await readFile(join(editorial,'.local/publishing/runtime.json'),'utf8')).feishu||{};}catch(e){if(e.code==='ENOENT')return {};throw Error('本机飞书配置无法读取。');}}
const configured=c=>Boolean(c.baseToken&&c.publicationTableId&&c.platformTableId);
const configKey=c=>createHash('sha256').update([c.baseToken,c.publicationTableId,c.platformTableId].join(':')).digest('hex');
async function lark(command,args){
  if(!['+field-list','+record-list','+base-get'].includes(command))throw Error('This adapter only reads Feishu.');
  const bin=['/opt/homebrew/bin/lark-cli','/usr/local/bin/lark-cli'].find(existsSync)||'lark-cli';
  let result;
  try{result=await run(bin,['base',command,...args,'--as','user','--format','json'],{cwd:editorial,timeout:35000,maxBuffer:12*1024*1024,env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}});}
  catch(e){if(e.code==='ENOENT')throw Error('本机未安装飞书 CLI。请按统一工作流完成配置。');throw Error('飞书读取失败，请检查本机登录、表格访问权限和网络；已有缓存保留。');}
  let value;try{value=JSON.parse(result.stdout);}catch{throw Error('飞书返回格式异常，已有缓存保留。');}
  if(value.ok===false)throw Error('飞书未返回可读取的数据，请检查本机授权。');
  return value.data??value;
}
async function readCache(name){try{return JSON.parse(await readFile(join(cacheRoot,name+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('本机发布缓存无法读取，请手动刷新。');}}
async function saveCache(name,value){
  await mkdir(cacheRoot,{recursive:true,mode:0o700});const file=join(cacheRoot,name+'.json'),tmp=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(tmp,file);}finally{await rm(tmp,{force:true});}
}
export function manuscriptBindings(articles,packages,legacyIds={}){
  const drafts=Object.entries(articles).map(([id,x])=>({id,title:x.shortTitle,sourceIds:[id]}));
  const byId=new Map(drafts.map(x=>[x.id,x]));
  const owners=new Map(drafts.map(x=>[x.id,x.id]));
  for(const [slug,mapping] of Object.entries(packages)){
    const draft=byId.get(mapping.stableSlug);if(!draft)continue;
    for(const alias of [slug,legacyIds[slug]].filter(Boolean)){
      if(owners.has(alias)&&owners.get(alias)!==draft.id)throw Error('发布包与母稿存在冲突映射，请检查 package-map.json。');
      owners.set(alias,draft.id);if(!draft.sourceIds.includes(alias))draft.sourceIds.push(alias);
    }
  }
  return drafts;
}
export function manuscriptRegistry(index,packages,legacyIds={}){
  const aliases=Object.fromEntries(Object.values(packages).filter(x=>x.stableSlug).map(x=>[x.stableSlug,{shortTitle:x.stableSlug}]));
  return {drafts:manuscriptBindings(index.articles,packages,legacyIds),bindings:manuscriptBindings({...aliases,...index.cloudArticles,...index.articles},packages,legacyIds)};
}
async function manuscripts(){
  const index=JSON.parse(await readFile(join(editorial,'_ops/inventory/article-index.json'),'utf8'));
  const packagesRoot=join(editorial,'_ops/publishing/article-packages');
  const mapping=JSON.parse(await readFile(join(packagesRoot,'package-map.json'),'utf8'));
  const legacy={};
  for(const slug of Object.keys(mapping.packages)){
    if(!/^[a-z0-9-]+$/.test(slug))throw Error('发布包编号格式异常。');
    try{const value=JSON.parse(await readFile(join(packagesRoot,slug,'platform-config.legacy.json'),'utf8'));if(value.articleId)legacy[slug]=value.articleId;}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return manuscriptRegistry(index,mapping.packages,legacy);
}
export async function refreshFeishu(){
  const c=await config();if(!configured(c))throw Error('请先按统一工作流配置本机飞书发布台账，配置与凭证不随 Git 同步。');
  const args=['--base-token',c.baseToken,'--table-id',c.publicationTableId];
  const schema=await lark('+field-list',[...args,'--limit','200']);
  if(!Array.isArray(schema.fields))throw Error('飞书字段结构异常。');
  const names=new Map(schema.fields.map(f=>[f.name,f.id]));
  for(const name of ['任务编号','源稿编号','文章标题','平台','发布状态','作品链接'])if(!names.has(name))throw Error('发布台账缺少字段：'+name);
  const selected=fields.filter(f=>names.has(f)).flatMap(f=>['--field-id',names.get(f)]);
  const records=await collectPages(offset=>lark('+record-list',[...args,...selected,'--limit','200','--offset',String(offset)]));
  let baseUrl='',linkWarning='';
  try{const base=await lark('+base-get',['--base-token',c.baseToken]);baseUrl=safeLink(base.url||base.base?.url||base.app?.url);}catch{linkWarning='飞书原表入口暂不可用；台账记录已读取。';}
  const value={version:1,configKey:configKey(c),updatedAt:new Date().toISOString(),records,baseUrl,tableId:c.publicationTableId,warning:linkWarning};
  await saveCache('feishu',value);return {...value,configured:true};
}
export async function refreshWebsite({refresh=true}={}){
  const value=await createWebsitePublisher({root:editorial}).catalog({all:true,cache:true,refresh});
  if(value.version!==2||!Array.isArray(value.items)||value.items.length>30000)throw Error('官网目录格式异常。');
  const keys=new Set();for(const item of value.items){
    if(!item.key||keys.has(item.key)||!['year','history','openSource','news'].includes(item.kind)||typeof item.title!=='string'||!safeLink(item.url)||new URL(item.url).origin!==origin)throw Error('官网目录包含无效记录。');
    keys.add(item.key);
  }
  const result={...value};await saveCache('website',result);
  // Incomplete or stale lists are useful for browsing, but cannot establish
  // synchronization versions or imply that missing cloud documents are gone.
  if(!value.partial&&!value.notice)await atomicJson(join(publicationDirectory(editorial) ,'remote-index.json'),{checkedAt:result.updatedAt,items:value.items.map(x=>({id:x.articleId,version:x.version,publishedVersion:x.publishedVersion}))});
  return result;
}
export async function siteCalendar({root:workspace=editorial,fetcher=fetch}={}){
  const site=siteForWorkspace(workspace);
  if(site.legacy)throw Error('学术站使用原有日历');
  return cachedRemoteRead({file:join(workspace,'.local/publication-center/site-calendar-read.json'),identity:JSON.stringify([site.id,site.origin,'calendar']),seed:async()=>{
    // Keep the previous desktop's last good snapshot available offline after
    // upgrading. It must belong to this workspace; it is never treated as fresh.
    try{const old=JSON.parse(await readFile(join(workspace,'.local/publication-center/site-calendar.json'),'utf8'));return old.version===1&&old.siteId===site.id&&Array.isArray(old.records)?old:null;}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}
  },load:async({etag,lastModified})=>{
    const response=await fetcher(site.origin+'/site-content.json',{headers:{...(etag?{'If-None-Match':etag}:lastModified?{'If-Modified-Since':lastModified}:{})},redirect:'error',signal:AbortSignal.timeout(15000)});
    const validators={etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')};
    if(response.status===304)return {notModified:true,...validators};
    if(!response.ok)throw Object.assign(Error('HTTP '+response.status),{statusCode:response.status,retryAfterMs:retryAfterMs(response)});
    const body=await response.text();if(body.length>8*1024*1024)throw Error('日历快照过大');
    const value=JSON.parse(body);
    if(value.version!==1||value.siteId!==site.id||!Array.isArray(value.records))throw Error('日历快照不属于当前站点');
    return {value:{...value,updatedAt:new Date().toISOString()},...validators};
  }});
}
export async function publicationCall(method,params={}){
  if(method==='legacy_calendar')return readLegacyCalendar();
  if(method==='site_calendar')return siteCalendar();
  if(method==='refresh_feishu')return refreshFeishu();
  if(method==='refresh_website')return refreshWebsite({refresh:params.refresh==='auto'?false:params.refresh==='changed'?'changed':true});
  if(method!=='snapshot')throw Error('Unknown publication center operation');
  const c=await config();const [feishu,website,manuscript]=await Promise.all([readCache('feishu'),readCache('website'),manuscripts()]);
  return {feishu:feishu?.configKey===configKey(c)?{...feishu,configured:configured(c)}:{records:[],updatedAt:null,configured:configured(c)},website:website||{items:[],updatedAt:null},...manuscript};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{let input='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin){input+=chunk;if(input.length>4096)throw Error('Request too large');if(input.endsWith('\n'))break;}const {method,params}=JSON.parse(input);process.stdout.write(JSON.stringify(await publicationCall(method,params)));}
  catch(e){process.stderr.write(e.message);process.exitCode=1;}
}
