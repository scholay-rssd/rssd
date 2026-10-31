import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {digest} from '../../../admin/model.mjs';
import {byteHash} from '../theme-homepage.mjs';
import {renderArticleParts} from '../article-math.mjs';
import {exportTemplate} from '../../themes/export/registry.mjs';
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
  const sectionId=record.sectionId||original?.sectionId||record.collectionId||'articles';
  const sectionName=sections.find(s=>s.id===sectionId)?.name||content.collections?.find(c=>c.id===sectionId)?.name||original?.category||site.name;
  const locale=record.locale||'zh-CN',en=locale==='en';
  const selected=Object.fromEntries(['pages','wechat'].map(format=>[format,exportTemplate({siteId:site.id,workspaceId:site.spaceId,sectionId,sectionName,format})]));
  Object.values(selected).forEach(t=>templates.add(t.id));
  let markdown=record.bodyMarkdown||'';const heading=markdown.match(/^# ([^\n]+)\n+/);if(heading?.[1].trim()===record.title.trim())markdown=markdown.slice(heading[0].length);
  const rendered=renderArticleParts(markdown,{site});
  const sources=(record.sources||[]).filter(s=>!markdown.includes(s.url));
  const html=rendered.body+rendered.endnotes+(sources.length?`<h2>${en?'Sources':'资料来源'}</h2><ul>${sources.map(s=>`<li><a href="${esc(s.url)}">${esc(s.label||s.url)}</a></li>`).join('')}</ul>`:'');
  const model={version:1,site:{id:site.id,name:site.name,origin:site.origin},sectionName,title:record.title,locale,url:site.origin+route,
   date:record.publication?.date||record.date||'',author:record.publication?.author||site.author||'',html,templates:selected};
  const path='export/'+key(route)+'/';await write(path+'content.json',JSON.stringify(model));
  const shell=`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${esc(record.title)} · ${en?'Export':'获取成品'}</title><link rel="stylesheet" href="${base}ui.css"></head><body data-rssd-export><header class="export-top"><a href="${esc(route)}">← ${esc(site.name)}</a><span>${esc(sectionName)}</span></header><main class="export-workspace"><aside class="export-controls"><p class="export-eyebrow">${en?'TAKE THE ARTICLE WITH YOU':'把文章带走'}</p><h1>${esc(record.title)}</h1><div class="export-modes" role="group" aria-label="${en?'Format':'成品形式'}"><button data-mode="pages" aria-pressed="true">${en?'Page images':'分页图文'}</button><button data-mode="wechat" aria-pressed="false">${en?'WeChat layout':'公众号排版'}</button></div><p class="export-description" id="description">${en?'The complete article, in numbered pages.':'完整正文与配图，按页编号。'}</p><button class="export-primary" id="download" disabled>${en?'Preparing…':'正在准备…'}</button><button id="cancel" class="export-quiet" hidden>${en?'Cancel':'取消'}</button><p id="status" role="status" aria-live="polite"></p><nav class="export-pagination" aria-label="${en?'Pages':'页码'}"><button id="previous" disabled aria-label="${en?'Previous page':'上一页'}">←</button><span id="page-number">—</span><button id="next" disabled aria-label="${en?'Next page':'下一页'}">→</button></nav><a class="export-original" href="${esc(route)}">${en?'Return to article':'返回文章'}</a></aside><section class="export-proof" aria-label="${en?'Preview':'成品预览'}"><div id="proof"></div></section></main><script type="module" src="${base}app.mjs"></script></body></html>`;
  await write(path+'index.html',shell);
  const articlePath=route.slice(1)+'index.html';let article=await readFile(join(target,articlePath),'utf8');
  article=article.replace('</main>',`<aside class="rssd-export-link"><a href="/${path}">${en?'Get page images / WeChat layout':'获取分页图文 / 公众号排版'} <span aria-hidden="true">↗</span></a></aside></main>`).replace('</head>',`<style>.rssd-export-link{margin:2rem auto;padding:1.2rem 0;border-top:1px solid #8885;max-width:70ch;font-size:15px}.rssd-export-link a{color:inherit;text-decoration:none}.rssd-export-link span{float:right}</style></head>`);
  await write(articlePath,article);count++;
 }
 if(count)for(const file of ['app.mjs','pagination.mjs','raster.mjs','zip.mjs','styles.mjs','ui.css'])await write(base.slice(1)+file,await readFile(new URL(file,import.meta.url)));
 manifest.browserExports={version:1,articles:count,templates:[...templates].sort()};
 await writeFile(join(target,'release.json'),JSON.stringify(manifest));return manifest;
}
