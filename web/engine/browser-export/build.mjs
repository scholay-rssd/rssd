import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {digest} from '../../../admin/model.mjs';
import {byteHash} from '../theme-homepage.mjs';
import {renderArticleParts} from '../article-math.mjs';
import {exportTemplate} from '../../themes/export/registry.mjs';
import {headingAnchors} from '../../themes/structures.mjs';
import {courseLabels} from '../../themes/academic/archive-pages.mjs';
import {articleStyles,articleHeading} from './article-style.mjs';
import {shareShell} from './share-shell.mjs';
import {TAG_SITES,articleTags} from './tags.mjs';
import {notePictures,noteRatio,noteSlides,cardSlides,galleryHtml,cardsLink,workLinks} from './note-layout.mjs';
import {sectionsForSite} from '../../../contracts/site-sections.mjs';
import {sectionWorkPolicy,articleCardState,workPages,cardsRoute,adaptationIndex} from '../../../contracts/work-types.mjs';
import {localeNames,localeSection,localeAuthor} from '../language-pack.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=route=>createHash('sha256').update(route).digest('hex').slice(0,24);
const base='/assets/rssd-export/v1/';
export async function attachBrowserExports({target,site,manifest,snapshot,languagePack=null}){
 const write=async(path,bytes)=>{await mkdir(dirname(join(target,path)),{recursive:true});await writeFile(join(target,path),bytes);manifest.hashes[path]=digest(bytes);if(Object.hasOwn(manifest.byteHashes||{},path))manifest.byteHashes[path]=byteHash(bytes);};
 const content=JSON.parse(await readFile(join(target,'published-content.json'),'utf8'));
 let english=[];try{english=JSON.parse(await readFile(join(target,'en/published-content.json'),'utf8')).records;}catch(error){if(error.code!=='ENOENT')throw error;}
 const sections=sectionsForSite(site),templates=new Set();let count=0,notePages=0,cardPages=0,workLinkPages=0;
 // Long articles and notes on this site, for the links between a note and the article it was rewritten from.
 const workId=record=>String(record.id).replace(/^news:/,'');
 const works=content.records.filter(record=>record.type==='article'||record.type==='note'),byWorkId=new Map(works.map(record=>[workId(record),record]));
 const adaptations=adaptationIndex(works.map(record=>({articleId:workId(record),type:record.type,revision:record.revision,adaptedFrom:record.adaptedFrom})));
 // A work's page in a language: its English edition when it has one, otherwise its Chinese page.
 const englishOf=new Map(english.filter(record=>record.sourceArticleId).map(record=>[record.sourceArticleId,record]));
 const pageIn=(articleId,en)=>(en&&englishOf.get(articleId))||byWorkId.get(articleId);
 const exists=async file=>{try{await access(join(target,file));return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 for(const record of [...content.records,...english]){
  const route=record.route;if(!route?.startsWith('/')||!Object.hasOwn(manifest.hashes,route.slice(1)+'index.html'))continue;
  const original=(snapshot.news||[]).find(x=>x.id===record.id||'news:'+x.id===record.id);
  const rawSection=record.sectionId||original?.sectionId||record.collectionId||'articles';
  const sectionId=/^(articles|extra-\d+)$/.test(rawSection)?'archive':({'column-1':'archive','column-2':'archive','column-3':'open-source','column-4':'calendar','column-5':'history'})[rawSection]||rawSection;
  const sectionName=sections.find(s=>s.id===sectionId)?.name||content.collections?.find(c=>c.id===sectionId)?.name||original?.category||site.name;
  const locale=record.locale||'zh-CN',en=locale==='en',names=locale==='zh-CN'?null:localeNames(languagePack,locale);
  const selected=Object.fromEntries(['pages','wechat'].map(format=>[format,exportTemplate({siteId:site.id,workspaceId:site.spaceId,sectionId,sectionName,format})]));
  Object.values(selected).forEach(t=>templates.add(t.id));
  let markdown=record.bodyMarkdown||'';
  // Some imported records repeat their title twice. Suppress only consecutive
  // exact title headings in presentation; preserve the canonical source record.
  for(;;){const heading=markdown.match(/^# ([^\n]+)\n+/);if(!heading||heading[1].trim()!==record.title.trim())break;markdown=markdown.slice(heading[0].length);}
  const rendered=renderArticleParts(markdown,{site});
  if(site.id!=='scholay-today')rendered.body=headingAnchors(rendered.body).body;
  const sources=(record.sources||[]).filter(s=>!markdown.includes(s.url));
  const articlePath=route.slice(1)+'index.html';let article=await readFile(join(target,articlePath),'utf8');
  const preservedFacts=article.match(/<dl class="record-facts">[\s\S]*?<\/dl>/)?.[0];
  const event=record.event, facts=preservedFacts||(event?`<dl class="record-facts">${Object.entries(event).filter(([key,value])=>['year','monthDay','start','end'].includes(key)&&value!=null).map(([key,value])=>`<div><dt>${esc(({year:'年份',monthDay:'日期',start:'开始',end:'结束'})[key])}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:'');
  const sourcePanel=(sources.length?`<h2>${en?'Sources':'资料来源'}</h2><ul>${sources.map(s=>`<li><a href="${esc(s.url)}">${esc(s.label||s.url)}</a></li>`).join('')}</ul>`:'');
  const endnotes=rendered.endnotes?`<div class="article-body article-endnotes">${rendered.endnotes}</div>`:'';
  const course=record.course?`<p class="rssd-byline">${courseLabels(record.course)}</p>`:'';
  // The #tags row sits inside the article, under the body.
  // An edition in another language is the same work, so it takes its type from the source.
  const source=locale==='zh-CN'?record:content.records.find(r=>r.id==='news:'+record.sourceArticleId);
  const type=record.type||source?.type||'article';
  const collection=content.collections?.find(c=>c.id===record.collectionId);
  // Notes always show their #tags; articles where the site has opted in.
  const tags=TAG_SITES.has(site.id)||type==='note'?articleTags({sectionId:record.collectionId,sectionName:localeSection(names,sectionId,sectionName),sectionRoute:locale==='zh-CN'?collection?.route:'',tags:record.tags}):'';
  // A note's standalone pictures move into a gallery beside its text. A note without one keeps the article page.
  const split=type==='note'?notePictures(rendered.body):null,pictures=split?.pictures.length?split.pictures:null;
  const gallery=pictures?galleryHtml(noteSlides(pictures),{ratio:await noteRatio(target,pictures),en}):'';
  // A long article gets its card page while a card set for its current revision is on the site, every card of it.
  const policy=sectionWorkPolicy(sections.find(s=>s.id===(source?.sectionId||record.sectionId)));
  let cards=type==='article'?record.cards:undefined;
  if(cards){
   const cardState=articleCardState({type,policy,revision:record.revision??cards.revision,sets:[{revision:cards.revision??record.revision}]});
   const files=[...cards.pages,...(cards.cover?[cards.cover]:[])].map(picture=>picture.src.slice(1));
   if(!workPages({type,cardState}).includes('cards')||!(await Promise.all(files.map(exists))).every(Boolean))cards=undefined;
  }
  const cardsPath=cards?cardsRoute(route):null;
  // Links between the article page and the card page, and both ways between an article and its rewritten notes.
  const links=[];
  if(cardsPath)links.push(cardsLink({route:cardsPath,cards,en}));
  // The links between an article and its rewritten notes belong to the work, so an English page takes them from its
  // Chinese source and points at the English editions where they exist.
  if(type==='article'&&source)for(const note of adaptations.notesOf.get(workId(source))||[]){const page=pageIn(note.articleId,en);if(page)links.push(`<a href="${esc(page.route)}">${en?`Picture note: ${esc(page.title)}`:`图文笔记《${esc(page.title)}》`}</a>`);}
  const from=type==='note'?source?.adaptedFrom:null,rewrittenFrom=from&&byWorkId.get(from.articleId);
  if(rewrittenFrom?.type==='article'){
   const page=pageIn(from.articleId,en),outdated=Number.isSafeInteger(rewrittenFrom.revision)&&rewrittenFrom.revision>from.revision;
   links.push(`<a href="${esc(page.route)}">${en?`Rewritten from ${esc(page.title)}`:`改写自《${esc(page.title)}》`}</a>${outdated?`<span class="rssd-outdated">${en?'The article has been updated':'原文已更新'}</span>`:''}`);
  }
  const linkRow=workLinks(links),usesNote=Boolean(pictures||links.length);
  // A page in another language names the site, its section and its default author in that language.
  // The heading and the share panel's view of the page.
  const model={site:{id:site.id,name:names?.name||site.name,origin:site.origin},sectionName:localeSection(names,sectionId,sectionName),title:record.title,locale,url:site.origin+route,
   date:record.publication?.date||record.date||'',author:localeAuthor(names,record.publication?.author||site.author||'',site)};
  // Keep existing export bookmarks usable: they open the canonical article's sharing panel. Copies, downloads
  // and page images for distribution come from the desktop app and the Obsidian plug-in, not from the site.
  const path='export/'+key(route)+'/';
  await write(path+'index.html',`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0;url=${esc(route)}#share"><title>${esc(record.title)}</title></head><body><a href="${esc(route)}#share">${en?'Read article':'阅读文章'}</a></body></html>`);
  await write(path+'article.css',articleStyles(selected.wechat,'body article.rssd-article.rssd-article',{live:true}));
  const priorBack=article.match(/<nav class="rssd-reading-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0].match(/<a class="back"[^>]*>[\s\S]*?<\/a>/)?.[0];
  article=article.replace(/<nav class="rssd-reading-nav"[^>]*>[\s\S]*?<\/nav>/g,'').replace(/<aside class="rssd-share"[\s\S]*?<\/aside>/g,'').replace(/<link rel="stylesheet" href="\/(?:export\/[^"]+\/article.css|assets\/rssd-export\/v1\/(?:share|note).css)">/g,'').replace(/<script type="module" src="\/assets\/rssd-export\/v1\/(?:share|note).mjs"><\/script>/g,'');
  article=article.replace(/<aside class="rssd-export-link">[\s\S]*?<\/aside>/g,'');
  if(!/<article\b/.test(article))throw Error('Article layout missing: '+route);
  article=article.replace(/<article\b[^>]*>[\s\S]*?<\/article>/,old=>{
   // Preserve useful related-project links and calendar navigation, not the
   // previous theme's duplicated fact boxes, title seals and floating TOC.
   const extras=[...old.matchAll(/<aside class="sources">[\s\S]*?<\/aside>|<p class="interaction-link">[\s\S]*?<\/p>/g)].map(x=>x[0]).filter(x=>/关联|interaction-link/.test(x)).join('');
   const oldBack=priorBack||old.match(/<a class="back"[^>]*>[\s\S]*?<\/a>/)?.[0];
   const stale=old.match(/<p class="muted">This English edition[\s\S]*?<\/p>/)?.[0]||'';
   const sourceRoute=old.match(/data-community-source-route="([^"]*)"/)?.[1],versionState=old.match(/data-source-version-state="([a-z_]+)"/)?.[1];
   const attributes=` data-article-template="${esc(selected.wechat.id)}"${sourceRoute?` data-community-source-route="${sourceRoute}"`:''}${versionState?` data-source-version-state="${versionState}"`:''}`;
   // The links row sits under the heading; an article repeats it after its text, where a reader finishes.
   const text=`${articleHeading(model)}${linkRow}${course}${stale}${facts}<div class="article-body">${pictures?split.body:rendered.body}</div>${tags}${type==='article'?linkRow:''}${sourcePanel}${endnotes}${extras}`;
   const nav=`<nav class="rssd-reading-nav" aria-label="${en?'Article navigation':'文章导航'}">${oldBack||`<a class="back" href="${en?'/en/':'/archive/'}">← ${en?'All articles':'全部文章'}</a>`}</nav>`;
   return nav+(pictures?`<article class="rssd-article rssd-note-article"${attributes}>${gallery}<div class="rssd-note-text">${text}</div></article>`:`<article class="rssd-article"${attributes}>${text}</article>`);
  }).replace(/<aside class="reading-aside">[\s\S]*?<\/aside>/g,'').replace('</head>',`<link rel="stylesheet" href="/${path}article.css"><link rel="stylesheet" href="${base}share.css">${usesNote?`<link rel="stylesheet" href="${base}note.css">`:''}</head>`)
    .replace('</body>',shareShell(model)+`<script type="module" src="${base}share.mjs"></script>${pictures?.length>1?`<script type="module" src="${base}note.mjs"></script>`:''}</body>`);
  await write(articlePath,article);count++;
  if(pictures)notePages++;else if(links.length)workLinkPages++;
  if(cardsPath){
   // The card page is the article page with the card set in place of the text: same site header, footer and
   // canonical address (the article's), no share panel, and a way back to the text at the top and the end.
   const total=cards.pages.length,first=cards.pages[0],ratio=first.width?first.width/first.height:3/4;
   const heading=`<header class="rssd-article-heading"><p class="rssd-kicker">${esc([model.site.name,model.sectionName].filter(Boolean).join(' / '))}</p><h1>${esc(record.title)}</h1><p class="rssd-byline">${en?`Cards · ${total}`:`卡片版 · ${total} 张`}</p></header>`;
   const back=`<nav class="rssd-reading-nav" aria-label="${en?'Article navigation':'文章导航'}"><a class="back" href="${esc(route)}">← ${en?'Read the article':'阅读全文'}</a></nav>`;
   const body=`${back}<article class="rssd-article rssd-cards-article" data-article-template="${esc(selected.wechat.id)}">${heading}${galleryHtml(cardSlides(cards,{en}),{ratio,en,label:en?'Cards':'卡片'})}${workLinks([`<a href="${esc(route)}">${en?'Read the article →':'阅读全文 →'}</a>`])}</article>`;
   const page=article.replace(/<nav class="rssd-reading-nav"[^>]*>[\s\S]*?<\/nav>/g,'').replace(/<article\b[^>]*>[\s\S]*?<\/article>/,()=>body)
    .replace(/<aside class="rssd-share"[\s\S]*?<\/aside>/g,'').replace(/<script type="module" src="\/assets\/rssd-export\/v1\/(?:share|note).mjs"><\/script>/g,'')
    .replace(/<title>([\s\S]*?)<\/title>/,(_,title)=>`<title>${en?'Cards · ':'卡片版 · '}${title}</title>`)
    .replace('</body>',()=>(total>1?`<script type="module" src="${base}note.mjs"></script>`:'')+'</body>');
   await write(cardsPath.slice(1)+'index.html',page);cardPages++;
  }
 }
 const noteFiles=notePages||cardPages||workLinkPages?['note.mjs','note.css']:[];
 if(count)for(const file of [...noteFiles,'share.mjs','share.css'])await write(base.slice(1)+file,await readFile(new URL(file,import.meta.url)));
 manifest.browserExports={version:2,articles:count,templates:[...templates].sort(),...(notePages?{notes:notePages}:{}),...(cardPages?{cardPages}:{})};
 await writeFile(join(target,'release.json'),JSON.stringify(manifest));return manifest;
}
