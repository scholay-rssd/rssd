import {readFile,writeFile,mkdir} from 'node:fs/promises';
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
import {sectionsForSite} from '../../../contracts/site-sections.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=route=>createHash('sha256').update(route).digest('hex').slice(0,24);
const base='/assets/rssd-export/v1/';
export async function attachBrowserExports({target,site,manifest,snapshot}){
 const write=async(path,bytes)=>{await mkdir(dirname(join(target,path)),{recursive:true});await writeFile(join(target,path),bytes);manifest.hashes[path]=digest(bytes);if(Object.hasOwn(manifest.byteHashes||{},path))manifest.byteHashes[path]=byteHash(bytes);};
 const content=JSON.parse(await readFile(join(target,'published-content.json'),'utf8'));
 let english=[];try{english=JSON.parse(await readFile(join(target,'en/published-content.json'),'utf8')).records;}catch(error){if(error.code!=='ENOENT')throw error;}
 const sections=sectionsForSite(site),templates=new Set();let count=0;
 for(const record of [...content.records,...english]){
  const route=record.route;if(!route?.startsWith('/')||!Object.hasOwn(manifest.hashes,route.slice(1)+'index.html'))continue;
  const original=(snapshot.news||[]).find(x=>x.id===record.id||'news:'+x.id===record.id);
  const rawSection=record.sectionId||original?.sectionId||record.collectionId||'articles';
  const sectionId=/^(articles|extra-\d+)$/.test(rawSection)?'archive':({'column-1':'archive','column-2':'archive','column-3':'open-source','column-4':'calendar','column-5':'history'})[rawSection]||rawSection;
  const sectionName=sections.find(s=>s.id===sectionId)?.name||content.collections?.find(c=>c.id===sectionId)?.name||original?.category||site.name;
  const locale=record.locale||'zh-CN',en=locale==='en';
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
  const html=course+facts+rendered.body+sourcePanel+endnotes;
  const model={version:1,site:{id:site.id,name:site.name,origin:site.origin},sectionName,title:record.title,locale,url:site.origin+route,
   date:record.publication?.date||record.date||'',author:record.publication?.author||site.author||'',html,templates:selected};
  const path='export/'+key(route)+'/';await write(path+'content.json',JSON.stringify(model));
  // Keep existing export bookmarks usable, but reading and sharing live on the
  // canonical article. No separate public preview or eager pagination.
  await write(path+'index.html',`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0;url=${esc(route)}#share"><title>${esc(record.title)}</title></head><body><a href="${esc(route)}#share">${en?'Read article':'阅读文章'}</a></body></html>`);
  await write(path+'article.css',articleStyles(selected.wechat,'body article.rssd-article.rssd-article',{live:true}));
  const priorBack=article.match(/<nav class="rssd-reading-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0].match(/<a class="back"[^>]*>[\s\S]*?<\/a>/)?.[0];
  article=article.replace(/<nav class="rssd-reading-nav"[^>]*>[\s\S]*?<\/nav>/g,'').replace(/<aside class="rssd-share"[\s\S]*?<\/aside>/g,'').replace(/<link rel="stylesheet" href="\/(?:export\/[^"]+\/article.css|assets\/rssd-export\/v1\/share.css)">/g,'').replace(/<script type="module" src="\/assets\/rssd-export\/v1\/share.mjs"><\/script>/g,'');
  article=article.replace(/<aside class="rssd-export-link">[\s\S]*?<\/aside>/g,'');
  if(!/<article\b/.test(article))throw Error('Article layout missing: '+route);
  article=article.replace(/<article\b[^>]*>[\s\S]*?<\/article>/,old=>{
   // Preserve useful related-project links and calendar navigation, not the
   // previous theme's duplicated fact boxes, title seals and floating TOC.
   const extras=[...old.matchAll(/<aside class="sources">[\s\S]*?<\/aside>|<p class="interaction-link">[\s\S]*?<\/p>/g)].map(x=>x[0]).filter(x=>/关联|interaction-link/.test(x)).join('');
   const oldBack=priorBack||old.match(/<a class="back"[^>]*>[\s\S]*?<\/a>/)?.[0];
   const stale=old.match(/<p class="muted">This English edition[\s\S]*?<\/p>/)?.[0]||'';
   const sourceRoute=old.match(/data-community-source-route="([^"]*)"/)?.[1];
   return `<nav class="rssd-reading-nav" aria-label="${en?'Article navigation':'文章导航'}">${oldBack||`<a class="back" href="${en?'/en/':'/archive/'}">← ${en?'All articles':'全部文章'}</a>`}</nav><article class="rssd-article" data-article-template="${esc(selected.wechat.id)}"${sourceRoute?` data-community-source-route="${sourceRoute}"`:''}>${articleHeading(model)}${course}${stale}${facts}<div class="article-body">${rendered.body}</div>${sourcePanel}${endnotes}${extras}</article>`;
  }).replace(/<aside class="reading-aside">[\s\S]*?<\/aside>/g,'').replace('</head>',`<link rel="stylesheet" href="/${path}article.css"><link rel="stylesheet" href="${base}share.css"></head>`)
    .replace('</body>',shareShell(model,'/'+path+'content.json')+`<script type="module" src="${base}share.mjs"></script></body>`);
  await write(articlePath,article);count++;
 }
 if(count)for(const file of ['share.mjs','share.css','article-style.mjs','portable.mjs','pagination.mjs','raster.mjs','zip.mjs','styles.mjs'])await write(base.slice(1)+file,await readFile(new URL(file,import.meta.url)));
 manifest.browserExports={version:2,articles:count,templates:[...templates].sort()};
 await writeFile(join(target,'release.json'),JSON.stringify(manifest));return manifest;
}
