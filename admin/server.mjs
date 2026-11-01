import {registerGuestbook} from './guestbook/api.mjs';
import {openGuestbook} from './guestbook/store.mjs';
import {SITE,siteDescriptor,siteDescriptorForHost} from '../scripts/site-config.mjs';
import {registerNewsApi} from './news-api.mjs';
import {registerLabelsApi} from './labels-api.mjs';
import {openLabelsStore} from './labels-store.mjs';
import {registerCommunityLinks} from './community-links.mjs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import * as argon2 from '@node-rs/argon2';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {audit,openStore,readDocument,createDocument,saveDocument,setReview,enqueue,enqueueBatch,enqueueSiteBuild,claim,finish} from './store.mjs';
import {digest,fail,plain,sourceKey,kinds,yearCategories,sourceCategories} from './model.mjs';
import {localizeMessage} from './messages.mjs';
import {createContentWriteFence,contentMutation} from './content-write-fence.mjs';

export const passwordOptions={algorithm:argon2.Algorithm.Argon2id,memoryCost:19456,timeCost:2,parallelism:1};
export const secret=()=>randomBytes(32).toString('base64url');
export function validPassword(value) {
  if(typeof value!=='string'||[...value].length<16||[...value].length>128)fail('密码需要 16～128 个字符，建议用密码管理器生成');
  if(/^(.)\1+$/.test(value)||/^(123456|password|qwerty|scholay)/i.test(value))fail('请使用独立的强密码');
  return value;
}
const secureEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const maxAge=12*60*60*1000,idle=30*60*1000;

