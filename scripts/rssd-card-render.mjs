// Headless Chrome for picture cards, driven over the DevTools protocol with Node's own WebSocket.
// It opens a static card page from disk, checks it in the page, and takes each card as a 1080×1440 PNG.
// Host names do not resolve in this browser, so a card page cannot fetch anything from the network.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const CHROME_PATH=process.env.RSSD_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const CARD=Object.freeze({width:1080,height:1440});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function launchChrome({path=CHROME_PATH,timeoutMs=30000}={}){
 const profile=await mkdtemp(join(tmpdir(),'rssd-chrome-'));
 const child=spawn(path,['--headless=new','--disable-gpu','--hide-scrollbars','--mute-audio','--no-first-run','--no-default-browser-check',
  '--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--password-store=basic','--use-mock-keychain',
  '--host-resolver-rules=MAP * ~NOTFOUND','--force-color-profile=srgb','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let exited=false;child.on('exit',()=>{exited=true;});
 let endpoint=null;const started=Date.now();
 while(!endpoint){
  if(exited)throw Error('Chrome exited before it was ready');
  if(Date.now()-started>timeoutMs){child.kill();throw Error('Chrome did not start within '+timeoutMs+' ms');}
  try{const [port,socket]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');if(port&&socket)endpoint='ws://127.0.0.1:'+port+socket;}catch{}
  if(!endpoint)await sleep(100);
 }
 const ws=new WebSocket(endpoint);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('Cannot reach Chrome')),{once:true});});
 let sequence=0;const waiting=new Map(),listeners=new Set();
 ws.addEventListener('message',event=>{
  const message=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString());
  if(message.id&&waiting.has(message.id)){
   const {resolve,reject,method}=waiting.get(message.id);waiting.delete(message.id);
   if(message.error)reject(Error(method+': '+message.error.message));else resolve(message.result);
  }else for(const listener of listeners)listener(message);
 });
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const id=++sequence;waiting.set(id,{resolve,reject,method});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
 });

 async function page({width=CARD.width,height=CARD.height}={}){
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const call=(method,params)=>send(method,params,sessionId);
  const next=(method,timeoutMs=60000)=>new Promise((resolve,reject)=>{
   const listener=message=>{if(message.sessionId===sessionId&&message.method===method){clearTimeout(timer);listeners.delete(listener);resolve(message.params);}};
   const timer=setTimeout(()=>{listeners.delete(listener);reject(Error('Timed out waiting for '+method));},timeoutMs);
   listeners.add(listener);
  });
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  async function evaluate(expression){
   const {result,exceptionDetails}=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
   if(exceptionDetails)throw Error('Page script failed: '+(exceptionDetails.exception?.description||exceptionDetails.text));
   return result.value;
  }
  async function open(file){
   const loaded=next('Page.loadEventFired');
   await call('Page.navigate',{url:pathToFileURL(file).href});await loaded;
   await evaluate('Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>null))]).then(()=>true)');
  }
  async function shot({x=0,y=0,width:w=CARD.width,height:h=CARD.height}={}){
   const {data}=await call('Page.captureScreenshot',{format:'png',clip:{x,y,width:w,height:h,scale:1},captureBeyondViewport:true});
   return Buffer.from(data,'base64');
  }
  return {open,evaluate,shot,close:()=>send('Target.closeTarget',{targetId}).catch(()=>{})};
 }
 async function close(){
  try{ws.close();}catch{}
  if(!exited){child.kill();await new Promise(resolve=>exited?resolve():child.once('exit',resolve));}
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
 }
 return {page,close};
}

/**
 * Runs inside the card page. `spec.blocks` is the article in reading order; every block's text must appear, word for
 * word, in elements carrying its id as data-src (a block may be split across cards). Pictures are <img data-src>.
 * Returns {issues, cards:[{x,y}]}; no issues means nothing was lost, cut, hidden, shrunk or invented.
 */
