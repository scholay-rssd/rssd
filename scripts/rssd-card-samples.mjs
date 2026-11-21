// Card sets for the 智能排版 (ai-code) and 模型生图 (ai-image) tabs of the Obsidian card view.
// For each work note it makes both sets, checks them, and puts them where the plug-in looks for them:
//   Card Samples/<note>/ai-code.png, ai-code/02.png …, ai-image.png, ai-image/02.png …, source.json
// source.json carries the note's fingerprint, so the plug-in refuses a set as soon as the note changes.
//
// 智能排版: Codex writes the whole article as static HTML cards; headless Chrome checks that every block is there word
// for word, nothing overflows, is hidden or too small, and takes each card as a PNG. Failed checks go back to Codex.
// 模型生图: Codex plans a few key-point cards with short lettering; the image model draws each card, lettering included;
// macOS text recognition reads the lettering back and a card is redrawn when it does not match. A small label adds
// the site and the page to every model-drawn card; no AI label (the owner marks AI content per work and platform).
// English works get only 智能排版 for now: no extra pictures are drawn for them unless --english-image-cards.
//
// Runs can stop at any point (a crash, a Codex usage limit) and be started again: finished sets are skipped, a
// checked cards.html and every drawing already made are reused, and no Codex request is ever sent twice.
import {mkdir,readFile,writeFile,rm,access,readdir} from 'node:fs/promises';
import {join,dirname,basename,resolve,relative,sep} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
// The same yaml version as the plug-in (obsidian/package.json), so a note's fingerprint matches the one it computes.
import YAML from 'yaml';
import {noteToWork,workFingerprint,localMediaPaths} from '../obsidian/src/sync-model.mjs';
import {launchChrome,renderCardPage,CARD} from './rssd-card-render.mjs';
import {createCodexImageProvider,runCodexExec} from './rssd-codex-image-provider.mjs';
import {HOUSE_STYLE} from './rssd-image-supplement.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const exists=path=>access(path).then(()=>true,()=>false);
const chars=value=>[...String(value)].length;
const sha=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const norm=value=>String(value).normalize('NFKC').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,'');

