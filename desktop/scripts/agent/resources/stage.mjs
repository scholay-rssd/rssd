// Interface demonstrations: a scripted 科研助手 conversation shown in the live
// Scholay frontend. The page's own code and styles load from www.scholay.com;
// every /api call is answered on this device from the scene, the agent socket
// is accepted locally, and third-party requests are aborted. Nothing reaches the
// Scholay backend except anonymous reads of public configuration (model list,
// site settings), so the interface matches what visitors see that day.
//
// A scene is a folder: scenario.json ({session:{sessionId,title,messages}})
// plus any images its replies show as /api/v1/staging-assets/<scene>/<file>.
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {join,extname,basename} from 'node:path';
import {RENDER_VIEWPORT} from './web.mjs';

const ORIGIN='https://www.scholay.com';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const SCENE_NAME=/^[a-z0-9][a-z0-9-]{1,63}$/;
// Anonymous public reads only; anything else under /api is answered locally.
const PUBLIC_READS=[/^\/config\//,/^\/public\//,/^\/invite\/campaign$/];
const IMAGE_TYPES={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'};
const MAX_MESSAGES=40;

export function sceneDir(home,name){
 if(!SCENE_NAME.test(String(name||'')))throw Error('界面演示场景名只能用小写字母、数字和连字符：'+name);
 if(!home)throw Error('界面演示需要 Center 目录');
 return join(home,'scenes',name);
}

export async function readScene(dir){
 const file=join(dir,'scenario.json');
 const raw=await readFile(file,'utf8').catch(()=>{throw Error('这台设备没有界面演示场景：'+basename(dir));});
 let scene;try{scene=JSON.parse(raw);}catch{throw Error('界面演示场景不是有效的 JSON：'+basename(dir));}
 const session=scene?.session;
 if(!session||!/^[A-Za-z0-9-]{3,80}$/.test(String(session.sessionId||''))||typeof session.title!=='string'||!session.title.trim())throw Error('界面演示场景缺少会话编号或标题：'+basename(dir));
 if(!Array.isArray(session.messages)||!session.messages.length||session.messages.length>MAX_MESSAGES)throw Error('界面演示场景须有 1–'+MAX_MESSAGES+' 条消息：'+basename(dir));
 if(!session.messages.some(m=>m.type==='user'))throw Error('界面演示场景没有用户提问：'+basename(dir));
 return {scene,session,contentHash:hash(raw)};
}

// What a reader sees: questions and final replies, not thinking or tool calls.
export function sceneText(session){
 const out=[];
 for(const m of session.messages){
  const text=(m.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').trim();
  if(!text)continue;
  if(m.type==='user')out.push('【提问】'+text);
  else if(m.type==='assistant')out.push('【回答】'+text.replace(/!\[([^\]]*)\]\([^)]*\)/g,'［图：$1］'));
 }
 return out.join('\n\n');
}

// Local answers for the signed-in endpoints the 科研助手 page reads.
export function sceneApi({session,name,dir,fetchPublic=publicRead}){
 const first=session.messages[0]?.timestamp||new Date(0).toISOString(),last=session.messages.at(-1)?.timestamp||first;
 const user={id:9001,username:'林屿',nickname:'林屿',email:'demo@example.invalid',role:'user',permissions:[]};
 const ok=data=>({status:200,contentType:'application/json',body:JSON.stringify({code:0,message:'success',data})});
 const item={sessionId:session.sessionId,title:session.title,messageCount:session.messages.length,lastAccessedAt:last,createdAt:first,agentCreatedAt:first,agentModifiedAt:last};
 const seen={state:'completed',detail:'',updated_at:last};
 return async({method,url})=>{
  const path=url.pathname.replace(/^\/api\/v1/,'');
  const asset=path.match(/^\/staging-assets\/([^/]+)\/([^/]+)$/);
  if(asset){
   if(asset[1]!==name||!IMAGE_TYPES[extname(asset[2]).toLowerCase()]||asset[2].includes('..'))return {status:404,contentType:'text/plain',body:'not found'};
   return {status:200,contentType:IMAGE_TYPES[extname(asset[2]).toLowerCase()],body:await readFile(join(dir,asset[2]))};
  }
  if(method==='GET'&&path==='/public/umami-config')return ok({enabled:false});
  if(method==='GET'&&PUBLIC_READS.some(r=>r.test(path)))return fetchPublic(path+url.search);
  if(method==='GET'&&path==='/user/models')return fetchPublic('/public/models'+url.search);
  if(path==='/user/profile')return ok({...user,avatar_url:null,bio:'',status:1,email_verified:true,phone_verified:false,created_at:first,updated_at:last,last_login_at:last});
  if(path==='/user/billing/overview')return ok({tier:'pro',cycle:'yearly',expires_at:'2099-01-01T00:00:00.000Z',token:{used:0,ceiling:0,percent:12,unlimited:false,consumed_today:0,window_days:7,window_started_at:first,window_reset_at:last},credit:{temp:0,perm:300,total:300,credit_autopay:false,lots:[]},reset_passes:0,reset_pass_next_expiry:null,reset_pass_lots:[]});
  if(path==='/user/claw/sessions')return ok({items:[item],total:1});
  if(/^\/user\/[a-z_-]+\/sessions$/.test(path))return ok({items:[],total:0});
  if(path==='/user/claw/session/messages')return ok({sessionId:session.sessionId,messages:session.messages,totalTurns:session.messages.filter(m=>m.type==='user').length,hasMore:false});
  if(path==='/user/agent-session/resolve')return ok(url.searchParams.get('session_id')===session.sessionId?{owned:true,feature:'claw'}:{owned:false,feature:''});
  if(path==='/user/guide-marks')return ok({marks:Object.fromEntries(['2026-11','2026-11-bar','2026-11-m'].map(id=>['whats-new:'+id,seen])),released:{}});
  if(method==='POST'&&path==='/user/claw/session/ws-ticket')return ok({sessionId:session.sessionId,wsToken:'staging',expiresInSeconds:30});
  if(path==='/user/claw/session/context')return ok({sessionId:session.sessionId});
  if(/^\/user\/agent-sessions\/[^/]+\/assets$/.test(path))return ok({items:[],nextCursor:''});
  if(['/user/projects','/user/documents','/user/claw/session/artifacts'].includes(path))return ok({items:[],total:0});
  if(['/user/agent-activity'].includes(path))return ok({items:[]});
  if(['/user/messages/unread-count','/support/unread'].includes(path))return ok({count:0});
  if(path==='/user/capabilities'||/^\/user\/agent-sessions\/[^/]+\/capabilities$/.test(path)||path.startsWith('/user/guide-marks/')||path==='/user/activity'||path==='/user/ws-ticket')return ok({});
  return null;
 };
}

async function publicRead(path){
 const res=await fetch(ORIGIN+'/api/v1'+path,{headers:{accept:'application/json'},redirect:'error'});
 return {status:res.status,contentType:res.headers.get('content-type')||'application/json',body:Buffer.from(await res.arrayBuffer())};
}

async function playwrightChromium(){
 const {createRequire}=await import('node:module');
 const own=createRequire(import.meta.url);
 try{return own('playwright-core').chromium;}catch{return createRequire(new URL('../../../runtime/package.json',import.meta.url))('playwright-core').chromium;}
}

// The placeholder sign-in lives only in this browser's storage; every call it
// would authorize is answered by sceneApi above.
function signedInStorage(user){
 const b64=o=>btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const token=b64({alg:'none',typ:'JWT'})+'.'+b64({user_id:user.id,username:user.username,exp:4102444800})+'.staging';
 try{localStorage.setItem('auth_token',token);localStorage.setItem('scholay.auth',JSON.stringify({state:{user},version:0}));localStorage.setItem('scholay.session.owner','user:'+user.id);}catch{}
}

export async function stageScene(dir,{launch,browserPath,timeoutMs=60000}={}){
 const name=basename(dir);
 const {session,contentHash}=await readScene(dir);
 const answer=sceneApi({session,name,dir});
 const executablePath=launch?null:browserPath?await browserPath():await (await import('../../note-cards.mjs')).browserPath();
 let browser;
 if(launch)({browser}=await launch({}));
 else browser=await (await playwrightChromium()).launch({executablePath,headless:true});
 const context=await browser.newContext({viewport:RENDER_VIEWPORT,deviceScaleFactor:2,locale:'zh-CN',timezoneId:'Asia/Shanghai',colorScheme:'light',serviceWorkers:'block'});
 const unanswered=new Set(),aborted=new Set();
 try{
  await context.addInitScript(signedInStorage,{id:9001,username:'林屿',nickname:'林屿'});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===ORIGIN&&url.pathname.startsWith('/api/')){
    const hit=await answer({method:request.method(),url});
    if(hit)return route.fulfill(hit);
    unanswered.add(request.method()+' '+url.pathname);
    return route.fulfill({status:501,contentType:'application/json',body:JSON.stringify({code:501,message:'staging: not scripted',data:null})});
   }
   if(url.origin===ORIGIN&&!url.pathname.startsWith('/umami'))return route.continue();
   aborted.add(url.origin);return route.abort();
  });
  await context.routeWebSocket(/.*/,ws=>{ws.send(JSON.stringify({type:'connected'}));ws.onMessage(m=>{try{if(JSON.parse(String(m)).type==='ping')ws.send(JSON.stringify({type:'pong'}));}catch{}});});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  const href=ORIGIN+'/claw/'+session.sessionId;
  await page.goto(href,{waitUntil:'networkidle',timeout:timeoutMs});await page.waitForTimeout(2500);
  const tidy=async()=>{
   for(const label of ['关闭会员领取提示','暂时不看教程']){const b=page.getByRole('button',{name:label,exact:true}).first();if(await b.isVisible().catch(()=>false))await b.click().catch(()=>{});}
   await page.addStyleTag({content:'[data-rhino-trigger],[data-rhino-invitation]{visibility:hidden!important}'});
  };
  await tidy();
  const turns=page.locator('article');const count=await turns.count();
  if(!count)throw Error('界面演示没有渲染出对话：'+name+(unanswered.size?'（未应答接口：'+[...unanswered].join('、')+'）':''));
  const text=(await page.locator('main').last().innerText()).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  for(const word of session.messages.filter(m=>m.type==='user').map(m=>(m.content||[]).find(c=>c.type==='text')?.text?.slice(0,12)).filter(Boolean))
   if(!text.includes(word))throw Error('界面演示没有显示完整对话：'+name);
  const images=[];
  const shoot=async(anchor,target)=>{await tidy();const bytes=await (target||page).screenshot();images.push({anchor,bytes,sha256:hash(bytes),capturedAt:new Date().toISOString(),url:href});};
  // Screens: the opening view, then each turn brought near the top of the chat column.
  await shoot('开头');
  for(let i=0;i<count;i++){
   await turns.nth(i).evaluate(el=>{let p=el.parentElement;while(p&&!(p.scrollHeight>p.clientHeight+4&&/auto|scroll/.test(getComputedStyle(p).overflowY)))p=p.parentElement;if(p)p.scrollTop+=el.getBoundingClientRect().top-p.getBoundingClientRect().top-96;});
   await page.waitForTimeout(500);await shoot('第 '+(i+1)+' 轮对话');
  }
  // Figures inside replies, cropped in a tall window so the composer cannot cover them.
  const tall=await page.evaluate(()=>Math.max(...[...document.querySelectorAll('article')].map(a=>a.scrollHeight)))+600;
  await page.setViewportSize({width:RENDER_VIEWPORT.width,height:Math.min(Math.max(RENDER_VIEWPORT.height,tall),6000)});await page.waitForTimeout(600);
  for(let i=0;i<count;i++){
   const figures=turns.nth(i).locator('img');
   for(let k=0;k<await figures.count();k++){await figures.nth(k).scrollIntoViewIfNeeded();await shoot('第 '+(i+1)+' 轮回答中的图'+(k+1),figures.nth(k));}
  }
  return {url:href,title:session.title+' · Scholay 科研助手界面演示',text:sceneText(session),truncated:false,rendered:true,staged:true,scene:name,signedIn:false,viewport:RENDER_VIEWPORT,deviceScaleFactor:2,dismissed:[],hidden:['[data-rhino-trigger]','[data-rhino-invitation]'],images,capturedAt:new Date().toISOString(),contentHash,unanswered:[...unanswered],aborted:[...aborted]};
 }finally{await context.close().catch(()=>{});await browser?.close();}
}
