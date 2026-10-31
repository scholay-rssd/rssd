import {SITE} from '../scripts/site-config.mjs';
import {requirePublishSection} from '../contracts/site-sections.mjs';
import {saveSourceArchive,readSourceArchive,readPrivateNotes} from './source-archives.mjs';
import {createDocument,readDocument,saveDocument,setReview,enqueue,pendingDocument} from './store.mjs';
import {digest,fail,validate,sourceKey} from './model.mjs';
import {validateNews,newsFingerprint} from './news.mjs';
import {asEditorialRecord,recordFields,withRecordSourceLinks} from '../scripts/editorial-record.mjs';
import {submitContentAction,contentActionReceipt} from './content-actions.mjs';
import {assertEditionSource} from './language-editions.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';

function findEditorial(db,key){
  if(/^record-[a-f0-9-]{36}$/.test(key))return db.prepare("SELECT id FROM documents WHERE id=? AND kind<>'news'").get(key.slice(7));
  return db.prepare("SELECT id FROM documents WHERE kind='news' AND source_key=?").get('news:'+key);
}

// A new structured record has a client-generated UUID. It is created only at
// version zero; existing records still require an exact kind/identity match.
function editorialInput(db,input){
  const record=input.data?.record;
  if(!record)return {data:validateNews(input.data),record:null};
  if(!['year','history','openSource'].includes(record.kind)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.documentId||'')||input.data.id!=='record-'+record.documentId)fail('官网记录绑定不匹配');
  const found=db.prepare('SELECT id FROM documents WHERE id=?').get(record.documentId);
  const row=found?readDocument(db,found.id):null;
  if(row&&row.kind!==record.kind)fail('官网记录绑定不匹配');
  // Validate the envelope as well so a valid structured record cannot conceal
  // invalid image bytes or unbundled Markdown references.
  const article=validateNews(input.data);
  let prose;try{prose=recordFields(record.kind,record.fields,article.markdown);}catch(e){fail(e.message);}
  const data=validate(record.kind,{...prose,...(article.sectionId?{sectionId:article.sectionId}:{}),assets:article.assets},row?.data||{id:record.kind+':editor:'+record.documentId});
  return {data,record};
}

// One resource link has exactly one record. A second record for the same link
// would break the unique source key, so reject it before anything is written
// and name the existing record: updates must go to that record.
function assertUniqueSource(db,record,data){
  if(record?.kind!=='openSource')return;
  const other=db.prepare('SELECT id,permalink FROM documents WHERE source_key=? AND id<>?').get(sourceKey('openSource',data),record.documentId);
  if(other)throw Object.assign(new Error('该资源链接已有记录，请更新已有记录，不要新建'),{statusCode:409,code:'duplicate_source',existing:{documentId:other.id,articleId:'record-'+other.id,path:other.permalink}});
}