export async function createApp({dbPath=process.env.SCHOLAY_ADMIN_DB||join(root,'.admin-local/admin.sqlite'),labelsDbPath=process.env.SCHOLAY_LABELS_DB||join(dirname(dbPath),'labels.sqlite'),origin=process.env.SCHOLAY_ADMIN_ORIGIN||'http://127.0.0.1:4180',logger=false,guestbookEnabled=process.env.TODAY_GUESTBOOK_ENABLED!==undefined?process.env.TODAY_GUESTBOOK_ENABLED==='1':SITE.services?.guestbook.enabled===true,guestbookDbPath=process.env.TODAY_GUESTBOOK_DB||join(dirname(dbPath),'guestbook.sqlite'),contentFencePath}={}) {
  const contentFence=createContentWriteFence({dbPath,siteId:SITE.id,path:contentFencePath});
  const db=openStore(dbPath),secure=origin.startsWith('https:'),cookieName=secure?'__Secure-scholay-session':'scholay-session';
  let labelsDb=null;
  try{
    if(resolve(labelsDbPath)===resolve(dbPath))throw Error('Labels require an independent state file');
    labelsDb=openLabelsStore(labelsDbPath);
  }catch{console.error('Cloud labels state is unavailable; administration remains available.');}
  const app=Fastify({logger,bodyLimit:256*1024,trustProxy:['127.0.0.1','::1'],requestTimeout:15000});
  const contentRequests=new Set();
  app.addHook('onRequest',async(request,reply)=>{
    if(!contentMutation(request.method,request.routeOptions.url||request.url.split('?')[0]))return;
    await contentFence.requireWritable();contentRequests.add(request);
    const done=()=>contentRequests.delete(request);request.raw.once('aborted',done);reply.raw.once('close',done);
  });
  app.addHook('preHandler',async request=>{if(contentRequests.has(request))await contentFence.requireWritable();});
  app.addHook('onResponse',async request=>{contentRequests.delete(request);});
  app.addHook('onError',async request=>{contentRequests.delete(request);});
  await app.register(cookie);
  await registerCommunityLinks(app);
  app.decorate('db',db);app.decorate('labelsDb',labelsDb);app.addHook('onClose',()=>{db.close();labelsDb?.close();});
  const dummy=await argon2.hash(secret(),passwordOptions);let hashing=0,lastCleanup=0;
  const verify=async(hash,password)=>{
    if(hashing>=2)fail('登录请求较多，请稍后重试',429);
    hashing++;try{return await argon2.verify(hash,password);}catch{return false;}finally{hashing--;}
  };
  function limit(key,max,windowMs=15*60*1000) {
    const now=Date.now();
    if(now-lastCleanup>60000){db.prepare('DELETE FROM attempts WHERE until<?').run(now);db.prepare('DELETE FROM sessions WHERE seen<? OR created<?').run(now-idle,now-maxAge);lastCleanup=now;}
    const entry=db.prepare('SELECT * FROM attempts WHERE key=?').get(key);
    if(entry&&entry.until>now&&entry.count>=max)fail('尝试次数较多，请稍后重试',429);
    db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END,until=CASE WHEN until<? THEN excluded.until ELSE until END').run(key,now+windowMs,now,now);
  }
  const body=request=>{if(!request.body||Array.isArray(request.body)||typeof request.body!=='object')fail('请求格式错误');return request.body;};
  const checkOrigin=request=>{if(request.headers.origin!==origin)fail('请求来源无效，请从管理页面操作',403);};
  const bearer=(request,scope)=>{
    const raw=request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
    if(!raw)fail('未授权',401);
    const token=db.prepare('SELECT * FROM tokens WHERE hash=? AND revoked IS NULL').get(digest(raw));
    if(!token||!scope.includes(token.scope))fail('凭证无效或权限不足',403);
    db.prepare('UPDATE tokens SET last_used=? WHERE id=?').run(Date.now(),token.id);request.actor='token:'+token.id;return token;
  };
  const session=request=>{
    const raw=request.cookies[cookieName];if(!raw)fail('请先登录',401);
    const s=db.prepare('SELECT s.*,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=?').get(digest(raw));
    if(!s||s.created<Date.now()-maxAge||s.seen<Date.now()-idle)fail('登录已过期，请重新登录',401);
    if(!['/manage/api/session','/manage/api/jobs','/manage/api/status'].includes(request.url.split('?')[0]))db.prepare('UPDATE sessions SET seen=? WHERE hash=?').run(Date.now(),s.hash);
    request.session=s;request.actor=s.username;
    if(!['GET','HEAD'].includes(request.method)){
      checkOrigin(request);
      if(!secureEqual(request.headers['x-csrf-token'],s.csrf))fail('页面会话已变化，请刷新后重试',403);
    }
    return s;
  };
  const login=async(request,reply,user)=>{
    const value=secret(),csrf=secret(),now=Date.now();
    if(request.cookies[cookieName])db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(request.cookies[cookieName]));
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)').run(digest(value),user.id,csrf,now,now,request.ip,String(request.headers['user-agent']||'').slice(0,300));
    reply.setCookie(cookieName,value,{httpOnly:true,secure,sameSite:'strict',path:'/manage/',maxAge:maxAge/1000});
    audit(db,user.username,'auth.login','',request.ip);return {user:{username:user.username},csrf};
  };
  app.addHook('onRequest',async(request,reply)=>{
    reply.headers({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'});
  });
  app.setErrorHandler((error,request,reply)=>{
    // A unique-key collision is the caller's conflict, not a server fault.
    const conflict=error.code==='ERR_SQLITE_ERROR'&&[1555,2067].includes(error.errcode);
    const status=conflict?409:error.statusCode||500;
    if(status===429)reply.header('Retry-After','60');
    if(status>=500)console.error('Admin request failed:',error.code||error.name);
    reply.code(status).send({error:localizeMessage(conflict?'内容与已有记录冲突（链接或路径重复）':status>=500?'服务暂时不可用，请稍后重试':error.message,request.headers['x-scholay-language']),...(error.code==='duplicate_source'?{code:error.code,existing:error.existing}:error.code==='legacy_content_read_only'?{code:error.code}:{})});
  });
  app.get('/manage',async(request,reply)=>reply.redirect('/manage/'));
  for(const [path,name,type] of [['/manage/','index.html','text/html; charset=utf-8'],['/manage/admin-i18n.js','admin-i18n.js','text/javascript; charset=utf-8'],['/manage/admin.js','admin.js','text/javascript; charset=utf-8'],['/manage/admin.css','admin.css','text/css; charset=utf-8']]) {
    app.get(path,async(request,reply)=>reply.type(type).send(await readFile(join(root,'admin/public',name))));
  }
  app.addHook('preHandler',async request=>{const expected=request.headers['x-scholay-site'];if(expected&&expected!==SITE.id)fail('站点身份不匹配',409);if(request.headers['x-scholay-protocol']&&request.headers['x-scholay-protocol']!=='1')fail('连接协议版本不支持',409);if(!SITE.legacy&&request.headers.authorization&&request.url.startsWith('/manage/api/news')&&expected!==SITE.id)fail('请指定发布目标站点',409);});
  if(guestbookEnabled){
    if([dbPath,labelsDbPath].some(p=>resolve(p)===resolve(guestbookDbPath)))throw Error('Guestbook requires an independent database');
    const guestbookDb=openGuestbook(guestbookDbPath,SITE.id);
    app.addHook('onClose',()=>guestbookDb.close());
    registerGuestbook(app,{db:guestbookDb,site:SITE,origin,session});
  }
  app.get('/manage/api/site',async request=>siteDescriptorForHost(request.headers.host));
  registerNewsApi(app,{db,bearer,session,body,limit});
  registerLabelsApi(app,{labelsDb,bearer,session,limit});
  app.get('/manage/health',async()=>({ok:true}));
  app.get('/manage/api/content-write-status',async()=>({...await contentFence.status(),inFlight:contentRequests.size}));
  app.get('/manage/api/session',async(request)=>{
    try {const s=session(request);return {user:{username:s.username},csrf:s.csrf};}
    catch{return {user:null,initialized:!!db.prepare('SELECT 1 FROM users LIMIT 1').get()};}
  });
  app.post('/manage/api/setup',async(request,reply)=>{
    checkOrigin(request);limit('setup:'+request.ip,5);const input=body(request);
    if(db.prepare('SELECT 1 FROM users LIMIT 1').get())fail('初始化已完成',409);
    const config=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='setup'").get()?.value||'null');
    if(!config||config.expires<Date.now()||!secureEqual(digest(String(input.token||'')),config.hash))fail('初始化码无效或已过期',403);
    const username=plain(input.username||'',40);
    if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username))fail('账号需要 3～40 位字母、数字、点、横线或下划线');
    const password=await argon2.hash(validPassword(input.password),passwordOptions);
    const user={id:randomUUID(),username};
    db.transaction(()=>{
      if(db.prepare('SELECT 1 FROM users LIMIT 1').get())fail('初始化已完成',409);
      db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id,username,password,Date.now());
      db.prepare("DELETE FROM meta WHERE key='setup'").run();audit(db,username,'auth.setup');
    })();return login(request,reply,user);
  });
  app.post('/manage/api/login',async(request,reply)=>{
    checkOrigin(request);limit('login-ip:'+request.ip,15);limit('login-global',60,60000);
    const input=body(request),username=plain(input.username||'',40).toLowerCase();
    if(typeof input.password!=='string'||input.password.length>512)fail('账号或密码不正确',401);
    limit('login-account:'+digest(username),30);
    const user=db.prepare('SELECT * FROM users WHERE lower(username)=?').get(username);
    if(!await verify(user?.password||dummy,input.password)||!user){audit(db,'anonymous','auth.failed','',request.ip);fail('账号或密码不正确',401);}
    db.prepare('DELETE FROM attempts WHERE key IN (?,?)').run('login-ip:'+request.ip,'login-account:'+digest(username));
    return login(request,reply,user);
  });
  app.post('/manage/api/logout',async(request,reply)=>{const s=session(request);db.prepare('DELETE FROM sessions WHERE hash=?').run(s.hash);reply.clearCookie(cookieName,{path:'/manage/'});return {ok:true};});
  app.post('/manage/api/password',async(request,reply)=>{
    const s=session(request),input=body(request);limit('password:'+s.user_id,5);
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
    if(typeof input.current!=='string'||input.current.length>512||!await verify(user.password,input.current))fail('当前密码不正确',403);
    const hash=await argon2.hash(validPassword(input.password),passwordOptions);
    db.transaction(()=>{db.prepare('UPDATE users SET password=? WHERE id=?').run(hash,s.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(s.user_id);audit(db,s.username,'auth.password');})();
    reply.clearCookie(cookieName,{path:'/manage/'});return {ok:true};
  });
  app.get('/manage/api/sessions',async request=>{const s=session(request);return db.prepare('SELECT hash,created,seen,ip,agent FROM sessions WHERE user_id=? AND seen>? AND created>?').all(s.user_id,Date.now()-idle,Date.now()-maxAge).map(row=>({id:row.hash,current:row.hash===s.hash,created:row.created,seen:row.seen,ip:row.ip,agent:row.agent}));});
  app.post('/manage/api/sessions/revoke',async request=>{const s=session(request);db.prepare('DELETE FROM sessions WHERE user_id=? AND hash<>?').run(s.user_id,s.hash);audit(db,s.username,'auth.revoke-sessions');return {ok:true};});
  app.get('/manage/api/options',async request=>{session(request);return {kinds,yearCategories,sourceCategories,columns:[...new Set([...(SITE.publicColumns||[]),...SITE.columns])],site:siteDescriptor()};});
  app.get('/manage/api/status',async request=>{
    session(request);
    const stats=db.prepare("SELECT count(*) AS total,sum(published_revision IS NOT NULL) AS published,sum(latest_revision<>coalesce(published_revision,0) AND review_state='draft') AS draft,sum(review_state='review') AS review FROM documents").get();
    const jobs=db.prepare("SELECT status,count(*) AS total FROM (SELECT status FROM jobs UNION ALL SELECT status FROM site_jobs) GROUP BY status").all();
    const worker=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='worker'").get()?.value||'null');
    return {stats,jobs,worker};
  });
  app.get('/manage/api/documents',async request=>{
    session(request);const q=request.query;const params=[],where=[];
    if(q.kind){if(!Object.hasOwn(kinds,q.kind))fail('栏目无效');where.push('d.kind=?');params.push(q.kind);}
    if(q.q){where.push("(json_extract(r.payload,'$.title') LIKE ? OR json_extract(r.payload,'$.summary') LIKE ? OR json_extract(r.payload,'$.factSummary') LIKE ?)");params.push(...Array(3).fill('%'+String(q.q).slice(0,200)+'%'));}
    if(q.state==='published')where.push('d.latest_revision=d.published_revision');
    else if(['draft','review','approved'].includes(q.state)){where.push('d.review_state=? AND d.latest_revision<>coalesce(d.published_revision,0)');params.push(q.state);}
    const clause=where.length?'WHERE '+where.join(' AND '):'';
    const count=db.prepare(`SELECT count(*) AS total FROM documents d JOIN revisions r ON r.document_id=d.id AND r.version=d.latest_revision ${clause}`).get(...params).total;
    const page=Math.max(1,Math.min(10000,Math.trunc(Number(q.page)||1))),limit=30;
    const rows=db.prepare(`SELECT d.*,json_extract(r.payload,'$.title') AS title,json_extract(r.payload,'$.category') AS category,json_extract(r.payload,'$.domain') AS domain FROM documents d JOIN revisions r ON r.document_id=d.id AND r.version=d.latest_revision ${clause} ORDER BY d.updated DESC,d.rowid DESC LIMIT ? OFFSET ?`).all(...params,limit,(page-1)*limit);
    return {items:rows,total:count,page,pages:Math.max(1,Math.ceil(count/limit))};
  });
  app.get('/manage/api/documents/:id',async request=>{session(request);const row=readDocument(db,request.params.id);return {...row,revisions:db.prepare('SELECT version,actor,note,created FROM revisions WHERE document_id=? ORDER BY version DESC LIMIT 100').all(row.id)};});
  app.post('/manage/api/documents',async request=>{session(request);const input=body(request);return db.transaction(()=>createDocument(db,input.kind,input.data,request.actor))();});
  // The browser form has no image or section controls; keep what the desktop bundled.
  app.put('/manage/api/documents/:id',async request=>{
    session(request);const input=body(request),data=input.data;if(!data||Array.isArray(data)||typeof data!=='object')fail('请求格式错误');
    const previous=readDocument(db,request.params.id);
    if(previous.kind==='news'||data.assets===undefined&&previous.data.assets)data.assets=previous.data.assets;
    if(data.sectionId===undefined&&previous.data.sectionId)data.sectionId=previous.data.sectionId;
    return saveDocument(db,request.params.id,data,input.version,request.actor);
  });
  app.post('/manage/api/documents/:id/review',async request=>{session(request);const input=body(request);return setReview(db,request.params.id,input.version,input.state,request.actor);});
  app.post('/manage/api/documents/:id/restore',async request=>{
    session(request);const input=body(request),old=db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=?').get(request.params.id,input.restore);
    if(!old)fail('历史版本不存在',404);return saveDocument(db,request.params.id,JSON.parse(old.payload),input.version,request.actor,'恢复版本 '+input.restore+' 为新草稿');
  });
  app.post('/manage/api/documents/:id/queue',async request=>{session(request);const input=body(request);return enqueue(db,request.params.id,input.version,input.action,input.scheduled?new Date(input.scheduled).getTime():Date.now(),request.actor);});
  app.get('/manage/api/jobs',async request=>{session(request);return db.prepare("SELECT j.id,j.document_id,j.revision,j.action,j.status,j.scheduled,j.created,j.started,j.finished,j.error,j.release,(SELECT count(*) FROM job_documents m WHERE m.job_id=j.id) AS itemCount,json_extract(r.payload,'$.title') AS title FROM jobs j JOIN revisions r ON r.document_id=j.document_id AND r.version=j.revision UNION ALL SELECT id,NULL,NULL,action,status,scheduled,created,started,finished,error,release,0,'站点页面重建' FROM site_jobs ORDER BY created DESC LIMIT 150").all();});
  app.post('/manage/api/jobs/:id/cancel',async request=>{session(request);const table=db.prepare('SELECT id FROM site_jobs WHERE id=?').get(request.params.id)?'site_jobs':'jobs';const result=db.prepare(`UPDATE ${table} SET status='cancelled',finished=? WHERE id=? AND status='queued'`).run(Date.now(),request.params.id);if(!result.changes)fail('只能取消尚未执行的任务',409);audit(db,request.actor,'queue.cancel',request.params.id);return {ok:true};});
  app.post('/manage/api/jobs/:id/retry',async request=>{
    session(request);return db.transaction(()=>{
      if(db.prepare("SELECT id FROM site_jobs WHERE id=? AND status='failed'").get(request.params.id))return enqueueSiteBuild(db,request.actor);
      const job=db.prepare("SELECT * FROM jobs WHERE id=? AND status='failed'").get(request.params.id);if(!job)fail('只能重试失败任务',409);
      const members=db.prepare('SELECT document_id AS id,revision AS version FROM job_documents WHERE job_id=?').all(job.id);
      return members.length?enqueueBatch(db,members,request.actor):enqueue(db,job.document_id,job.revision,job.action,Date.now(),request.actor);
    })();
  });
  app.get('/manage/api/audit',async request=>{session(request);return db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 150').all();});
  app.get('/manage/api/tokens',async request=>{session(request);return db.prepare("SELECT id,name,scope,created,last_used,revoked FROM tokens WHERE scope='ingest' ORDER BY created DESC").all();});
  app.post('/manage/api/tokens',async request=>{
    session(request);const input=body(request),name=plain(input.name||'',80);if(!name)fail('请填写凭证名称');
    const token=secret(),id=randomUUID();db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run(id,name,digest(token),'ingest',Date.now());audit(db,request.actor,'token.create',id);return {id,token};
  });
  app.post('/manage/api/tokens/:id/revoke',async request=>{session(request);db.prepare("UPDATE tokens SET revoked=? WHERE id=? AND scope='ingest'").run(Date.now(),request.params.id);audit(db,request.actor,'token.revoke',request.params.id);return {ok:true};});
  app.post('/manage/api/import',async request=>{
    if(request.headers.authorization){bearer(request,['ingest']);limit('ingest:'+request.actor,60,60000);}else session(request);
    const input=body(request);if(!Array.isArray(input.items)||input.items.length>30)fail('每次最多导入 30 条');
    const results=[];
    for(const item of input.items) {
      try {
        if(!Object.hasOwn(kinds,item.kind))fail('栏目无效');
        if(item.kind!=='openSource'&&!item.externalKey&&(typeof item.data?.id!=='string'||!item.data.id.trim()))fail('候选记录需要稳定的原始 id 或 externalKey');
        const key=item.externalKey?item.kind+':external:'+digest(String(item.externalKey)):sourceKey(item.kind,item.data);
        const old=db.prepare('SELECT id FROM documents WHERE source_key=?').get(key);
        if(old){results.push({status:'exists',id:old.id,message:'已有记录未覆盖，请在后台核对修订'});continue;}
        const row=db.transaction(()=>createDocument(db,item.kind,item.data,request.actor,{key}))();results.push({status:'created',id:row.id});
      }catch(error){results.push({status:'error',message:error.message});}
    }
    audit(db,request.actor,'content.import','',JSON.stringify(results.map(x=>x.status)));return {results};
  });
  app.post('/manage/api/worker/claim',async request=>{
    bearer(request,['publisher']);db.prepare("INSERT INTO meta VALUES('worker',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({seen:Date.now()}));return {job:claim(db,{reusePublishedAssets:request.body?.reusePublishedAssets===true&&!SITE.legacy})};
  });
  app.post('/manage/api/worker/jobs/:id/finish',async request=>{bearer(request,['publisher']);return finish(db,request.params.id,body(request));});
  app.setNotFoundHandler((request,reply)=>reply.code(404).send({error:localizeMessage('页面不存在',request.headers['x-scholay-language'])}));
  return app;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createApp();await app.listen({host:'127.0.0.1',port:Number(process.env.PORT||4180)});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
}
