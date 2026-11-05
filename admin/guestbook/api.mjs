import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {guestbookConfig} from './config.mjs';
import {countToday,submit,guard} from './store.mjs';
import {renderNavigation} from '../../web/engine/site-navigation.mjs';
import {addSocialMetadata} from '../../web/engine/social-metadata.mjs';
import {addLanguageNavigation} from '../../web/engine/language-navigation.mjs';
const languageStyles='.guestbook-header{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px}.guestbook-header>#home{grid-column:1;grid-row:1;align-self:center}.guestbook-header>.site-language-control{grid-column:2;grid-row:1;margin:0}.guestbook-header>p,.guestbook-header>h1{grid-column:1/-1}';
const academicNavStyles='.academic-nav{display:flex;flex-wrap:wrap;gap:12px 24px;margin-bottom:32px;padding-bottom:16px;border-bottom:1px solid #d7dbd4}.academic-nav a{color:inherit;text-decoration:none}.academic-nav a[aria-current]{font-weight:700;text-decoration:underline;text-underline-offset:6px}.academic-nav a:focus-visible{outline:2px solid currentColor;outline-offset:4px}';
const error=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
const clean=(value,max,required=false)=>{
 if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))error('字段格式或长度不正确');
 const text=value.trim();if(required&&!text)error('请填写所有必填字段');return text;
};
export function registerGuestbook(app,{db,site,origin,session,now=Date.now,publicRoot=process.env.SCHOLAY_PUBLIC_ROOT||(site.legacy?'/opt/scholay-today-web':`/opt/scholay-sites/${site.id}/web`)}){
 const config=guestbookConfig(site),secure=origin.startsWith('https:'),cookieName=(secure?'__Host-today-guest-':'today-guest-')+site.id;
 const secret=db.prepare("SELECT value FROM guestbook_meta WHERE key='secret'").get().value;
 const hash=value=>createHmac('sha256',secret).update(site.id+':'+value).digest('hex');
 const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
 const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:site.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
 function visitor(req){
  const value=req.cookies[cookieName]||'',parts=value.split('.');
  return /^[a-f0-9]{48}$/.test(parts[0]||'')&&equal(parts[1],hash('cookie:'+parts[0]))?parts[0]:null;
 }
 function checkOrigin(req){if(req.headers.origin!==origin)error('请从本站留言板提交',403);}
 function input(req){
  const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b))error('请求格式错误');
  if(Object.keys(b).some(k=>!['kind','name','message','contact','details','requestKey'].includes(k)))error('存在未知字段');
  const form=config.forms.find(f=>f.id===b.kind);if(!form)error('留言类型不适用于本站');
  if(typeof b.requestKey!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(b.requestKey))error('缺少有效提交编号');
  if(!b.details||typeof b.details!=='object'||Array.isArray(b.details)||Object.keys(b.details).some(k=>!form.fields.some(f=>f.key===k)))error('表单字段不适用于该留言类型');
  return {kind:form.id,name:clean(b.name,60,true),message:clean(b.message,3000,true),contact:clean(b.contact??'',200),details:Object.fromEntries(form.fields.map(f=>[f.key,clean(b.details[f.key]??'',f.max,f.required)]))};
 }
 // The proxy sends /guestbook/* to this service, even for files included in a
 // static release. Serve those exact public artifacts so the publication verifier
 // checks the same bytes that visitors receive; older releases have no artifacts.
 const staticMarker=async()=>{const marker=await readFile(join(publicRoot,'current/release.json'),'utf8').catch(err=>{if(err.code==='ENOENT')return null;throw err;});return marker?JSON.parse(marker).guestbook?.static===true:false;};
 for(const [url,file,type] of [['/guestbook/','index.html','text/html'],['/guestbook/index.html','index.html','text/html'],['/guestbook/config.json','config.json','application/json'],['/guestbook/app.js','app.js','text/javascript'],['/guestbook/style.css','style.css','text/css'],['/manage/guestbook/','moderate.html','text/html'],['/manage/guestbook/moderate.js','moderate.js','text/javascript']]){
  app.get(url,async(req,reply)=>{
   if(url.startsWith('/guestbook/')&&(url!=='/guestbook/'||await staticMarker())){
    try{return reply.type(type+'; charset=utf-8').send(await readFile(join(publicRoot,'current/guestbook',file)));}
    catch(e){
     if(e.code!=='ENOENT')throw e;
     // A declared static release must never silently fall back to runtime files.
     if(file==='index.html'||file==='config.json'||await staticMarker())return reply.code(404).send();
    }
   }
   let bytes=await readFile(new URL('../../web/guestbook/'+file,import.meta.url));
   if(file==='index.html'){
    const englishHome=await access(join(publicRoot,'current/en/index.html')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
    let html=addSocialMetadata(bytes.toString(),{site,route:'/guestbook/',title:'留言板 · '+site.name,description:'公开留言、问题反馈与合作线索。'+site.description});
    html=addLanguageNavigation(html,{site,route:'/guestbook/',englishHome});
    html=html.replace('<header>','<header class="guestbook-header">');
    bytes=Buffer.from(html);
   }
   if(site.id==='scholay-today'&&file==='index.html')bytes=Buffer.from(bytes.toString().replace('<main>','<main><nav class="academic-nav" aria-label="主导航">'+renderNavigation(site,'/guestbook/')+'</nav>'));
   if(file==='style.css')bytes=Buffer.concat([bytes,Buffer.from(languageStyles+(site.id==='scholay-today'?academicNavStyles:''))]);
   if(!site.legacy&&file==='style.css')bytes=Buffer.concat([bytes,await readFile(new URL('../../web/guestbook/color-mode.css',import.meta.url))]);
   return reply.type(type+'; charset=utf-8').send(bytes);
  });
 }
 app.get('/guestbook',async(req,reply)=>reply.redirect('/guestbook/'));
 app.get('/guestbook/api/session',async(req,reply)=>{
  let v=visitor(req);
  if(!v){guard(db,hash('identity:'+req.ip),30,60_000,now());v=randomBytes(24).toString('hex');reply.setCookie(cookieName,v+'.'+hash('cookie:'+v),{httpOnly:true,secure,sameSite:'strict',path:'/',maxAge:365*86400});}
  return {config,csrf:hash('csrf:'+v),remaining:Math.max(0,2-countToday(db,hash('visitor:'+v),day())),day:day()};
 });
 app.get('/guestbook/api/messages',async()=>({messages:db.prepare("SELECT id,payload,created FROM messages WHERE status='approved' ORDER BY created DESC,id DESC LIMIT 50").all().map(r=>{const p=JSON.parse(r.payload);return {id:r.id,kind:p.kind,name:p.name,message:p.message,created:r.created};})}));
 app.post('/guestbook/api/messages',{bodyLimit:16*1024},async(req,reply)=>{
  checkOrigin(req);const v=visitor(req);if(!v||!equal(req.headers['x-guestbook-csrf'],hash('csrf:'+v)))error('留言会话已变化，请刷新后重试',403);
  guard(db,hash('post:'+day()+':'+req.ip),40,86400_000,now());
  const payload=input(req),result=submit(db,{visitor:hash('visitor:'+v),day:day(),key:req.body.requestKey,payload,now:now()});
  return reply.code(result.replayed?200:201).send({...result,status:'received',remaining:Math.max(0,2-countToday(db,hash('visitor:'+v),day()))});
 });
 app.get('/manage/api/guestbook',async req=>{
  session(req);const status=req.query.status||'pending';if(!['pending','approved','rejected'].includes(status))error('未知审核状态');
  return {config,messages:db.prepare('SELECT id,payload,status,created,reviewed,reviewer FROM messages WHERE status=? ORDER BY created DESC,id DESC LIMIT 100').all().map(r=>({...r,...JSON.parse(r.payload),payload:undefined}))};
 });
 app.post('/manage/api/guestbook/:id/review',async req=>{
  const actor=session(req);const status=req.body?.status;if(!['approved','rejected','pending'].includes(status))error('未知审核状态');
  const result=db.prepare('UPDATE messages SET status=?,reviewed=?,reviewer=? WHERE id=?').run(status,now(),actor.username,req.params.id);
  if(!result.changes)error('留言不存在',404);return {ok:true};
 });
}