export function newsReceipt(db,entry){
  const job=db.prepare('SELECT id,status,error,release FROM jobs WHERE id=?').get(entry.job_id);
  const row=readDocument(db,entry.document_id);
  return {id:row.id,articleId:row.kind==='news'?row.data.id:'record-'+row.id,revision:entry.revision,url:row.permalink,job};
}
export function submitNews(db,input,actor){
  if(!input||typeof input!=='object')fail('发布请求无效');
  if(typeof input.requestKey!=='string'||!/^[a-zA-Z0-9_-]{12,128}$/.test(input.requestKey))fail('请提供稳定的发布请求编号');
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)fail('请先读取并提供服务器版本');
  const {record,data}=editorialInput(db,input);
  const payloadHash=digest(JSON.stringify({data,record:record?{documentId:record.documentId,kind:record.kind}:null,expectedVersion:input.expectedVersion,...(input.expectedPublishedVersion!==undefined?{expectedPublishedVersion:input.expectedPublishedVersion}:{})}));
  return db.transaction(()=>{
    const old=db.prepare('SELECT * FROM content_requests WHERE key=?').get(input.requestKey);
    if(old){if(old.actor!==actor||old.payload_hash!==payloadHash)fail('请求编号已用于另一份内容',409);return newsReceipt(db,old);}
    // Replayed receipts above remain valid after a section is retired.
    if(data.sectionId)try{requirePublishSection(data.sectionId,SITE);}catch(error){fail(error.message,400);}
    assertEditionSource(db,data);
    assertUniqueSource(db,record,data);
    let existing=record?db.prepare('SELECT id FROM documents WHERE id=?').get(record.documentId):db.prepare('SELECT id FROM documents WHERE source_key=?').get('news:'+data.id);
    let row=existing?readDocument(db,existing.id):null;
    if(row&&db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(row.id))fail('云端作品已删除，请先在后台恢复，不能作为新稿覆盖',409);
    if(input.expectedPublishedVersion!==undefined&&(row?.published_revision??null)!==input.expectedPublishedVersion)fail('官网公开状态已变化，请重新核对',409);
    if((row?.latest_revision||0)!==input.expectedVersion)fail('官网稿件已变化，请读取最新版本并核对差异',409);
    if(row&&pendingDocument(db,row.id))fail('文章已有发布任务，请先查询结果',409);
    if(row){
      if((record?digest(JSON.stringify(row.data))!==digest(JSON.stringify(data)):newsFingerprint(row.data)!==newsFingerprint(data)))row=saveDocument(db,row.id,data,input.expectedVersion,actor,'本地确认的文章修订');
    }else row=createDocument(db,record?.kind||'news',data,actor,record?{documentId:record.documentId}:{});
    setReview(db,row.id,row.latest_revision,'approved',actor);
    const job=enqueue(db,row.id,row.latest_revision,'publish',Date.now(),actor);
    const entry={key:input.requestKey,actor,payload_hash:payloadHash,document_id:row.id,revision:row.latest_revision,job_id:job.id,created:Date.now()};
    db.prepare('INSERT INTO content_requests VALUES(?,?,?,?,?,?,?)').run(...Object.values(entry));
    return newsReceipt(db,entry);
  })();
}

// Retry the original build, never create a revision or change its source data.
// The expected job ID makes a lost retry response safe to query/replay.
export function retryNews(db,key,expectedJobId,actor){
 return db.transaction(()=>{
  const entry=db.prepare('SELECT * FROM content_requests WHERE key=?').get(key);
  if(!entry||entry.actor!==actor)fail('发布请求不存在',404);
  const receipt=newsReceipt(db,entry);
  if(receipt.job.id!==expectedJobId||receipt.job.status!=='failed')return receipt;
  const row=readDocument(db,entry.document_id);
  if(row.latest_revision!==entry.revision||db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(row.id))fail('官网稿件已变化，请读取最新版本并核对差异',409);
  assertEditionSource(db,row.data);
  const job=enqueue(db,row.id,entry.revision,'publish',Date.now(),actor);
  db.prepare('UPDATE content_requests SET job_id=? WHERE key=?').run(job.id,key);
  return newsReceipt(db,{...entry,job_id:job.id});
 })();
}

// Saving a draft never approves it or enqueues a public rebuild.
export function draftReceipt(db,entry){
  const row=readDocument(db,entry.document_id);
  return {requestKey:entry.key,articleId:row.kind==='news'?row.data.id:'record-'+row.id,revision:entry.revision,version:row.latest_revision,publishedVersion:row.published_revision,url:row.permalink,status:'draft_saved'};
}
export function submitNewsDraft(db,input,actor){
  if(!input||!/^[a-zA-Z0-9_-]{12,128}$/.test(input.requestKey||'')||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)fail('草稿请求或基线版本无效');
  if(!(input.expectedPublishedVersion===null||Number.isSafeInteger(input.expectedPublishedVersion)&&input.expectedPublishedVersion>0))fail('请提供已查看的公开状态');
  const {record,data}=editorialInput(db,input);
  const hash=digest(JSON.stringify([data,record?.documentId||null,input.expectedVersion,input.expectedPublishedVersion]));
  return db.transaction(()=>{
    const old=db.prepare('SELECT * FROM content_drafts WHERE key=?').get(input.requestKey);
    if(old){if(old.actor!==actor||old.payload_hash!==hash)fail('请求编号已用于另一份草稿',409);return draftReceipt(db,old);}
    // Replayed receipts above remain valid after a section is retired.
    if(data.sectionId)try{requirePublishSection(data.sectionId,SITE);}catch(error){fail(error.message,400);}
    assertEditionSource(db,data);
    assertUniqueSource(db,record,data);
    const found=record?db.prepare('SELECT id FROM documents WHERE id=?').get(record.documentId):findEditorial(db,data.id);
    let row=found?readDocument(db,found.id):null;
    if(row&&db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(row.id))fail('云端作品已删除',409);
    if((row?.latest_revision||0)!==input.expectedVersion||(row?.published_revision??null)!==input.expectedPublishedVersion)fail('云端内容或公开状态已变化，请取回比较后重试',409);
    if(row&&pendingDocument(db,row.id))fail('作品已有发布任务，请先查询结果',409);
    if(row){if(digest(JSON.stringify(row.data))!==digest(JSON.stringify(data)))row=saveDocument(db,row.id,data,input.expectedVersion,actor,'桌面或智能体保存云端草稿');}
    else row=createDocument(db,record?.kind||'news',data,actor,record?{documentId:record.documentId}:{});
    const entry={key:input.requestKey,actor,payload_hash:hash,document_id:row.id,revision:row.latest_revision,created:Date.now()};
    db.prepare('INSERT INTO content_drafts VALUES(?,?,?,?,?,?)').run(...Object.values(entry));
    return draftReceipt(db,entry);
  })();
}