export const PALETTE={paper:'#fbf6ee',ink:'#33291f',muted:'#7a6a58',accent:'#8a633b'};
export const CODE_RULES={width:CARD.width,height:CARD.height,maxCards:40,minFont:22,minPictureWidth:600,minPictureHeight:480,maxQuote:60,maxLabel:12,maxLabelsPerCard:40};
export const LOCALES={
 'zh-CN':{brand:'小猪萌宠',rules:{maxQuote:60,maxLabel:12,maxLabelsPerCard:40},
  lettering:/^[\p{Script=Han}A-Za-z0-9０-９%％℃～~，、：；。！？·—\-.]+$/u,headline:{cover:14,other:12},line:18,editsPer:10},
 en:{brand:'pet.piggytuck.com',rules:{maxQuote:160,maxLabel:24,maxLabelsPerCard:70},
  lettering:/^[A-Za-z0-9 ,.:;!?'’\-–%°℃~&]+$/u,headline:{cover:36,other:28},line:38,editsPer:15}};
const localeOf=note=>LOCALES[note.work.data.locale]||LOCALES['zh-CN'];
const english=note=>note.work.data.locale==='en';

// ---------------------------------------------------------------------------------------------- Codex usage limits

export const LIMIT=/usage limit|rate.?limit|quota|\b429\b|too many requests|limit reached|try again (in|later)/i;
/** Shared pause: when any run meets a Codex usage limit, every job waits before its next request. */
export function makeLimiter({pauseMs=20*60000,maxPausedMs=24*3600000,log=()=>{}}={}){
 let until=0,paused=0;
 return {
  async ready(){while(Date.now()<until)await sleep(Math.min(until-Date.now(),60000));},
  hit(message){
   const now=Date.now();
   if(until<=now){until=now+pauseMs;paused+=pauseMs;log('Codex usage limit ('+String(message).slice(0,140)+'); pausing '+pauseMs/60000+' min');}
   if(paused>maxPausedMs)throw Object.assign(Error('Codex stayed at its usage limit for too long'),{stop:true});
  }
 };
}
const noLimiter={ready:async()=>{},hit:message=>{throw Object.assign(Error('Codex usage limit: '+message),{stop:true});}};

// ---------------------------------------------------------------------------------------------- the note

/** The note as the plug-in sees it, with the fingerprint the plug-in will compare against. */
export async function readWork(file){
 const content=await readFile(file,'utf8'),work=noteToWork(content,text=>YAML.parse(text));
 if(!work)throw Error(file+' is not an RSSD work note');
 const parts=resolve(file).split(sep),at=parts.lastIndexOf('Works');
 if(at<0)throw Error(file+' is not inside a Works folder');
 const vault=parts.slice(0,at).join(sep),name=parts.slice(at+1).join('/').replace(/\.md$/,'');
 return {file:resolve(file),vault,name,work,title:work.data.title,body:content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,''),
  fingerprint:await workFingerprint(work.data,localMediaPaths(work.media))};
}

const REFERENCES=/^\s*(参考文献|参考资料|延伸阅读|相关阅读|references?|sources|further reading)\s*$/i;
/** Markdown inline text as readers see it: link text without the address, no emphasis marks or tags. */
export function plain(markdown){
 return String(markdown).replace(/!\[[^\]]*\]\([^)]*\)/g,'')
  .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^()]*\))*\)/g,'$1')
  .replace(/(\*\*|__)(.+?)\1/g,'$2').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g,'$1$2')
  .replace(/`([^`]+)`/g,'$1').replace(/<[^>]+>/g,'').replace(/\s*\n\s*/g,' ').trim();
}

/** The article in reading order: title, headings, paragraphs, lists, tables, pictures with captions, references. */
export function articleBlocks(body,title){
 const blocks=[],count={},next=prefix=>prefix+(count[prefix]=(count[prefix]||0)+1);
 let references=false,lastImage=null;
 for(const chunk of body.replace(/\r\n/g,'\n').split(/\n{2,}/).map(c=>c.trim()).filter(Boolean)){
  const heading=/^(#{1,6})\s+(.+)$/.exec(chunk);
  if(heading&&!chunk.includes('\n')){
   const text=plain(heading[2]);lastImage=null;
   if(heading[1].length===1&&norm(text)===norm(title)){if(!blocks.some(b=>b.id==='title'))blocks.push({id:'title',type:'title',text:title});continue;}
   references=REFERENCES.test(text);blocks.push({id:next('h'),type:'heading',level:heading[1].length,text});continue;
  }
  const image=/^!\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)$/.exec(chunk);
  if(image){blocks.push(lastImage={id:next('img'),type:'image',alt:image[1],file:basename(decodeURIComponent(image[2]))});continue;}
  if(/^\|/.test(chunk)){
   const table=next('table');let head=true;
   for(const row of chunk.split('\n').map(r=>r.trim()).filter(r=>r.startsWith('|'))){
    const cells=row.replace(/^\||\|$/g,'').split('|').map(cell=>plain(cell.trim()));
    if(cells.every(cell=>/^:?-{2,}:?$/.test(cell))){continue;}
    blocks.push({id:next('row'),type:head?'table-head':'table-row',table,cells,text:cells.join(' ')});head=false;
   }
   lastImage=null;continue;
  }
  if(/^([-*+]|\d+[.)])\s/.test(chunk)){
   for(const item of chunk.split(/\n(?=(?:[-*+]|\d+[.)])\s)/)){
    const match=/^(?:[-*+]|(\d+)[.)])\s+([\s\S]*)$/.exec(item.trim());let text=plain(match[2]);
    if(references){if(match[1]&&!/^\[\d+\]/.test(text))text='['+match[1]+'] '+text;blocks.push({id:next('r'),type:'reference',text});}
    else blocks.push({id:next('li'),type:'list-item',ordered:!!match[1],text});
   }
   lastImage=null;continue;
  }
  if(/^>/.test(chunk)){blocks.push({id:next('q'),type:'quote',text:plain(chunk.replace(/^>\s?/gm,''))});lastImage=null;continue;}
  const text=plain(chunk);
  if(lastImage&&(chars(text)<=(/[\p{Script=Han}]/u.test(text)?90:220)||/^(图|Figure)\s*[:：.]/.test(text))){blocks.push({id:next('cap'),type:'caption',of:lastImage.id,text});lastImage=null;continue;}
  blocks.push({id:next('p'),type:'paragraph',text});lastImage=null;
 }
 if(!blocks.some(b=>b.id==='title'))blocks.unshift({id:'title',type:'title',text:title});
 return blocks;
}

// ---------------------------------------------------------------------------------------------- Codex helpers

function codexJson({prompt,directory,schema,name,command=['npx','-y','@openai/codex'],timeoutMs=900000}){
 return new Promise((done,fail)=>{
  const schemaFile=join(directory,name+'-schema.json'),out=join(directory,name+'.json');
  writeFile(schemaFile,JSON.stringify(schema)).then(()=>{
   const child=spawn(command[0],[...command.slice(1),'exec','--skip-git-repo-check','--sandbox','read-only','-C',directory,'--output-schema',schemaFile,'-o',out,'-'],{stdio:['pipe','ignore','pipe'],timeout:timeoutMs});
   let errors='';child.stderr.on('data',c=>{errors=(errors+c).slice(-2000);});child.on('error',fail);
   child.on('close',async code=>{if(code!==0)return fail(Error('Codex planning failed: '+errors.trim().slice(-400)));try{done(JSON.parse(await readFile(out,'utf8')));}catch(e){fail(e);}});
   child.stdin.end(prompt);
  },fail);
 });
}

// ---------------------------------------------------------------------------------------------- 智能排版

export const codeRules=note=>({...CODE_RULES,...localeOf(note).rules});

export function codeBrief(note,blocks,rules=codeRules(note)){
 const en=english(note),brand=localeOf(note).brand;
 const article=blocks.map(b=>b.type==='image'?{id:b.id,type:'image',src:'media/'+b.file,alt:b.alt,width:b.width,height:b.height}:b);
 return `You are the layout designer (智能排版) for ${brand}, a pet-care site. Turn the ${en?'English':'Chinese'} article in article.json into a set of picture cards for a phone feed by writing one file, cards.html, in this folder. Do not create or change any other file. Do not browse or use the network.