export function checkCardsInPage(spec){
 const norm=s=>String(s).normalize('NFKC').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,'');
 const issues=[],seen=new Set(),issue=message=>{if(!seen.has(message)){seen.add(message);issues.push(message);}};
 const cards=[...document.querySelectorAll('section.card')];
 if(!cards.length)return {issues:['No <section class="card"> elements were found.'],cards:[]};
 if(document.scripts.length)issue('The page contains <script>. Card pages must be static HTML and CSS.');
 if(document.querySelector('iframe,object,embed,video,audio,canvas,base,link[rel~="stylesheet"],link[rel~="preload"]'))issue('Only static HTML is allowed: no iframe, object, embed, video, audio, canvas, base or linked stylesheets.');
 for(const sheet of document.styleSheets){let rules=[];try{rules=[...sheet.cssRules];}catch{}
  for(const rule of rules){if(rule.type===CSSRule.FONT_FACE_RULE||rule.type===CSSRule.IMPORT_RULE)issue('Use system fonts only: no @font-face or @import.');}}
 const folder=location.href.replace(/[^/]*$/,'');
 for(const entry of performance.getEntriesByType('resource'))if(!entry.name.startsWith(folder)&&!entry.name.startsWith('data:'))issue('Only files in this folder may be used; found '+entry.name.slice(0,120));
 if(cards.length>spec.maxCards)issue(`There are ${cards.length} cards; use at most ${spec.maxCards}.`);
 const rects=cards.map(card=>card.getBoundingClientRect());
 cards.forEach((card,i)=>{const r=rects[i];if(Math.abs(r.width-spec.width)>0.5||Math.abs(r.height-spec.height)>0.5)issue(`Card ${i+1} is ${Math.round(r.width)}×${Math.round(r.height)} px; every card must be exactly ${spec.width}×${spec.height}.`);});
 cards.forEach((card,i)=>{for(let j=i+1;j<cards.length;j++){const a=rects[i],b=rects[j];if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)issue(`Cards ${i+1} and ${j+1} overlap; place cards one below the other.`);}});
 const cardOf=node=>cards.findIndex(card=>card.contains(node));
 const outside=(box,r,slack=0.5)=>box.left<r.left-slack||box.right>r.right+slack||box.top<r.top-slack||box.bottom>r.bottom+slack;
 const clippers=(el,card)=>{const list=[];for(let e=el.parentElement;e&&e!==card;e=e.parentElement){const s=getComputedStyle(e);if(/hidden|clip|scroll|auto/.test(s.overflowX+' '+s.overflowY))list.push(e);}return list;};
 const opacity=el=>{let value=1;for(let e=el;e&&e!==document.documentElement;e=e.parentElement)value*=Number(getComputedStyle(e).opacity);return value;};
 const lineBoxes=cards.map(()=>[]),pictureBoxes=cards.map(()=>[]);
 const decoration=cards.map(()=>[]);
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode())){
  const raw=node.textContent;if(!raw.trim())continue;
  const el=node.parentElement;if(!el||el.closest('style,title,head'))continue;
  const i=cardOf(node),text=raw.trim().replace(/\s+/g,' ').slice(0,24);
  if(i<0){issue(`Text "${text}" is outside every card.`);continue;}
  const s=getComputedStyle(el);
  if(s.visibility!=='visible'||opacity(el)<0.6)issue(`Card ${i+1}: "${text}" is hidden or faded below 60% opacity.`);
  if(parseFloat(s.fontSize)<spec.minFont)issue(`Card ${i+1}: "${text}" is set at ${s.fontSize}; no text may be smaller than ${spec.minFont}px.`);
  const alpha=/rgba?\(([^)]+)\)/.exec(s.color);if(alpha&&alpha[1].split(/[,/ ]+/).filter(Boolean).length===4&&parseFloat(alpha[1].split(/[,/ ]+/).filter(Boolean)[3])<0.6)issue(`Card ${i+1}: "${text}" has a text colour below 60% opacity.`);
  const range=document.createRange();range.selectNodeContents(node);
  const boxes=[...range.getClientRects()].filter(b=>b.width>0.5&&b.height>0.5);
  if(!boxes.length){issue(`Card ${i+1}: "${text}" takes no space on the card.`);continue;}
  const card=rects[i],low=Math.max(...boxes.map(b=>b.bottom));
  if(boxes.some(b=>outside(b,card)))issue(low>card.bottom?`Card ${i+1}: text runs ${Math.ceil(low-card.bottom)} px past the bottom of the card (from "${text}").`:`Card ${i+1}: "${text}" runs outside the card.`);
  for(const clip of clippers(el,cards[i])){const r=clip.getBoundingClientRect();if(boxes.some(b=>outside(b,r))){issue(`Card ${i+1}: "${text}" is cut off by a box with hidden overflow.`);break;}}
  for(const b of boxes)lineBoxes[i].push({b,node});
  if(!el.closest('[data-src],[data-quote]'))decoration[i].push(norm(raw));
 }
 // Text over text or over a picture cannot be read.
 cards.forEach((card,i)=>{
  const list=lineBoxes[i];
  for(let a=0;a<list.length;a++)for(let b=a+1;b<list.length;b++){
   if(list[a].node===list[b].node)continue;const p=list[a].b,q=list[b].b;
   const w=Math.min(p.right,q.right)-Math.max(p.left,q.left),h=Math.min(p.bottom,q.bottom)-Math.max(p.top,q.top);
   if(w>2&&h>2&&w*h>0.25*Math.min(p.width*p.height,q.width*q.height)){issue(`Card ${i+1}: "${list[a].node.textContent.trim().slice(0,16)}" overlaps "${list[b].node.textContent.trim().slice(0,16)}".`);}
  }
 });
 // Pictures: each once, loaded, large enough, whole, inside its card.
 const blockIds=new Set(spec.blocks.map(b=>b.id)),pictureCard={};
 for(const block of spec.blocks.filter(b=>b.type==='image')){
  const found=[...document.querySelectorAll('img[data-src]')].filter(img=>img.dataset.src===block.id);
  if(found.length!==1){issue(`Picture ${block.id} must appear exactly once as <img data-src="${block.id}" src="${block.src}"> (found ${found.length}).`);continue;}
  const img=found[0],i=cardOf(img),r=img.getBoundingClientRect();pictureCard[block.id]=i;
  if(i<0){issue(`Picture ${block.id} is outside every card.`);continue;}
  if(!img.complete||!img.naturalWidth)issue(`Picture ${block.id} did not load; use src="${block.src}".`);
  if(r.width<spec.minPictureWidth&&r.height<spec.minPictureHeight)issue(`Card ${i+1}: picture ${block.id} is shown at ${Math.round(r.width)}×${Math.round(r.height)} px; show it at least ${spec.minPictureWidth} px wide or ${spec.minPictureHeight} px tall.`);
  if(outside(r,rects[i],1))issue(`Card ${i+1}: picture ${block.id} runs outside the card.`);
  for(const clip of clippers(img,cards[i])){const c=clip.getBoundingClientRect();const kept=Math.max(0,Math.min(r.right,c.right)-Math.max(r.left,c.left))*Math.max(0,Math.min(r.bottom,c.bottom)-Math.max(r.top,c.top));if(kept<0.97*r.width*r.height){issue(`Card ${i+1}: picture ${block.id} is cut off by a box with hidden overflow.`);break;}}
  const fit=getComputedStyle(img).objectFit,shown=r.width/r.height,natural=img.naturalWidth/img.naturalHeight;
  if(img.naturalWidth&&fit!=='contain'&&fit!=='scale-down'&&1-Math.min(shown,natural)/Math.max(shown,natural)>0.06)issue(`Card ${i+1}: picture ${block.id} is ${fit==='cover'?'cropped':'stretched'}; show it whole at its own ratio (${block.width}:${block.height}).`);
  if(opacity(img)<0.9||getComputedStyle(img).visibility!=='visible')issue(`Card ${i+1}: picture ${block.id} is hidden or faded.`);
  pictureBoxes[i].push(r);
 }
 cards.forEach((card,i)=>{for(const {b,node} of lineBoxes[i])for(const r of pictureBoxes[i]){const w=Math.min(b.right,r.right)-Math.max(b.left,r.left),h=Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top);if(w>2&&h>2){issue(`Card ${i+1}: "${node.textContent.trim().slice(0,16)}" is drawn over a picture.`);break;}}});
 // Article text: every block complete, word for word, in order; nothing nested or unknown.
 const parts=new Map(),order=[];
 for(const el of document.querySelectorAll('[data-src]')){
  const id=el.dataset.src;
  if(!blockIds.has(id)){issue(`data-src="${id}" is not a block of this article.`);continue;}
  if(el.parentElement?.closest('[data-src]')){issue(`data-src="${id}" is inside another data-src element; do not nest them.`);continue;}
  if(el.tagName==='IMG'){order.push(id);continue;}
  if(!parts.has(id)){parts.set(id,[]);order.push(id);}
  parts.get(id).push({el,card:cardOf(el)});
 }
 for(const block of spec.blocks){
  if(block.type==='image')continue;
  const list=parts.get(block.id)||[];
  if(!list.length){issue(`Block ${block.id} is missing: "${block.text.slice(0,30)}…"`);continue;}
  const got=norm(list.map(part=>part.el.textContent).join('')),want=norm(block.text);
  if(got!==want){let k=0;while(k<got.length&&k<want.length&&got[k]===want[k])k++;
   issue(`Block ${block.id} differs from the article at character ${k+1}: the article has "${want.slice(Math.max(0,k-6),k+18)}" but the card has "${got.slice(Math.max(0,k-6),k+18)}". Copy the text exactly.`);}
  for(let j=1;j<list.length;j++)if(list[j].card<list[j-1].card)issue(`Block ${block.id}: its parts are out of order across cards.`);
  if(block.type==='caption'&&pictureCard[block.of]!==undefined&&list.some(part=>part.card!==pictureCard[block.of]))issue(`Caption ${block.id} must sit on the same card as its picture ${block.of}.`);
 }
 const expected=spec.blocks.map(b=>b.id).filter(id=>order.includes(id));
 if(order.join()!==expected.join()){const k=order.findIndex((id,j)=>id!==expected[j]);issue(`Blocks are out of reading order from ${order[k]} (expected ${expected[k]}).`);}
 const first=parts.get('title');if(first&&first.some(part=>part.card!==0))issue('The title must be on card 1.');
 const cover=spec.blocks.find(b=>b.type==='image');if(cover&&pictureCard[cover.id]!==0)issue(`Card 1 must carry the first picture (${cover.id}).`);
 // Words that are not the article's: a quote must be copied exactly; anything else may only be a short label.
 cards.forEach((card,i)=>{
  const quotes=[...card.querySelectorAll('[data-quote]')];
  if(quotes.length>1)issue(`Card ${i+1} has ${quotes.length} pull quotes; use at most one per card.`);
  for(const q of quotes){const source=spec.blocks.find(b=>b.id===q.dataset.quote);const t=norm(q.textContent);
   if(!source||!norm(source.text).includes(t))issue(`Card ${i+1}: the pull quote "${q.textContent.trim().slice(0,20)}" is not copied exactly from block ${q.dataset.quote}.`);
   else if([...t].length>spec.maxQuote)issue(`Card ${i+1}: the pull quote is longer than ${spec.maxQuote} characters.`);}
  const extra=decoration[i];
  for(const t of extra)if([...t].length>spec.maxLabel)issue(`Card ${i+1}: "${t.slice(0,20)}" is not article text; words of your own may only be short labels of at most ${spec.maxLabel} characters.`);
  const total=extra.reduce((n,t)=>n+[...t].length,0);
  if(total>spec.maxLabelsPerCard)issue(`Card ${i+1} has ${total} characters of labels; keep labels to ${spec.maxLabelsPerCard} characters per card.`);
 });
 return {issues,cards:rects.map(r=>({x:r.left+window.scrollX,y:r.top+window.scrollY}))};
}

/** Opens a card page, checks it and, when asked, takes every card as a PNG. */
export async function renderCardPage(chrome,file,spec,{shots=false}={}){
 const page=await chrome.page();
 try{
  await page.open(file);
  const report=await page.evaluate('('+checkCardsInPage.toString()+')('+JSON.stringify(spec)+')');
  const pngs=[];
  if(shots)for(const card of report.cards)pngs.push(await page.shot({x:card.x,y:card.y}));
  return {...report,pngs};
 }finally{await page.close();}
}
