import {createHash} from 'node:crypto';
import {join,basename,isAbsolute} from 'node:path';
import {mkdir,access,stat,readFile} from 'node:fs/promises';
import {fetchPublicBytes} from '../notebook-images.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
export function publicHttpUrl(value){
 try{
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
  if(/^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(url.hostname))return null;
  return url.href;
 }catch{return null;}
}
function extractDate(html){
 const props=['article:published_time','datePublished','pubdate','publish-date','DC.date'];
 for(const name of props){
  const match=html.match(new RegExp(`(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["']`,'i'))||html.match(new RegExp(`content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,'i'));
  if(match?.[1])return {date:match[1],basis:'页面标注的发布日期'};
 }
 const time=html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
 if(time)return {date:time[1],basis:'页面 time 元素'};
 return {date:null,basis:'页面未提供发布日期，抓取时间不能当作发表日期'};
}
function extractTitle(html,url){
 return (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()||new URL(url).hostname;
}
function extractText(html){
 return html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
export async function readPublicPage(url,fetcher=fetch,{maxBytes=800000}={}){
 const href=publicHttpUrl(url);if(!href)throw Error('请输入可公开访问的 http(s) 网址');
 let response;
 try{
  if(fetcher===fetch){
   // Reuse the existing DNS-pinned, size-bounded public fetch transport. It
   // validates every redirect before opening another connection.
   response=new Response(await fetchPublicBytes(href,{maxBytes,accept:'text/html,application/xhtml+xml,text/plain'}));
  }else{
   let next=href;
   for(let hops=0;;hops++){
    response=await fetcher(next,{redirect:'manual',headers:{Accept:'text/html,application/xhtml+xml'},signal:AbortSignal.timeout(20000)});
    if(![301,302,303,307,308].includes(response.status))break;
    const location=response.headers.get('location');
    next=location&&publicHttpUrl(new URL(location,next).href);
    if(!next||hops>=4)throw Error('重定向地址无效');
   }
  }
 }
 catch{throw Error('无法读取网页：'+href);}
 if(!response.ok)throw Error('网页不可用（'+response.status+'）：'+href);
 const type=String(response.headers.get('content-type')||'');
 if(type&&!/html|xml|text\/plain/i.test(type))throw Error('该地址不是可提取的网页文本');
 const buf=Buffer.from(await response.arrayBuffer());
 if(buf.length>maxBytes)throw Error('网页过大，已停止读取');
 const html=buf.toString('utf8');
 const pageText=extractText(html);
 // A 200 response may be an interstitial rather than the requested document.
 // Keep this as a failed read; never turn a security challenge into evidence.
 if(/checking (?:the security of your|your browser|your) (?:connection|browser)|verify (?:that )?you are human|enable javascript and cookies to continue|just a moment|access denied/i.test(extractTitle(html,href)+' '+pageText.slice(0,1200)))throw Error('网页返回访问验证页，未读取正文：'+href);
 const date=extractDate(html);
 const text=pageText.slice(0,20000);
 return {
  url:href,title:extractTitle(html,href),text,truncated:pageText.length>20000,
  publishedAt:date.date,dateBasis:date.basis,contentHash:hash(text||href),fetchedBytes:buf.length,
 };
}
export function webSearchCandidate(query,extra={}){
 const q=String(query||'').trim();if(!q||q.length>300)throw Error('请填写搜索词');
 return {kind:'web',title:'搜索：'+q,summary:'搜索结果先进入候选；读取页面片段后才能作为证据。',locator:{query:q,site:extra.site||null,freshness:extra.freshness||null},acquiredVia:'search'};
}
export function knownUrlCandidate(url,title=''){
 const href=publicHttpUrl(url);if(!href)throw Error('请输入可公开访问的网址');
 return {kind:'web',title:title||href,summary:'已知网址，读取后成为证据。',locator:{url:href},acquiredVia:'url'};
}
export async function resolveWebMount(input,fetcher=fetch){
 if(input.query&&!input.url){
  const candidate=webSearchCandidate(input.query,input);
  return {kind:'web',title:candidate.title,locator:candidate.locator,version:{contentHash:hash(input.query),label:'search',snapshot:{query:input.query,results:'candidates-only'}},state:'ready',scope:{mode:'search',query:input.query},role:'lead'};
 }
 // Desktop and `headless produce` tasks get the rendered text; screenshots reach
 // articles through Center orders (scripts/rssd-order-materials.mjs).
 const page=input.render?await renderPublicPage(input.url,{shots:input.shots}).then(({images,...rest})=>({...rest,images:images.map(({bytes,...image})=>image),publishedAt:null,dateBasis:'渲染页面，抓取时间不能当作发表日期'})):await readPublicPage(input.url,fetcher);
 return {
  kind:'web',title:page.title,locator:{url:page.url},
  version:{contentHash:page.contentHash,label:'page',snapshot:{url:page.url,title:page.title,publishedAt:page.publishedAt,dateBasis:page.dateBasis,truncated:page.truncated}},
  state:page.text?'ready':'partial',
  scope:{mode:'url',url:page.url},
  page,
 };
}

// Rendered mode: some sites (Scholay among them) build the page in the browser,
// so a plain download only sees a loading shell. This mode opens the page in
// headless Chrome, reads the visible text and takes real screenshots: the top
// of the page plus one per heading named in `shots`. Known pop-ups are closed
// and floating assistants hidden; both are listed in the result.
export const RENDER_SITE_RULES={
 'www.scholay.com':{
  dismiss:['关闭会员领取提示','暂时不看教程'],
  // The floating assistant, its tour hint and the signed-in account button.
  hide:['[data-rhino-trigger]','[data-rhino-invitation]','header button[aria-haspopup="menu"]'],
  signedOutButton:'登录',
  // Signed in, the sidebar lists the account's own recent conversations.
  privateSidebar:{text:'最近',toggle:'展开/收起侧栏'},
  // 科研助手: one question box, a hidden file input, Enter sends.
  assistant:{path:/^\/claw(?:\/|$)/,composer:'textarea',files:'input[type=file]',busy:/停止|中止|Stop/i,
   // A turn that ends this way has no usable answer (credits ran out, paused, failed).
   stopped:/额度不足|本轮.{0,12}暂停|继续任务|生成失败|请求失败|出错了/,
   // Model picker: the run-configuration button opens a panel with a model list.
   model:{open:/^运行配置：/,list:/^选择模型，当前/,current:/^运行配置：([^，]+)/}},
 },
};
export function assistantStopped(text,assistant=RENDER_SITE_RULES['www.scholay.com'].assistant){
 const line=String(text||'').split('\n').find(l=>assistant.stopped.test(l));
 return line?line.trim():null;
}
export const ASK_LIMITS=Object.freeze({question:4000,files:5,fileBytes:50*1024*1024,answerMs:15*60*1000});
export const RENDER_VIEWPORT=Object.freeze({width:1440,height:900});
export function renderShotNames(shots){
 const list=(Array.isArray(shots)?shots:String(shots||'').split('|')).map(s=>String(s).trim()).filter(Boolean);
 const names=list.length?list:['top'];
 if(names.length>12||names.some(n=>n.length>60))throw Error('截图位置最多 12 个，每个不超过 60 字');
 return [...new Set(names)];
}
async function playwrightChromium(){
 const {createRequire}=await import('node:module');
 const own=createRequire(import.meta.url);
 try{return own('playwright-core').chromium;}catch{return createRequire(new URL('../../../runtime/package.json',import.meta.url))('playwright-core').chromium;}
}
// A signed-in page uses a browser profile kept per site in the writing
// device's Center folder. The owner signs in once in a visible window
// (`center browser-login <url>`); passwords never pass through RSSD.
export function browserProfileDir(home,url){
 const href=publicHttpUrl(url);if(!href||!home)throw Error('登录配置需要 Center 目录和公开网址');
 const host=new URL(href).hostname;if(!/^[a-z0-9.-]+$/i.test(host))throw Error('网址主机名无效');
 return join(home,'browser-profiles',host.toLowerCase());
}
const contextOptions={viewport:RENDER_VIEWPORT,deviceScaleFactor:2,locale:'zh-CN',timezoneId:'Asia/Shanghai',colorScheme:'light',serviceWorkers:'block'};
export async function browserLogin(url,{home,launchPersistent,browserPath,onReady=()=>{}}={}){
 const href=publicHttpUrl(url);if(!href)throw Error('请输入可公开访问的 http(s) 网址');
 const profile=browserProfileDir(home,href);await mkdir(profile,{recursive:true,mode:0o700});
 const executablePath=browserPath?await browserPath():await (await import('../../note-cards.mjs')).browserPath();
 const context=launchPersistent?await launchPersistent(profile):await (await playwrightChromium()).launchPersistentContext(profile,{executablePath,headless:false,viewport:null,locale:'zh-CN'});
 const page=context.pages()[0]||await context.newPage();await page.goto(href);
 onReady({profile,url:href});
 // On macOS closing the last window leaves Chrome running, so finish when every
 // tab is closed, including tabs a sign-in flow opened.
 await new Promise(done=>{
  context.on('close',done);
  const watch=tab=>tab.on('close',()=>{if(!context.pages().some(t=>!t.isClosed()))context.close().catch(()=>{});});
  for(const tab of context.pages())watch(tab);context.on('page',watch);
 });
 return {state:'closed',profile,url:href};
}
// Scroll the page's main scrolling area (Scholay scrolls an inner panel, not the window).
// `where` is top, end, or a page number (0, 1, …) of screen-high steps with a
// little overlap. Returns whether that position is still within the content.
async function scrollMain(page,where){
 const inside=await page.evaluate(where=>{
  const all=[...document.querySelectorAll('*')].filter(e=>{const st=getComputedStyle(e);return /(auto|scroll)/.test(st.overflowY)&&e.scrollHeight>e.clientHeight+20;});
  const target=all.sort((a,b)=>b.clientHeight*b.clientWidth-a.clientHeight*a.clientWidth)[0]||document.scrollingElement;
  const step=Math.max(200,Math.floor(target.clientHeight*0.85)),max=target.scrollHeight-target.clientHeight;
  if(typeof where==='number'){if(where>0&&(where-1)*step>=max)return false;target.scrollTop=Math.min(where*step,max);return true;}
  target.scrollTop=where==='end'?target.scrollHeight:0;return true;
 },where);
 await page.waitForTimeout(800);
 return inside;
}
const MAX_PAGE_SHOTS=10;
export async function renderPublicPage(url,{shots,profile,ask,attach=[],model,launch,browserPath,timeoutMs=60000,pollMs=3000}={}){
 const href=publicHttpUrl(url);if(!href)throw Error('请输入可公开访问的 http(s) 网址');
 const names=renderShotNames(shots),rules=RENDER_SITE_RULES[new URL(href).hostname]||{dismiss:[],hide:[]};
 const assistant=ask!==undefined?rules.assistant:null;
 if(ask!==undefined){
  if(!profile)throw Error('向网站助手提问需要登录：在材料行加 signedIn=true');
  if(!assistant||!assistant.path.test(new URL(href).pathname))throw Error('这个网址不是已支持的网站助手页面：'+href);
  if(typeof ask!=='string'||!ask.trim()||ask.length>ASK_LIMITS.question)throw Error('提问内容须为 1–'+ASK_LIMITS.question+' 字');
 }else if(attach.length||model)throw Error('附件和模型只能和提问一起使用');
 if(model!==undefined&&(typeof model!=='string'||!model.trim()||model.length>60))throw Error('模型名称无效');
 if(attach.length>ASK_LIMITS.files)throw Error('一次最多上传 '+ASK_LIMITS.files+' 个附件');
 const files=[];
 for(const file of attach){
  if(typeof file!=='string'||!isAbsolute(file))throw Error('附件须写本机绝对路径：'+file);
  const info=await stat(file).catch(()=>null);if(!info?.isFile())throw Error('附件不存在：'+file);
  if(info.size>ASK_LIMITS.fileBytes)throw Error('附件超过 50 MB：'+file);
  files.push({path:file,name:basename(file),bytes:info.size,sha256:hash(await readFile(file))});
 }
 if(profile)await access(join(profile,'Default')).catch(()=>{throw Error('这台设备还没有登录 '+new URL(href).hostname+'，请先运行 center browser-login '+new URL(href).origin);});
 const executablePath=launch?null:browserPath?await browserPath():await (await import('../../note-cards.mjs')).browserPath();
 let browser=null,context;
 if(launch)({browser,context}=await launch({profile,contextOptions}));
 else if(profile)context=await (await playwrightChromium()).launchPersistentContext(profile,{executablePath,headless:true,...contextOptions});
 else{browser=await (await playwrightChromium()).launch({executablePath,headless:true});context=await browser.newContext(contextOptions);}
 try{
  const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(30000);
  await page.goto(href,{waitUntil:'networkidle',timeout:timeoutMs});await page.waitForTimeout(1500);
  const sameSite=()=>{const u=publicHttpUrl(page.url());if(!u||new URL(u).hostname!==new URL(href).hostname)throw Error('页面跳转到了其他网站：'+page.url());return u;};
  sameSite();
  const tidy=async()=>{
   for(const name of rules.dismiss){const button=page.getByRole('button',{name,exact:true}).first();if(await button.isVisible().catch(()=>false))await button.click().catch(()=>{});}
   if(rules.hide.length)await page.addStyleTag({content:rules.hide.join(',')+'{visibility:hidden!important}'});
  };
  await tidy();
  if(profile&&rules.signedOutButton&&await page.getByRole('button',{name:rules.signedOutButton,exact:true}).first().isVisible().catch(()=>false))throw Error(new URL(href).hostname+' 的登录已失效，请重新运行 center browser-login '+new URL(href).origin);
  // Drawn on screen, not merely present: a collapsed sidebar keeps its list in the page.
  const onScreen=text=>page.getByText(text,{exact:true}).evaluateAll(es=>es.some(e=>{const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return Boolean(hit&&(hit===e||e.contains(hit)));})).catch(()=>false);
  if(profile&&rules.privateSidebar&&await onScreen(rules.privateSidebar.text)){
   await page.getByRole('button',{name:rules.privateSidebar.toggle,exact:true}).first().click();
   await page.waitForTimeout(1500);
   if(await onScreen(rules.privateSidebar.text))throw Error('无法收起列有账号对话的侧栏，未截图');
  }
  let asked=null;
  if(assistant){
   let usedModel=null;
   const currentModel=async()=>((await page.getByRole('button',{name:assistant.model.open}).first().getAttribute('aria-label'))||'').match(assistant.model.current)?.[1]?.trim()||null;
   if(model){
    await page.getByRole('button',{name:assistant.model.open}).first().click();
    await page.getByRole('button',{name:assistant.model.list}).first().click();
    const option=page.getByRole('option',{name:model.trim(),exact:true}).first();
    if(!await option.count()){const names=await page.getByRole('option').evaluateAll(es=>es.map(e=>(e.innerText||'').split('\n')[0].trim()));throw Error('网站助手没有模型“'+model+'”，可选：'+names.join('、'));}
    await option.click();await page.keyboard.press('Escape').catch(()=>{});await page.waitForTimeout(800);
    if(await currentModel()!==model.trim())throw Error('没能切换到模型“'+model+'”');
   }
   usedModel=await currentModel();
   if(files.length){await page.locator(assistant.files).first().setInputFiles(files.map(f=>f.path));await page.waitForLoadState('networkidle').catch(()=>{});await page.waitForTimeout(4000);}
   const box=page.locator(assistant.composer).first();await box.fill(ask);await box.press('Enter');
   const startedAt=Date.now();let last='',stable=0;
   await page.waitForTimeout(pollMs);
   while(true){
    if(Date.now()-startedAt>ASK_LIMITS.answerMs)throw Error('网站助手 15 分钟内没有答完，未截图');
    await page.waitForTimeout(pollMs);
    const now=await page.locator('main').last().innerText().catch(()=>'');
    const busy=(await page.$$eval('button',(bs,pattern)=>bs.filter(b=>b.offsetParent).some(b=>new RegExp(pattern,'i').test(b.getAttribute('aria-label')||b.innerText||'')),assistant.busy.source));
    if(now===last&&!busy){if(++stable>=4)break;}else{stable=0;last=now;}
   }
   const stoppedLine=assistantStopped(await page.locator('main').last().innerText().catch(()=>''),assistant);
   if(stoppedLine)throw Error('网站助手没有完成回答：'+stoppedLine+'。本单未写作，请处理后重试。');
   asked={question:ask,model:usedModel,files:files.map(({path,...f})=>f),answeredInMs:Date.now()-startedAt,conversationUrl:sameSite()};
  }
  const text=(await page.locator(assistant?'main':'body').last().innerText()).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(/^页面加载中\s*$/.test(text)||!text)throw Error('页面没有渲染出正文：'+href);
  const title=await page.title(),images=[];
  const shoot=async anchor=>{await tidy();const bytes=await page.screenshot();images.push({anchor,bytes,sha256:hash(bytes),capturedAt:new Date().toISOString(),url:page.url()});};
  for(const name of names){
   // `pages`: the whole scrolling area, one screen at a time (at most 10).
   if(name==='pages'){for(let i=0;i<MAX_PAGE_SHOTS&&await scrollMain(page,i);i++)await shoot('page-'+(i+1));continue;}
   if(name==='top'||name==='end')await scrollMain(page,name);
   else{
    const anchor=page.getByText(name,{exact:true}).first();
    if(!await anchor.count())throw Error('页面上找不到截图位置“'+name+'”：'+href);
    await anchor.evaluate(e=>e.scrollIntoView({block:'start'}));await page.waitForTimeout(800);
   }
   await shoot(name);
  }
  const body=text.slice(0,20000),finalUrl=sameSite();
  return {url:finalUrl,title:title||new URL(finalUrl).hostname,text:body,truncated:text.length>20000,rendered:true,signedIn:Boolean(profile),...(asked?{asked}:{}),viewport:RENDER_VIEWPORT,deviceScaleFactor:2,dismissed:rules.dismiss,hidden:rules.hide,images,contentHash:hash(body),capturedAt:new Date().toISOString()};
 }finally{await context.close().catch(()=>{});await browser?.close();}
}