THE CARDS
- cards.html is static HTML and CSS only: no <script>, no external URLs, no @font-face or @import, no canvas, iframe or video. Pictures come only from the media/ folder.
- Each card is <section class="card"> with width:${rules.width}px; height:${rules.height}px; box-sizing:border-box; overflow:hidden; position:relative. Put the cards one below the other with no gap (body margin 0).
- Use as many cards as the article needs, at most ${rules.maxCards}. Never squeeze text to save a card.

THE ARTICLE, WORD FOR WORD
- article.json lists the blocks in reading order. Every block must appear, in the same order, with its text copied exactly: do not add, drop, shorten, reword, translate or re-punctuate anything, and keep citation marks such as [1] or [1, 2].
- Wrap each block's text in an element with data-src="<block id>", for example <p data-src="p3">…</p> or <h2 data-src="h2">…</h2>. Never nest data-src elements. Inline styling inside them (strong, span, sup) is fine as long as the text is unchanged.
- A long block may continue on the next card: split it at any character and wrap each part in its own element with the same data-src. The parts, joined, must equal the block's text.
- Blocks of type table-head and table-row are the rows of one table (same "table" value): render them as one <table>, each row as <tr data-src="<row id>"> with one cell per entry of "cells", in order (th for the head row). A long table may continue on the next card, but do not repeat the head row.
- Pictures: <img data-src="<id>" src="media/<file>" alt="<alt>">, each exactly once, shown whole at its own ratio (width and height are given; no cropping, no stretching), at least ${rules.minPictureWidth} px wide. A picture's caption block goes directly under it, on the same card.
- Card 1 is the cover: the title (block "title") set large, the first picture with its caption when the article has pictures, and the start of the text if it fits.
- References come last, in smaller type.

YOUR OWN TOUCHES
- Short labels of your own are allowed, at most ${rules.maxLabel} characters each and ${rules.maxLabelsPerCard} characters per card: the site name ${brand}, page numbers like 3/9, chapter numbers like 01, ${en?'words like Key points or Tip':'words like 要点 or 小贴士'}.
- One pull quote per card at most: a sentence copied exactly from a block, in an element with data-quote="<block id>", at most ${rules.maxQuote} characters. The block itself must still appear in full.
- Decorate with CSS (colour fields, rules, rounded boxes, soft highlights behind key phrases, dashed frames) and inline SVG shapes without any <text>. No emoji.

