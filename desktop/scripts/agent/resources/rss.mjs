import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {siteForWorkspace} from '../../../../scripts/site-config.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function open(path){
 if(!path||!existsSync(path))throw Error('当前空间没有本地 RSS 库');
 return new DatabaseSync(path,{readOnly:true});
}
export function rssDatabasePath(spaceId,root){
 if(process.env.SCHOLAY_RSS_DB)return process.env.SCHOLAY_RSS_DB;
 if(process.env.SCHOLAY_APP_DATA)return join(process.env.SCHOLAY_APP_DATA,'papr.db');
 const site=root?siteForWorkspace(root):null;
 if((site?.legacy||spaceId==='academic')&&process.env.SCHOLAY_TODAY_DB)return process.env.SCHOLAY_TODAY_DB;
 const global=process.env.SCHOLAY_GLOBAL_APP_DATA;
 if(global)return join(global,...(site?.legacy||spaceId==='academic'?[]:['spaces',spaceId]),'papr.db');
 if(process.env.SCHOLAY_SPACES_ROOT&&spaceId&&spaceId!=='academic')return join(process.env.SCHOLAY_SPACES_ROOT,spaceId,'papr.db');
 return null;
}
export function resolveTimeRange(range,now=new Date()){
 if(!range||range==='all')return {label:'全部',start:null,end:null,dynamic:false};
 if(typeof range==='object'&&range){
  if(range.start&&range.end)return {label:range.label||`${range.start} – ${range.end}`,start:range.start,end:range.end,dynamic:false};
  if(Number.isFinite(Number(range.days)))return resolveTimeRange(Number(range.days)+'d',now);
 }
 const text=String(range);
 const abs=text.match(/^(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?$/);
 if(abs)return {label:abs[2]?`${abs[1]} – ${abs[2]}`:abs[1],start:abs[1]+'T00:00:00.000Z',end:(abs[2]||abs[1])+'T23:59:59.999Z',dynamic:false};
 const days=Number((text.match(/^(\d+)d$/)||[])[1]||(text==='30d'||text==='近 30 天'||text==='last30'?30:text==='7d'||text==='近 7 天'?7:text==='90d'?90:NaN));
 if(!Number.isFinite(days))throw Error('请提供时间范围，例如 30d 或 2026-09-01:2026-10-17');
 const end=new Date(now),start=new Date(now);start.setUTCDate(start.getUTCDate()-days);
 return {label:`近 ${days} 天`,start:start.toISOString(),end:end.toISOString(),dynamic:true,days};
}
function folderTree(db,folderId){
 try{
  return db.prepare('WITH RECURSIVE tree(id) AS (SELECT ? UNION SELECT l.folder_id FROM library_folder_links l JOIN tree t ON l.parent_id=t.id) SELECT id FROM tree').all(folderId).map(r=>r.id);
 }catch{
  return [folderId];
 }
}
function findFolder(db,name){
 const rows=db.prepare('SELECT id,name FROM folders').all();
 const exact=rows.find(r=>r.name===name);if(exact)return exact.id;
 const loose=rows.find(r=>String(r.name).includes(name));
 if(!loose)throw Error('找不到订阅分组：'+name);
 return loose.id;
}
export function listRssLibrary(spaceId,root){
 const path=rssDatabasePath(spaceId,root);
 if(!path||!existsSync(path))return {available:false,reason:'当前空间未配置本地 RSS 库',folders:[],feeds:[],starred:0};
 const db=open(path);
 try{
  const folders=db.prepare('SELECT id,name FROM folders ORDER BY position,name').all();
  const feeds=db.prepare('SELECT id,title,folder_id as folderId FROM feeds WHERE id NOT IN (SELECT feed_id FROM library_archived_feeds)').all();
  const starred=db.prepare('SELECT COUNT(*) AS n FROM articles WHERE is_starred=1').get().n;
  return {available:true,path,folders,feeds,starred};
 }catch(error){
  return {available:false,reason:error.message,folders:[],feeds:[],starred:0};
 }finally{db.close();}
}
export function queryRssArticles(spaceId,root,selector={}){
 const db=open(rssDatabasePath(spaceId,root));
 try{
  let sql=`SELECT a.id,a.feed_id as feedId,f.title as feedTitle,f.folder_id as folderId,a.title,a.url,a.published_at as publishedAt,a.fetched_at as fetchedAt,a.is_starred as starred,substr(COALESCE(a.body_text,''),1,400) as snippet
   FROM articles a JOIN feeds f ON f.id=a.feed_id
   WHERE f.id NOT IN (SELECT feed_id FROM library_archived_feeds)`;
  const binds=[];
  if(selector.articleId){sql+=' AND a.id=?';binds.push(Number(selector.articleId));}
  if(selector.ids?.length){sql+=` AND a.id IN (${selector.ids.map(()=>'?').join(',')})`;binds.push(...selector.ids.map(Number));}
  if(selector.starred)sql+=' AND a.is_starred=1';
  if(selector.feedId){sql+=' AND a.feed_id=?';binds.push(Number(selector.feedId));}
  if(selector.folderId){
   const ids=folderTree(db,Number(selector.folderId));
   sql+=` AND f.folder_id IN (${ids.map(()=>'?').join(',')})`;
   binds.push(...ids);
  }
  if(selector.start){sql+=' AND datetime(COALESCE(a.published_at,a.fetched_at)) >= datetime(?)';binds.push(selector.start);}
  if(selector.end){sql+=' AND datetime(COALESCE(a.published_at,a.fetched_at)) <= datetime(?)';binds.push(selector.end);}
  if(selector.query){sql+=" AND (a.title LIKE ? ESCAPE '\\' OR a.body_text LIKE ? ESCAPE '\\')";const q='%'+String(selector.query).replace(/[%_]/g,'\\$&')+'%';binds.push(q,q);}
  sql+=' ORDER BY datetime(COALESCE(a.published_at,a.fetched_at)) DESC LIMIT ?';
  binds.push(Math.min(200,Number(selector.limit)||80));
  return db.prepare(sql).all(...binds).map(row=>({...row,starred:!!row.starred,missingBody:!row.snippet,dateUnknown:!row.publishedAt}));
 }finally{db.close();}
}
export function readRssArticle(spaceId,root,articleId){
 const db=open(rssDatabasePath(spaceId,root));
 try{
  const row=db.prepare(`SELECT a.id,a.feed_id as feedId,f.title as feedTitle,a.title,a.url,a.published_at as publishedAt,a.fetched_at as fetchedAt,a.body_text as body,a.author
   FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.id=?`).get(Number(articleId));
  if(!row)throw Error('RSS 文章不存在或不属于当前空间');
  let structured=null;
  try{structured=db.prepare('SELECT source_kind as sourceKind,blocks,words,cleaned_at as cleanedAt,error FROM article_structured WHERE article_id=?').get(Number(articleId));}catch{}
  return {...row,structured,missingBody:!row.body,dateUnknown:!row.publishedAt};
 }finally{db.close();}
}
export function browseRss(spaceId,root,query=''){
 const library=listRssLibrary(spaceId,root);
 if(!library.available)return library;
 const q=String(query||'').trim();
 return {
  ...library,
  articles:queryRssArticles(spaceId,root,{query:q||undefined,limit:40}),
  starredArticles:queryRssArticles(spaceId,root,{starred:true,query:q||undefined,limit:20}),
 };
}
export function resolveRssMount(spaceId,root,input,now){
 const range=input.articleId?{label:'单篇',start:null,end:null,dynamic:false}:resolveTimeRange(input.range||input.days||'30d',now);
  let folderId=input.folderId;
  if(!folderId&&input.group){
   const db=open(rssDatabasePath(spaceId,root));
   try{folderId=findFolder(db,input.group);}finally{db.close();}
  }
 const selector={
  articleId:input.articleId,
  starred:input.starred===true||input.collection==='starred',
  feedId:input.feedId,
  folderId,
  start:range.start,
  end:range.end,
  query:input.query,
  limit:input.limit,
 };
 const articles=queryRssArticles(spaceId,root,selector);
 const ids=articles.map(a=>a.id);
 const snapshot={
  collection:input.articleId?'article':selector.starred?'starred':folderId?'folder':input.feedId?'feed':'library',
  folderId,feedId:input.feedId||null,group:input.group||null,
  range:{...range,resolvedAt:(now||new Date()).toISOString()},
  articleIds:ids,
  missingBody:articles.filter(a=>a.missingBody).map(a=>a.id),
  dateUnknown:articles.filter(a=>a.dateUnknown).map(a=>a.id),
 };
 const title=input.articleId?(articles[0]?.title||'RSS 文章'):selector.starred?`星标 · ${range.label} · ${ids.length} 篇`:`${input.group||'RSS 分组'} · ${range.label} · ${ids.length} 篇`;
 return {
  kind:'rss',
  title,
  locator:{collection:snapshot.collection,articleId:input.articleId||null,folderId:folderId||null,feedId:input.feedId||null,group:input.group||null,starred:!!selector.starred},
  version:{contentHash:hash({ids,start:range.start,end:range.end}),label:range.label,snapshot,gaps:[
   ...snapshot.missingBody.length?[`${snapshot.missingBody.length} 篇缺少正文`]:[],
   ...snapshot.dateUnknown.length?[`${snapshot.dateUnknown.length} 篇日期不明`]:[],
  ]},
  state:articles.length?'ready':'failed',
  error:articles.length?undefined:'这个范围没有可访问的 RSS 文章',
  scope:{range:range.dynamic?{days:range.days,dynamic:true}:{start:range.start,end:range.end},query:input.query||'',articleIds:ids},
 };
}
export function searchRssMount(spaceId,root,mount,query){
 const version=mount.version?.snapshot||{};
 const ids=version.articleIds||mount.scope?.articleIds;
 if(!ids?.length)return [];
 return queryRssArticles(spaceId,root,{ids,query,limit:40});
}
