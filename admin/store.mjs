import Database from './sqlite.mjs';
import {mkdirSync,readFileSync,chmodSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest,fail,kinds,permalink,sourceKey,validate,visibleState} from './model.mjs';
import {assertEditionSource} from './language-editions.mjs';

export function openStore(path) {
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const db=new Database(path);
  chmodSync(path,0o600);
  db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,created INTEGER NOT NULL,seen INTEGER NOT NULL,ip TEXT,agent TEXT);
    CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,scope TEXT NOT NULL,created INTEGER NOT NULL,last_used INTEGER,revoked INTEGER);
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,kind TEXT NOT NULL,source_key TEXT UNIQUE NOT NULL,permalink TEXT UNIQUE NOT NULL,latest_revision INTEGER NOT NULL,approved_revision INTEGER,published_revision INTEGER,review_state TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions(document_id TEXT NOT NULL REFERENCES documents(id),version INTEGER NOT NULL,payload TEXT NOT NULL,actor TEXT NOT NULL,note TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(document_id,version));
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),revision INTEGER NOT NULL,action TEXT NOT NULL,status TEXT NOT NULL,scheduled INTEGER NOT NULL,created INTEGER NOT NULL,started INTEGER,finished INTEGER,error TEXT,release TEXT,actor TEXT NOT NULL,snapshot TEXT,snapshot_hash TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_document ON jobs(document_id) WHERE status IN ('queued','running');
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_job ON jobs(status) WHERE status='running';
    CREATE TABLE IF NOT EXISTS site_jobs(id TEXT PRIMARY KEY,action TEXT NOT NULL DEFAULT 'rebuild',status TEXT NOT NULL,scheduled INTEGER NOT NULL,created INTEGER NOT NULL,started INTEGER,finished INTEGER,error TEXT,release TEXT,actor TEXT NOT NULL,snapshot TEXT,snapshot_hash TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_site_build ON site_jobs(action) WHERE status IN ('queued','running');
    CREATE TABLE IF NOT EXISTS job_documents(job_id TEXT NOT NULL REFERENCES jobs(id),document_id TEXT NOT NULL REFERENCES documents(id),revision INTEGER NOT NULL,PRIMARY KEY(job_id,document_id));
    CREATE TABLE IF NOT EXISTS content_requests(key TEXT PRIMARY KEY,actor TEXT NOT NULL,payload_hash TEXT NOT NULL,document_id TEXT NOT NULL,revision INTEGER NOT NULL,job_id TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS document_tombstones(document_id TEXT PRIMARY KEY REFERENCES documents(id),deleted INTEGER NOT NULL,actor TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS content_drafts(key TEXT PRIMARY KEY,actor TEXT NOT NULL,payload_hash TEXT NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),revision INTEGER NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS content_actions(key TEXT PRIMARY KEY,actor TEXT NOT NULL,payload_hash TEXT NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),action TEXT NOT NULL,job_id TEXT,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS source_archives(id TEXT PRIMARY KEY,actor TEXT NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),revision INTEGER NOT NULL,payload BLOB NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT,detail TEXT);
    CREATE INDEX IF NOT EXISTS jobs_document ON jobs(document_id,action,status);
    CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,scheduled,created);
    CREATE INDEX IF NOT EXISTS site_jobs_queue ON site_jobs(status,scheduled,created);
    CREATE INDEX IF NOT EXISTS job_documents_document ON job_documents(document_id);
    CREATE INDEX IF NOT EXISTS source_archives_document ON source_archives(document_id,revision);
  `);
  return db;
}
export function audit(db,actor,action,target='',detail='') {
  db.prepare('INSERT INTO audit(at,actor,action,target,detail) VALUES(?,?,?,?,?)').run(Date.now(),actor,action,target,String(detail).slice(0,1000));
}
export function readDocument(db,id) {
  const row=db.prepare('SELECT * FROM documents WHERE id=?').get(id);if(!row)fail('记录不存在',404);
  const revision=db.prepare('SELECT * FROM revisions WHERE document_id=? AND version=?').get(id,row.latest_revision);
  const published=row.published_revision?db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=?').get(id,row.published_revision):null;
  return {...row,state:visibleState(row),data:JSON.parse(revision.payload),published:published?JSON.parse(published.payload):null};
}
export function createDocument(db,kind,data,actor,{seed=false,key=null,documentId=null}={}) {
  if(documentId&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(documentId))fail('记录编号无效');
  const id=documentId||randomUUID(),now=Date.now(),item=seed?data:validate(kind,data,documentId?{id:kind+':editor:'+documentId}:null),version=1;
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run(id,kind,key||sourceKey(kind,item),permalink(kind,item),version,seed?1:null,seed?1:null,seed?'approved':'draft',now);
  db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?)').run(id,1,JSON.stringify(item),actor,seed?'上线快照导入':'创建草稿',now);
  if(!seed)audit(db,actor,'content.create',id);
  return readDocument(db,id);
}
export function seedStore(db,root) {
  if(db.prepare('SELECT 1 FROM meta WHERE key=?').get('initialized'))return false;
  const data=JSON.parse(readFileSync(join(root,'data.json'),'utf8')),sources=JSON.parse(readFileSync(join(root,'open-source.json'),'utf8'));
  const existingRoutes=(()=>{try{return JSON.parse(readFileSync(join(root,'permalinks.json'),'utf8'));}catch{return {};}})();
  db.transaction(()=>{
    for(const [kind,items] of [['year',data.year],['history',data.history],['openSource',sources.items]]) {
      for(const item of items) {
        const created=createDocument(db,kind,item,'initial-import',{seed:true});
        const route=existingRoutes[sourceKey(kind,item)];
        if(route)db.prepare('UPDATE documents SET permalink=? WHERE id=?').run(route,created.id);
      }
    }
    const {year,history,...dataMeta}=data;const {items,...sourceMeta}=sources;
    for(const [key,value] of [['calendarMeta',dataMeta],['sourceMeta',sourceMeta],['initialized',true]])db.prepare('INSERT INTO meta VALUES(?,?)').run(key,JSON.stringify(value));
    audit(db,'system','snapshot.import','',''+(data.year.length+data.history.length+sources.items.length));
  })();return true;
}
export function saveDocument(db,id,input,expected,actor,note='编辑草稿') {
  return db.transaction(()=>{
    const row=readDocument(db,id);
    if(db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(id)||db.prepare("SELECT 1 FROM jobs WHERE document_id=? AND action='delete' AND status IN ('queued','running')").get(id))fail('记录已删除或正在删除，不能修改',409);
    if(row.latest_revision!==expected)fail('内容已在其他页面更新，请刷新后重试',409);
    const data=validate(row.kind,input,row.data),version=expected+1,now=Date.now();
    db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?)').run(id,version,JSON.stringify(data),actor,note,now);
    db.prepare("UPDATE documents SET latest_revision=?,approved_revision=NULL,review_state='draft',updated=? WHERE id=?").run(version,now,id);
    audit(db,actor,'content.save',id,'revision '+version);return readDocument(db,id);
  })();
}
export function setReview(db,id,version,state,actor) {
  return db.transaction(()=>{
    const row=readDocument(db,id);
    if(db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(id))fail('记录已删除',409);
    if(version!==row.latest_revision)fail('版本已变化，请先刷新',409);
    if(!['review','approved','draft'].includes(state))fail('审核状态无效');
    validate(row.kind,row.data,row.data);
    db.prepare('UPDATE documents SET review_state=?,approved_revision=?,updated=? WHERE id=?').run(state,state==='approved'?version:null,Date.now(),id);
    audit(db,actor,'content.'+state,id,'revision '+version);return readDocument(db,id);
  })();
}
export function enqueue(db,id,version,action,scheduled,actor) {
  return db.transaction(()=>{
    const row=readDocument(db,id);
    if(!['publish','withdraw','delete'].includes(action))fail('发布操作无效');
    if(db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(id))fail('记录已删除',409);
    if(action==='delete'&&version!==row.latest_revision)fail('版本已变化，请先刷新',409);
    if(action==='publish'&&(row.latest_revision!==version||row.approved_revision!==version))fail('请先审核通过当前版本',409);
    if(action==='publish')assertEditionSource(db,row.data);
    if(action==='withdraw'&&(!row.published_revision||version!==row.published_revision))fail('线上版本已变化，请刷新',409);
    if(pendingDocument(db,id))fail('这条内容已有待执行任务',409);
    if(!Number.isFinite(scheduled)||scheduled>Date.now()+366*86400000)fail('定时发布时间无效');
    const job=randomUUID();
    db.prepare("INSERT INTO jobs(id,document_id,revision,action,status,scheduled,created,actor) VALUES(?,?,?,?,'queued',?,?,?)").run(job,id,version,action,Math.max(scheduled,Date.now()),Date.now(),actor);
    audit(db,actor,'queue.'+action,id,job);return {id:job};
  })();
}
export function pendingDocument(db,id) {
  return db.prepare("SELECT 1 FROM jobs j WHERE j.status IN ('queued','running') AND (j.document_id=? OR EXISTS(SELECT 1 FROM job_documents m WHERE m.job_id=j.id AND m.document_id=?))").get(id,id);
}
// Re-render only the currently published snapshot, including a genuinely empty
// new site. A site build never approves a draft or manufactures a content row.
export function enqueueSiteBuild(db,actor='site-deployment'){
  return db.transaction(()=>{
    const pending=db.prepare("SELECT id FROM site_jobs WHERE status IN ('queued','running')").get();
    if(pending)return {...pending,reused:true};
    const id=randomUUID(),now=Date.now();
    db.prepare("INSERT INTO site_jobs(id,status,scheduled,created,actor) VALUES(?,'queued',?,?,?)").run(id,now,now,actor);
    audit(db,actor,'queue.rebuild',id);return {id,reused:false};
  })();
}
// One immutable snapshot and one activation, even when a cleanup touches thousands of records.
export function enqueueBatch(db,members,actor) {
  return db.transaction(()=>{
    if(!Array.isArray(members)||!members.length||members.length>5000||new Set(members.map(x=>x.id)).size!==members.length)fail('批量发布清单无效');
    for(const member of members){
      const row=readDocument(db,member.id);
      if(row.latest_revision!==member.version||row.approved_revision!==member.version||pendingDocument(db,member.id))fail('批次中的内容已变化或已有发布任务',409);
    }
    const first=members[0],job=enqueue(db,first.id,first.version,'publish',Date.now(),actor);
    for(const member of members)db.prepare('INSERT INTO job_documents VALUES(?,?,?)').run(job.id,member.id,member.version);
    audit(db,actor,'queue.batch',job.id,members.length+' records');return {...job,count:members.length};
  })();
}
export function snapshot(db,job=null,{reusePublishedAssets=false}={}) {
  const records=db.prepare('SELECT * FROM documents WHERE id NOT IN (SELECT document_id FROM document_tombstones) ORDER BY rowid').all();
  const year=[],history=[],items=[],news=[],permalinks={},editorialRecords=[];
  const members=new Map(job?.id?db.prepare('SELECT document_id,revision FROM job_documents WHERE job_id=?').all(job.id).map(x=>[x.document_id,x.revision]):[]);
  for(const row of records) {
    let version=row.published_revision;
    if(job?.document_id===row.id)version=['withdraw','delete'].includes(job.action)?null:job.revision;
    if(members.has(row.id))version=members.get(row.id);
    if(!version)continue;
    // Already-published images are immutable, content-addressed public files.
    // Strip their base64 in SQLite so a small publication never materializes
    // every historical image in the admin process or the queue response.
    const reuse=reusePublishedAssets&&version===row.published_revision;
    const item=JSON.parse(db.prepare(`SELECT ${reuse?"json_remove(payload,'$.assets')":"payload"} AS payload FROM revisions WHERE document_id=? AND version=?`).get(row.id,version).payload);
    if(reuse){
      const assets=db.prepare("SELECT json_extract(a.value,'$.path') AS path FROM revisions r,json_each(r.payload,'$.assets') a WHERE r.document_id=? AND r.version=? ORDER BY CAST(a.key AS INTEGER)").all(row.id,version);
      if(assets.length)item.assets=assets.map(({path})=>({path,fromPublished:true}));
    }
    (row.kind==='year'?year:row.kind==='history'?history:row.kind==='news'?news:items).push(item);
    permalinks[sourceKey(row.kind,item)]=row.permalink;
    if(row.kind!=='news')editorialRecords.push({documentId:row.id,kind:row.kind,key:sourceKey(row.kind,item),updated:row.updated});
  }
  const getMeta=key=>JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value||'{}');
  const now=new Date().toISOString();
  return {news,data:{...getMeta('calendarMeta'),exportedAt:now,counts:{year:year.length,official:year.filter(x=>x.provenance==='已核验官网').length,history:history.length},year,history},openSource:{...getMeta('sourceMeta'),exportedAt:now,items},permalinks,editorialRecords};
}
export function claim(db,options={}) {
  return db.transaction(()=>{
    const running=db.prepare("SELECT * FROM jobs WHERE status='running'").get();
    if(running)return {...running,resume:true,snapshot:JSON.parse(running.snapshot)};
    const siteRunning=db.prepare("SELECT * FROM site_jobs WHERE status='running'").get();
    if(siteRunning)return {...siteRunning,resume:true,snapshot:JSON.parse(siteRunning.snapshot)};
    const articleJob=db.prepare("SELECT * FROM jobs WHERE status='queued' AND scheduled<=? ORDER BY scheduled,created LIMIT 1").get(Date.now());
    const siteJob=db.prepare("SELECT * FROM site_jobs WHERE status='queued' AND scheduled<=? ORDER BY scheduled,created LIMIT 1").get(Date.now());
    const job=!articleJob?siteJob:!siteJob?articleJob:articleJob.scheduled<=siteJob.scheduled?articleJob:siteJob;
    if(!job)return null;
    const table=job===siteJob?'site_jobs':'jobs';
    if(table==='jobs'&&job.action==='publish'){
      const candidates=[{document_id:job.document_id,revision:job.revision},...db.prepare('SELECT document_id,revision FROM job_documents WHERE job_id=?').all(job.id)];
      try{for(const item of candidates){const data=JSON.parse(db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=?').get(item.document_id,item.revision).payload);assertEditionSource(db,data);}}
      catch(error){
        db.prepare("UPDATE jobs SET status='failed',finished=?,error=? WHERE id=?").run(Date.now(),String(error.message).slice(0,1500),job.id);
        audit(db,'publisher','publish.failed',job.document_id,'source version conflict');return null;
      }
    }
    const captured=snapshot(db,job,options),payload=JSON.stringify(captured),hash=digest(payload);
    db.prepare(`UPDATE ${table} SET status='running',started=?,snapshot=?,snapshot_hash=? WHERE id=?`).run(Date.now(),payload,hash,job.id);
    return {...job,status:'running',snapshot:captured,snapshot_hash:hash,resume:false};
  })();
}
export function finish(db,id,{ok,release,error,hash}) {
  return db.transaction(()=>{
    const contentJob=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    const job=contentJob||db.prepare('SELECT * FROM site_jobs WHERE id=?').get(id),table=contentJob?'jobs':'site_jobs';
    if(!job)fail('任务不存在',404);
    if(job.status==='success'&&ok&&job.snapshot_hash===hash)return {ok:true};
    if(job.status!=='running')fail('任务不在执行中',409);
    if(ok&&(hash!==job.snapshot_hash||!/^admin-[a-zA-Z0-9-]+$/.test(release||'')))fail('发布结果与任务不匹配',409);
    if(ok&&contentJob){
      db.prepare('UPDATE documents SET published_revision=? WHERE id=?').run(['withdraw','delete'].includes(job.action)?null:job.revision,job.document_id);
      if(job.action==='delete')db.prepare('INSERT INTO document_tombstones VALUES(?,?,?)').run(job.document_id,Date.now(),job.actor);
      for(const member of db.prepare('SELECT * FROM job_documents WHERE job_id=?').all(id))db.prepare('UPDATE documents SET published_revision=? WHERE id=?').run(member.revision,member.document_id);
    }
    db.prepare(`UPDATE ${table} SET status=?,finished=?,error=?,release=?,snapshot=NULL WHERE id=?`).run(ok?'success':'failed',Date.now(),ok?null:String(error||'发布失败').slice(0,1500),ok?release:null,id);
    audit(db,'publisher',ok?'publish.success':'publish.failed',job.document_id||'',id);
    return {ok:true};
  })();
}