LOOK
- Warm, calm, friendly and magazine-like, clearly designed rather than a plain document. Paper ${PALETTE.paper}, ink ${PALETTE.ink}, muted ${PALETTE.muted}, accent ${PALETTE.accent} (the site's brown), with soft tints of sage #b9c4a7, oat #e9dcc4 and terracotta #c98f6f.
- Fonts: ${en?'"Avenir Next" for text; "Georgia" may be used for titles':'"PingFang SC" for text; "Songti SC" may be used for titles'}. No other fonts.
- Body text 32 to 36 px with line height 1.6 to 1.8; headings clearly larger; captions and references at least 24 px; nothing smaller than ${rules.minFont} px; all text at least 60% opaque; no text over a picture or over other text.
- Fill each card well, but keep every card's padding clear: text must never touch or cross a card's edge.

SPACE GUIDE
- With 80 px side padding, a 920 px column of 34 px text holds about ${en?'50 characters (8 to 9 English words)':'27 Chinese characters'} per line, about 58 px per line at line height 1.7. A card with a 130 px band for header and footer holds about 18 lines of text when it has no picture. A picture 920 px wide is 920 × height ÷ width px tall.
- Plan the page breaks from these numbers with a safety margin of two lines; it is fine to end a card a little early.

article.json:
${JSON.stringify({title:note.title,site:brand,blocks:article},null,1)}

When cards.html is written, reply with one word: done.`;
}

export async function makeCodeCards(note,{directory,chrome,blocks,rounds=4,log=()=>{},run=runCodexExec,limiter=noLimiter}){
 await mkdir(join(directory,'media'),{recursive:true});
 for(const block of blocks.filter(b=>b.type==='image'))await writeFile(join(directory,'media',block.file),await readFile(join(note.vault,'article-media',block.file)));
 const brief=codeBrief(note,blocks),html=join(directory,'cards.html');await writeFile(join(directory,'brief.md'),brief);
 const spec={...codeRules(note),blocks:blocks.map(b=>b.type==='image'?{...b,src:'media/'+b.file}:b)};
 const threads=[];let issues=null,round=0,limits=0;
 const check=async label=>{
  const report=await renderCardPage(chrome,html,spec,{shots:true});
  await writeFile(join(directory,'check-'+label+'.json'),JSON.stringify({issues:report.issues},null,1));
  return report;
 };
 if(await exists(html)){
  const report=await check('resume');
  if(!report.issues.length){log('智能排版 reused a checked set of '+report.pngs.length+' cards');return {pages:report.pngs,threads,rounds:0};}
  issues=report.issues;round=1;
 }
 while(round<rounds){
  const repair=issues&&await exists(html);
  const prompt=!repair?brief:'cards.html in this folder was checked in Chrome and has these problems:\n'+issues.slice(0,40).map(i=>'- '+i).join('\n')+
   (issues.length>40?'\n- … and '+(issues.length-40)+' more of the same kinds':'')+
   '\n\nRead cards.html, then fix it in place so that none of these problems remain, changing only what is needed. All the rules of the original brief still apply; here it is again:\n\n'+brief;
  log('智能排版 round '+(round+1)+(repair?' ('+issues.length+' problems to fix)':''));
  await limiter.ready();
  try{const result=await run({prompt,cwd:directory,sandbox:'workspace-write',timeoutMs:1500000});if(result?.threadId)threads.push(result.threadId);}
  catch(error){
   if(error.threadId)threads.push(error.threadId);
   if(LIMIT.test(error.message)){limiter.hit(error.message);if(++limits>30)throw error;continue;}
   round++;issues=['Codex did not finish: '+error.message];continue;
  }
  round++;
  if(!await exists(html)){issues=['cards.html was not written.'];continue;}
  const report=await check(String(round));issues=report.issues;
  if(!issues.length){log('智能排版 passed with '+report.pngs.length+' cards (round '+round+')');return {pages:report.pngs,threads,rounds:round};}
 }
 throw Object.assign(Error('智能排版 still has '+issues.length+' problems: '+issues.slice(0,3).join(' | ')),{issues,threads});
}

// ---------------------------------------------------------------------------------------------- 模型生图

export const IMAGE_PLAN_SCHEMA={type:'object',additionalProperties:false,required:['cards'],properties:{cards:{type:'array',items:{
 type:'object',additionalProperties:false,required:['role','headline','lines','scene','from'],properties:{
  role:{type:'string',enum:['cover','point','closing']},headline:{type:'string'},lines:{type:'array',items:{type:'string'}},
  scene:{type:'string'},from:{type:'array',items:{type:'string'}}}}}}};

export function validateImagePlan(plan,blocks,locale='zh-CN'){
 const rules=LOCALES[locale]||LOCALES['zh-CN'],cards=plan?.cards,ids=new Set(blocks.map(b=>b.id)),problems=[];
 if(!Array.isArray(cards)||cards.length<5||cards.length>7)return ['Plan 5 to 7 cards.'];
 cards.forEach((card,i)=>{
  const where='Card '+(i+1)+': ',cover=i===0,most=cover?rules.headline.cover:rules.headline.other;
  if(cover!==(card.role==='cover'))problems.push(where+'only the first card is the cover.');
  if(i===cards.length-1&&card.role!=='closing')problems.push(where+'the last card is the closing card.');
  if(chars(card.headline)<2||chars(card.headline)>most)problems.push(where+'the headline must be 2 to '+most+' characters.');
  if(!Array.isArray(card.lines)||card.lines.length>(cover?1:3)||(!cover&&!card.lines.length))problems.push(where+(cover?'at most one subtitle line.':'1 to 3 lines.'));
  for(const line of [card.headline,...(card.lines||[])]){
   if(!rules.lettering.test(line))problems.push(where+'"'+line+'" '+(locale==='en'?'may only use letters, digits, spaces and simple punctuation.':'may only use Chinese characters, digits, abbreviations and Chinese punctuation, with no spaces.'));
   if(line!==card.headline&&chars(line)>rules.line)problems.push(where+'"'+line+'" is longer than '+rules.line+' characters.');
  }
  if(chars(card.scene)<20||chars(card.scene)>400)problems.push(where+'describe the scene in 20 to 400 characters.');
  if(!card.from?.length||card.from.some(id=>!ids.has(id)))problems.push(where+'"from" must list the article blocks the card is based on.');
 });
 return problems;
}

function imagePlanPrompt(note,blocks,problems){
 const en=english(note),r=localeOf(note);
 const article=blocks.filter(b=>b.type!=='image').map(b=>({id:b.id,type:b.type,text:b.text}));
 return `You plan a set of model-drawn picture cards (模型生图) for ${en?'an English':'a Chinese'} pet-care article on the site ${r.brand}. An image model will draw each card, lettering included, so the lettering must be short.

Plan 5 to 7 cards in the article's order:
- Card 1, role "cover": headline = a short form of the article title, at most ${r.headline.cover} characters; lines = [] or one subtitle line of at most ${r.line} characters.
- Middle cards, role "point": one key point each. headline at most ${r.headline.other} characters; 1 to 3 lines, each at most ${r.line} characters.
- Last card, role "closing": what a reader should remember or do. headline at most ${r.headline.other} characters; 1 to 3 lines of at most ${r.line} characters.
Lettering rules: ${en?"plain English; letters, digits, spaces and . , : ; ! ? ' - % °C only":'simplified Chinese with no spaces; digits, %, ℃ and ～ are fine; Latin letters only for established abbreviations such as DNA or qPCR, never English words'}; no brand or site names, no quotation marks or brackets, no emoji.
Count the characters of every line before you answer, digits and punctuation included, and shorten any line over its limit (for example write 8月至10月 rather than 从2026年8月1日持续至10月).
Every statement must be stated in the article; add no advice, numbers or claims that are not there. List in "from" the block ids each card is based on.
scene: what the illustration on that card shows (animals, objects, setting), in English, one or two sentences, content only: no style words and no text or signs in the scene. It must agree with the article (the right animal, the right food or equipment).
${problems?.length?'\nA previous plan was refused for these reasons; avoid them:\n'+problems.map(p=>'- '+p).join('\n')+'\n':''}
Article: ${JSON.stringify({title:note.title,blocks:article})}`;
}

function cardRequirement(note,card,index,total){
 const en=english(note),role=card.role==='cover'?'the cover':card.role==='closing'?'the closing card':'a key-point card';
 return `Picture card ${index} of ${total} for ${en?'an English':'a Chinese'} pet-care post titled ${en?'"'+note.title+'"':'「'+note.title+'」'} (${role}).
Layout: a calm editorial card on plain warm paper. The lettering sits in the upper part, the illustration fills the middle and lower part. Keep the top 6% and the bottom 14% of the picture as plain paper with nothing drawn or written there.
Lettering style: ${en?'clean, bold, rounded sans-serif letters':'clean, bold, rounded simplified-Chinese characters'} in dark warm brown (#5a4130), large and perfectly legible; the first line largest as the headline, the other lines smaller, each on its own line.
Illustration: ${card.scene}`;
}

const strip=(value,lower=false)=>[...(lower?String(value).toLowerCase():String(value)).normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'')];
/** Smallest number of edits that turns `pattern` into some stretch of `text` (both arrays of characters). */
export function editsInside(pattern,text){
 let previous=new Array(text.length+1).fill(0);
 for(let i=1;i<=pattern.length;i++){
  const current=[i];
  for(let j=1;j<=text.length;j++)current[j]=Math.min(previous[j]+1,current[j-1]+1,previous[j-1]+(pattern[i-1]===text[j-1]?0:1));
  previous=current;
 }
 return Math.min(...previous);
}

/** Where the 1080×1440 card is cut from the drawing, and the part of the drawing that lettering may use. */
export function cardWindow(width,height){
 const scale=CARD.width/width,tall=height*scale;
 if(tall>=CARD.height){const top=Math.round((tall-CARD.height)/3);return {scale,left:0,top,safe:{x0:0.02,x1:0.98,y0:(top+12)/tall,y1:(top+CARD.height-90)/tall}};}
 const s=CARD.height/height,wide=width*s,left=Math.round((wide-CARD.width)/2);
 return {scale:s,left,top:0,safe:{x0:(left+12)/wide,x1:(left+CARD.width-12)/wide,y0:0.02,y1:(CARD.height-90)/CARD.height}};
}

/** Compares the lettering read from a drawing with the planned lines. */
export function checkLettering(expected,lines,window,locale='zh-CN'){
 const lower=locale==='en',per=(LOCALES[locale]||LOCALES['zh-CN']).editsPer;
 const read=lines.filter(l=>l.confidence>=0.3&&strip(l.text,lower).length);
 const all=read.flatMap(l=>strip(l.text,lower)),wanted=expected.flatMap(line=>strip(line,lower)),problems=[];
 for(const line of expected){const want=strip(line,lower),edits=editsInside(want,all);if(edits>Math.floor(want.length/per))problems.push(`「${line}」 is not drawn correctly (${edits} wrong characters).`);}
 for(const l of read){
  const got=strip(l.text,lower);
  if(got.length>=2&&editsInside(got,wanted)>Math.floor(got.length/5))problems.push(`Extra text in the drawing: 「${l.text}」.`);
  else if(l.x<window.safe.x0||l.x+l.w>window.safe.x1||l.y<window.safe.y0||l.y+l.h>window.safe.y1)problems.push(`「${l.text}」 sits too close to the edge and would be cut or covered.`);
 }
 return problems;
}

async function ocr(files,binary){
 return new Promise((done,fail)=>execFile(binary,files,{maxBuffer:16<<20},(error,stdout)=>error?fail(error):done(JSON.parse(stdout))));
}

function composeHtml(drawing,window,label){
 const width=Math.round(window.scale*drawing.width),height=Math.round(window.scale*drawing.height);
 return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${PALETTE.paper}}
.card{position:relative;width:${CARD.width}px;height:${CARD.height}px;overflow:hidden;background:${PALETTE.paper}}
.card img{position:absolute;left:${-window.left}px;top:${-window.top}px;width:${width}px;height:${height}px}
.label{position:absolute;right:30px;bottom:26px;font:500 24px/1 "PingFang SC","Avenir Next",sans-serif;letter-spacing:1px;color:${PALETTE.muted};background:rgba(251,246,238,.9);padding:11px 18px;border-radius:999px}
</style><div class="card"><img src="${drawing.file}"><div class="label">${label}</div></div>`;
}

export async function makeImageCards(note,{directory,chrome,blocks,provider,ocrBinary,attempts=3,maxRequests=10,log=()=>{},planner=codexJson,limiter=noLimiter}){
 await mkdir(directory,{recursive:true});
 const locale=note.work.data.locale,r=localeOf(note);
 let plan=null,problems=[],limits=0;
 try{plan=JSON.parse(await readFile(join(directory,'plan.json'),'utf8'));if(validateImagePlan(plan,blocks,locale).length)plan=null;}catch{plan=null;}
 for(let round=1;!plan&&round<=5;){
  log('模型生图 plan round '+round);
  await limiter.ready();
  let candidate;
  try{candidate=await planner({prompt:imagePlanPrompt(note,blocks,problems),directory,schema:IMAGE_PLAN_SCHEMA,name:'plan-draft'});}
  catch(error){if(LIMIT.test(error.message)){limiter.hit(error.message);if(++limits>30)throw error;continue;}throw error;}
  round++;problems=validateImagePlan(candidate,blocks,locale);
  if(!problems.length){plan=candidate;await writeFile(join(directory,'plan.json'),JSON.stringify(plan,null,1));}
 }
 if(!plan)throw Object.assign(Error('模型生图 plan was refused: '+problems.slice(0,3).join(' | ')),{issues:problems});
 const pages=[],drawn=[],flags=[],total=plan.cards.length;
 for(const [i,card] of plan.cards.entries()){
  const lettering=[card.headline,...card.lines],scope={requirement:cardRequirement(note,card,i+1,total),style:HOUSE_STYLE,lettering,aspect:'portrait'};
  let best=null,checked=0;
  for(let n=1;n<=maxRequests&&checked<attempts&&!(best&&!best.issues.length);n++){
   const requestId='card-'+sha(JSON.stringify([note.work.data.id,locale,i,lettering,card.scene,n])).slice(0,40);
   let result=await provider.lookup({requestId,scope}),fresh=false;
   if(!await provider.record(requestId)){
    await limiter.ready();
    log(`模型生图 card ${i+1}/${total} drawing ${n}`);
    result=await provider.start({requestId,scope});fresh=true;
   }
   if(result.status!=='ready'){
    const reason=(await provider.record(requestId))?.error||result.reason||'no drawing';
    // A request stopped by a usage limit is skipped; only a new one pauses the batch.
    if(LIMIT.test(reason)){if(fresh){limiter.hit(reason);if(++limits>30)throw Error('Codex usage limit: '+reason);}continue;}
    // A drawing cut off by an earlier stop (no thread, no error) is skipped without counting as a try.
    if(!fresh&&(await provider.record(requestId))?.phase==='running')continue;
    checked++;flags.push(`Card ${i+1}, drawing ${n}: ${String(reason).slice(0,160)}`);continue;
   }
   checked++;
   const file=join(directory,`drawn-${String(i+1).padStart(2,'0')}-${n}.png`);
   if(!await exists(file))await writeFile(file,await sharp(result.bytes).png().toBuffer());
   const meta=await sharp(file).metadata(),window=cardWindow(meta.width,meta.height);
   const [read]=await ocr([file],ocrBinary);
   const issues=checkLettering(lettering,read.lines||[],window,locale);
   const candidate={file,width:meta.width,height:meta.height,window,issues,provenance:result.provenance,read:(read.lines||[]).map(l=>l.text)};
   if(!best||issues.length<best.issues.length)best=candidate;
   if(issues.length)log(`模型生图 card ${i+1} drawing ${n}: ${issues.join(' ')}`);
  }
  if(!best)throw Error('模型生图 card '+(i+1)+' could not be drawn');
  if(best.issues.length)flags.push(`Card ${i+1}: ${best.issues.join(' ')}`);
  const html=join(directory,`card-${String(i+1).padStart(2,'0')}.html`);
  await writeFile(html,composeHtml({file:basename(best.file),width:best.width,height:best.height},best.window,`${r.brand} · ${i+1}/${total}`));
  const page=await chrome.page();
  try{await page.open(html);pages.push(await page.shot());}finally{await page.close();}
  drawn.push({card:i+1,lettering,file:basename(best.file),threadId:best.provenance?.threadId||null,model:best.provenance?.model||null,service:best.provenance?.service||null,read:best.read,issues:best.issues});
 }
 log('模型生图 made '+pages.length+' cards'+(flags.length?' with '+flags.length+' flags':''));
 return {pages,drawn,flags,plan};
}

// ---------------------------------------------------------------------------------------------- the vault

const smaller=png=>sharp(png).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();

/** Writes the sets where the plug-in reads them; refuses when the note changed while the cards were made. */
export async function installSamples(note,sets,meta,{compress=true}={}){
 const current=await readWork(note.file);
 if(current.fingerprint!==note.fingerprint)throw Error(note.title+' changed while its cards were made; nothing was installed');
 const target=join(note.vault,'Card Samples',note.name);
 let previous=null;try{previous=JSON.parse(await readFile(join(target,'source.json'),'utf8'));}catch{}
 const same=previous?.sourceHash===note.fingerprint,pageCounts=same?{...previous.pageCounts}:{};
 if(previous&&!same)for(const style of ['ai-code','ai-image']){await rm(join(target,style),{recursive:true,force:true});await rm(join(target,style+'.png'),{force:true});}
 for(const [style,pages] of Object.entries(sets)){
  const files=compress?await Promise.all(pages.map(smaller)):pages;
  await rm(join(target,style),{recursive:true,force:true});await mkdir(join(target,style),{recursive:true});
  await writeFile(join(target,style+'.png'),files[0]);
  for(let i=1;i<files.length;i++)await writeFile(join(target,style,String(i+1).padStart(2,'0')+'.png'),files[i]);
  pageCounts[style]=files.length;
 }
 await writeFile(join(target,'source.json'),JSON.stringify({sourceHash:note.fingerprint,pageCounts,title:note.title,createdAt:new Date().toISOString(),
  producer:'rssd-card-samples',made:{...(same?previous.made:{}),...meta}},null,2)+'\n');
 return target;
}

/** The styles a note gets: 智能排版 only in the chosen sections, and no model-drawn set for an English work. */
export function cardStyles(note,styles,{codeSections=null,englishImageCards=false}={}){
 return styles.filter(style=>!(style==='ai-code'&&codeSections&&!codeSections.includes(note.work.data.sectionId))&&!(style==='ai-image'&&english(note)&&!englishImageCards));
}

/** The styles a note still needs: none when its installed sets match the note as it is now. */
export async function missingStyles(note,styles){
 try{const source=JSON.parse(await readFile(join(note.vault,'Card Samples',note.name,'source.json'),'utf8'));
  if(source.sourceHash===note.fingerprint)return styles.filter(style=>!(source.pageCounts?.[style]>0));}catch{}
 return styles;
}

export async function makeSamples(file,{out,chrome,provider,ocrBinary,styles=['ai-code','ai-image'],codeSections=null,englishImageCards=false,install=true,force=false,limiter=noLimiter,log=console.log}){
 const note=await readWork(file),directory=join(out,note.name.replace(/\//g,'_'));
 // A whole-article card page (智能排版) only where the section gives its articles one.
 styles=cardStyles(note,styles,{codeSections,englishImageCards});
 const say=message=>log(`[${new Date().toISOString().slice(11,19)}] ${note.title.slice(0,14)}: ${message}`);
 let needed=force?styles:await missingStyles(note,styles);
 if(!needed.length)return {title:note.title,name:note.name,skipped:true};
 const blocks=articleBlocks(note.body,note.title),away=[];
 for(const block of blocks.filter(b=>b.type==='image')){
  const path=join(note.vault,'article-media',block.file);
  if(!await exists(path)){away.push(block.file);continue;}
  const m=await sharp(path).metadata();block.width=m.width;block.height=m.height;
 }
 // Card pages cannot reach the web, so a work showing pictures from elsewhere gets no 智能排版 set until they are local.
 const codeSkipped=away.length&&needed.includes('ai-code')?'pictures not in article-media: '+away.join(', '):null;
 if(codeSkipped){needed=needed.filter(style=>style!=='ai-code');say('智能排版 skipped: '+codeSkipped);}
 if(!needed.length)return {title:note.title,name:note.name,'ai-code':{skipped:codeSkipped}};
 await mkdir(directory,{recursive:true});await writeFile(join(directory,'article.json'),JSON.stringify({fingerprint:note.fingerprint,blocks},null,1));
 const jobs={};
 if(needed.includes('ai-code'))jobs['ai-code']=makeCodeCards(note,{directory:join(directory,'ai-code'),chrome,blocks,log:say,limiter});
 if(needed.includes('ai-image'))jobs['ai-image']=makeImageCards(note,{directory:join(directory,'ai-image'),chrome,blocks,provider,ocrBinary,log:say,limiter});
 const settled=Object.fromEntries(await Promise.all(Object.entries(jobs).map(async([style,job])=>[style,await job.then(value=>({value}),error=>({error}))])));
 const sets={},meta={},report={title:note.title,name:note.name,locale:note.work.data.locale,fingerprint:note.fingerprint,...(codeSkipped?{'ai-code':{skipped:codeSkipped}}:{})};
 for(const [style,{value,error}] of Object.entries(settled)){
  if(error){report[style]={error:error.message,issues:error.issues||[]};say(style+' failed: '+error.message);if(error.stop)report.stop=true;continue;}
  sets[style]=value.pages;
  meta[style]=style==='ai-code'?{agent:'Codex',threads:value.threads,rounds:value.rounds}:{agent:'Codex',drawn:value.drawn,flags:value.flags};
  report[style]={cards:value.pages.length,...(value.flags?.length?{flags:value.flags}:{}),...(value.rounds!==undefined?{rounds:value.rounds}:{})};
 }
 if(install&&Object.keys(sets).length){
  try{report.installed=relative(note.vault,await installSamples(note,sets,meta));say('installed '+Object.keys(sets).join(' + '));}
  catch(error){report.installError=error.message;say(error.message);}
 }
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,1));
 return report;
}

/** Every work note in a vault that should have card sets: articles, not structured records or archive pages. */
export async function vaultWorks(vault){
 const files=[];
 for(const folder of [join(vault,'Works'),join(vault,'Works','en')]){
  let names=[];try{names=(await readdir(folder)).filter(f=>f.endsWith('.md')).sort();}catch{}
  for(const name of names){
   const file=join(folder,name);let note;try{note=await readWork(file);}catch{continue;}
   if(note.work.kind==='news'&&note.work.data.sectionId!=='archive')files.push(file);
  }
 }
 return files;
}

async function batch(files,{out,styles,codeSections=null,englishImageCards=false,force,concurrency,provider,ocrBinary,limiter,install=true,log}){
 const queue=[...files],results=[],running=new Set(),started=new Date().toISOString();let stopped=false;
 const status=async()=>{
  const done=results.filter(r=>r.installed).length,skipped=results.filter(r=>r.skipped).length;
  const failed=results.filter(r=>r.error||r.installError||styles.some(s=>r[s]?.error));
  const flagged=results.filter(r=>r['ai-image']?.flags?.length);
  await writeFile(join(out,'status.json'),JSON.stringify({started,updated:new Date().toISOString(),total:files.length,finished:results.length,
   installed:done,skipped,failed:failed.length,flagged:flagged.length,running:[...running],stopped,remaining:queue.length},null,1));
 };
 async function worker(){
  while(queue.length&&!stopped){
   const file=queue.shift();running.add(basename(file));await status();
   let chrome=null;
   try{chrome=await launchChrome();const report=await makeSamples(file,{out,chrome,provider,ocrBinary,styles,codeSections,englishImageCards,force,limiter,install,log});results.push(report);if(report.stop)stopped=true;}
   catch(error){results.push({file,error:error.message});log('FAILED '+basename(file)+': '+error.message);if(error.stop)stopped=true;}
   finally{if(chrome)await chrome.close();running.delete(basename(file));await writeFile(join(out,'reports.json'),JSON.stringify(results,null,1));await status();}
  }
 }
 await Promise.all(Array.from({length:concurrency},worker));
 return {results,stopped};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),take=flag=>{const i=args.indexOf(flag);if(i<0)return null;const [value]=args.splice(i,2).slice(1);return value;};
 const flag=name=>{const i=args.indexOf(name);if(i<0)return false;args.splice(i,1);return true;};
 const out=take('--out'),vault=take('--vault'),styles=(take('--styles')||'ai-code,ai-image').split(','),concurrency=Number(take('--concurrency')||4);
 const codeSections=take('--code-sections')?.split(',')||null;
 const noInstall=flag('--no-install'),force=flag('--force'),englishImageCards=flag('--english-image-cards');
 const notes=vault?await vaultWorks(resolve(vault)):args;
 if(!out||!notes.length){console.error('Usage: node scripts/rssd-card-samples.mjs --out <dir> [--vault <vault> | <note.md>…] [--styles ai-code,ai-image] [--concurrency 4] [--force] [--no-install] [--english-image-cards]');process.exit(2);}
 await mkdir(join(out,'.bin'),{recursive:true});
 const ocrBinary=join(out,'.bin','rssd-ocr');
 if(styles.includes('ai-image')&&!await exists(ocrBinary))await new Promise((done,fail)=>execFile('swiftc',['-O',join(HERE,'rssd-ocr.swift'),'-o',ocrBinary],error=>error?fail(error):done()));
 const provider=createCodexImageProvider({stateDirectory:join(out,'.provider-state'),enabled:true,timeoutMs:900000});
 const limiter=makeLimiter({log:console.log});
 console.log(`[${new Date().toISOString().slice(11,19)}] ${notes.length} notes, ${concurrency} at a time`);
 const {results,stopped}=await batch(notes,{out,styles,codeSections,englishImageCards,force,concurrency,provider,ocrBinary,limiter,install:!noInstall,log:console.log});
 const count=key=>results.filter(key).length;
 console.log(JSON.stringify({notes:notes.length,installed:count(r=>r.installed),skipped:count(r=>r.skipped),
  failed:results.filter(r=>r.error||r.installError||styles.some(s=>r[s]?.error)).map(r=>({title:r.title||basename(r.file||''),error:r.error||r.installError||styles.map(s=>r[s]?.error).filter(Boolean).join(' | ')})),
  flagged:results.filter(r=>r['ai-image']?.flags?.length).map(r=>({title:r.title,flags:r['ai-image'].flags})),stopped},null,1));
}