export function registerNewsApi(app,{db,bearer,session,body,limit}){
  const authorize=request=>request.headers.authorization?bearer(request,['news_publish','editorial_publish']):session(request);
  const readAll=request=>request.headers.authorization?bearer(request,['editorial_publish','editorial_draft']):session(request);
  const manage=request=>request.headers.authorization?bearer(request,['editorial_publish']):session(request);
  // Keyset pagination visits at most 101 published rows. Never select payload
  // or images into the list response, and never expose an administrator draft.
  app.get('/manage/api/news/catalog',async request=>{
    const all=request.query.scope==='all';
    const locale=request.query.locale||'zh-CN';
    if(!['zh-CN',...(SITE.languages||[]).filter(x=>x!=='zh-CN')].includes(locale))fail('文章语言未启用');
    if(request.query.scope&&!['all','published'].includes(request.query.scope))fail('目录范围无效');
    (all?readAll:authorize)(request);limit('editorial-catalog:'+request.actor,90,60000);
    const after=Number(request.query.after||0),size=Number(request.query.limit||80);
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(size)||size<1||size>100)fail('分页参数无效');
    const generation=db.prepare('SELECT coalesce(max(id),0) AS n FROM audit').get().n;
    if(request.query.generation!==undefined&&Number(request.query.generation)!==generation)fail('官网内容在读取期间发生变化，请重新刷新',409);
    const rows=db.prepare(`SELECT d.rowid AS cursor,d.id AS documentId,d.kind,d.source_key AS key,d.permalink AS path,r.version AS revision,d.latest_revision AS version,d.published_revision AS publishedVersion,
      CASE WHEN d.published_revision IS NOT NULL THEN 'published' WHEN EXISTS(SELECT 1 FROM jobs j WHERE j.document_id=d.id AND j.action='withdraw' AND j.status='success') THEN 'withdrawn' ELSE 'unpublished' END AS publicationState,
      json_extract(r.payload,'$.id') AS articleId,json_extract(r.payload,'$.title') AS title,
      coalesce(json_extract(r.payload,'$.summary'),json_extract(r.payload,'$.factSummary'),'') AS summary,
      coalesce(json_extract(r.payload,'$.category'),json_extract(r.payload,'$.domain'),'') AS category,
      json_extract(r.payload,'$.sectionId') AS sectionId,json_extract(r.payload,'$.date') AS date,json_extract(r.payload,'$.start') AS start,json_extract(r.payload,'$.end') AS end,
      json_extract(r.payload,'$.year') AS year,json_extract(r.payload,'$.dateKey') AS dateKey,
      json_extract(r.payload,'$.sourceUrl') AS sourceUrl,json_extract(r.payload,'$.url') AS projectUrl,
      json_extract(r.payload,'$.sources') AS sources,r.created AS modified
      FROM documents d JOIN revisions r ON r.document_id=d.id AND r.version=d.${all?'latest_revision':'published_revision'}
      WHERE d.rowid>? AND ${all?'1':'d.published_revision IS NOT NULL'} AND coalesce(json_extract(r.payload,'$.locale'),'zh-CN')=? AND NOT EXISTS(SELECT 1 FROM document_tombstones t WHERE t.document_id=d.id) ORDER BY d.rowid LIMIT ?`).all(after,locale,size+1);
    const more=rows.length>size,items=rows.slice(0,size).map(row=>({
      key:row.key,documentId:row.documentId,kind:row.kind,articleId:row.kind==='news'?row.articleId:'record-'+row.documentId,
      publicationState:row.publicationState,title:row.title,summary:row.summary.slice(0,1200),category:row.category,...(row.sectionId?{sectionId:row.sectionId}:{}),revision:row.revision,version:row.version,publishedVersion:row.publishedVersion,
      url:SITE.origin+row.path,detailPage:true,lastmod:new Date(row.modified).toISOString(),
      dateLabel:row.kind==='history'?`${row.year} 年 ${row.dateKey}`:row.start?(row.start+(row.end?' — '+row.end:'')):row.date||'',
      sourceUrls:row.sources?JSON.parse(row.sources):row.sourceUrl?[{label:'原始来源',url:row.sourceUrl}]:row.projectUrl?[{label:'项目',url:row.projectUrl}]:[]
    }));
    return {items,generation,scope:all?'all':'published',next:more?rows[size-1].cursor:null};
  });
  app.get('/manage/api/news/index',async request=>{
    readAll(request);limit('editorial-index:'+request.actor,90,60000);
    const locale=request.query.locale||'zh-CN';if(!['zh-CN',...(SITE.languages||[]).filter(x=>x!=='zh-CN')].includes(locale))fail('文章语言未启用');
    const after=Number(request.query.after||0);if(!Number.isSafeInteger(after)||after<0)fail('分页游标无效');
    const generation=db.prepare('SELECT coalesce(max(id),0) AS n FROM audit').get().n;
    if(request.query.generation!==undefined&&Number(request.query.generation)!==generation)fail('官网版本在读取期间变化，请重新刷新',409);
    const rows=db.prepare("SELECT d.rowid AS cursor,d.latest_revision AS version,d.published_revision AS publishedVersion,CASE WHEN d.kind='news' THEN json_extract(r.payload,'$.id') ELSE 'record-'||d.id END AS id,d.permalink AS url FROM documents d JOIN revisions r ON r.document_id=d.id AND r.version=d.latest_revision WHERE d.rowid>? AND coalesce(json_extract(r.payload,'$.locale'),'zh-CN')=? AND NOT EXISTS(SELECT 1 FROM document_tombstones t WHERE t.document_id=d.id) ORDER BY d.rowid LIMIT 101").all(after,locale);
    return {checkedAt:new Date().toISOString(),generation,items:rows.slice(0,100),next:rows.length>100?rows[99].cursor:null};
  });
  app.get('/manage/api/news/published/:key',async request=>{
    authorize(request);
    const found=findEditorial(db,request.params.key);
    if(!found)fail('官网没有这篇文章',404);
    const row=readDocument(db,found.id);if(!row.published||db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(row.id))fail('文章尚未公开或已撤下',409);
    return {revision:row.published_revision,version:row.latest_revision,data:asEditorialRecord(row,row.published),url:row.permalink};
  });
  app.get('/manage/api/news/cloud/:key',async request=>{
    readAll(request);limit('editorial-read:'+request.actor,90,60000);
    const found=findEditorial(db,request.params.key);
    if(!found||db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(found.id))fail('云端作品不存在或已删除',404);
    const row=readDocument(db,found.id);
    return {version:row.latest_revision,publishedVersion:row.published_revision,data:asEditorialRecord(row,row.data),url:row.permalink};
  });
  app.get('/manage/api/news/flow-source/:key',async request=>{
    readAll(request);limit('editorial-flow-read:'+request.actor,60,60000);
    const found=findEditorial(db,request.params.key);
    if(!found||db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(found.id))fail('云端作品不存在或已删除',404);
    const row=readDocument(db,found.id),editorial=withRecordSourceLinks(asEditorialRecord(row,row.data));
    const data={...editorial,assets:(editorial.assets||[]).map(({path})=>({path}))};
    return {version:row.latest_revision,publishedVersion:row.published_revision,sha256:sourceContentSha256(data),...(request.query.identity==='1'?{}:{data}),url:row.permalink};
  });
  app.post('/manage/api/news/source-archives',{bodyLimit:68*1024*1024},async request=>{
    readAll(request);limit('editorial-archive:'+request.actor,10,60000);const input=body(request),found=findEditorial(db,input.articleId);
    if(!found||db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(found.id))fail('云端作品不存在',404);
    return saveSourceArchive(db,input,request.actor,readDocument(db,found.id));
  });
  app.get('/manage/api/news/source-archives/private-notes/:articleId',async request=>{
    readAll(request);limit('editorial-archive-read:'+request.actor,30,60000);
    const found=findEditorial(db,request.params.articleId),revision=request.query.revision===undefined?undefined:Number(request.query.revision);
    if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))fail('版本参数无效');
    if(!found||db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(found.id))fail('云端作品不存在',404);
    return {articleId:request.params.articleId,...readPrivateNotes(db,found.id,revision)};
  });
  app.get('/manage/api/news/source-archives/:key',async request=>{readAll(request);limit('editorial-archive-read:'+request.actor,30,60000);return readSourceArchive(db,request.params.key,request.actor);});
  app.post('/manage/api/news/actions',async request=>{
    manage(request);limit('editorial-actions:'+request.actor,20,60000);
    return submitContentAction(db,body(request),request.actor);
  });
  app.get('/manage/api/news/actions/:key',async request=>{
    manage(request);limit('editorial-action-status:'+request.actor,90,60000);
    const entry=db.prepare('SELECT * FROM content_actions WHERE key=?').get(request.params.key);
    if(!entry||entry.actor!==request.actor)fail('操作请求不存在',404);
    return contentActionReceipt(db,entry);
  });
  app.get('/manage/api/news/:key',async request=>{
    if(request.headers.authorization)bearer(request,['news_publish','editorial_publish','editorial_draft']);else session(request);
    if(request.params.key.startsWith('record-')&&request.headers.authorization)bearer(request,['editorial_publish','editorial_draft']);
    const found=findEditorial(db,request.params.key);
    if(!found)return {version:0,publishedVersion:null,data:null};
    if(db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(found.id))fail('云端作品已删除',410);
    const row=readDocument(db,found.id);
    return {version:row.latest_revision,publishedVersion:row.published_revision,data:asEditorialRecord(row,row.data),published:row.published?asEditorialRecord(row,row.published):null,url:row.permalink};
  });
  app.post('/manage/api/news/drafts',{bodyLimit:4*1024*1024},async request=>{readAll(request);limit('editorial-draft:'+request.actor,20,60000);return submitNewsDraft(db,body(request),request.actor);});
  app.get('/manage/api/news/drafts/requests/:key',async request=>{readAll(request);limit('editorial-draft-status:'+request.actor,90,60000);const entry=db.prepare('SELECT * FROM content_drafts WHERE key=?').get(request.params.key);if(!entry||entry.actor!==request.actor)fail('草稿请求不存在',404);return draftReceipt(db,entry);});
  app.post('/manage/api/news/publish',{bodyLimit:4*1024*1024},async request=>{
    authorize(request);limit('news-publish:'+request.actor,20,60000);
    if(request.body?.data?.record&&request.headers.authorization)bearer(request,['editorial_publish']);
    return submitNews(db,body(request),request.actor);
  });
  app.get('/manage/api/news/requests/:key',async request=>{
    authorize(request);
    const entry=db.prepare('SELECT * FROM content_requests WHERE key=?').get(request.params.key);
    if(!entry||entry.actor!==request.actor)fail('发布请求不存在',404);
    return newsReceipt(db,entry);
  });
  app.post('/manage/api/news/requests/:key/retry',async request=>{
    authorize(request);limit('news-retry:'+request.actor,10,60000);
    const input=body(request);if(typeof input.jobId!=='string'||!input.jobId)fail('任务不存在');
    return retryNews(db,request.params.key,input.jobId,request.actor);
  });
}
