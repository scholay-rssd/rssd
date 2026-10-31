import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from '../../admin/model.mjs';
import {byteHash} from './theme-homepage.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stylesheet='<link rel="stylesheet" href="/site-language.css">';
const client='<script defer src="/site-language.js"></script>';

export function languageControl({route,englishHome=false,pairs=new Map()}){
 const english=route.startsWith('/en/'),pair=pairs.get(route),home=['/','/en/'].includes(route),article=/^\/(?:news|calendar|history|open-source)\/[^/]+/.test(route);
 const zh=english?(pair||'/'):route,en=english?route:pair||(englishHome?'/en/':null);
 const item=(lang,label,href,current,title)=>href?`<a href="${esc(href)}" lang="${lang==='en'?'en':'zh-CN'}" data-language-switch="${lang}"${current?' aria-current="page"':''} title="${esc(title)}">${label}</a>`:`<span class="language-unavailable" aria-disabled="true" title="本站暂无英文内容">EN <small>暂无</small></span>`;
 return `<div class="site-language-control" role="group" aria-label="${english?'Language':'语言 / Language'}" data-language-target="${pair||home?'page':englishHome?'directory':'unavailable'}">${item('zh-CN','中文',zh,!english,'阅读中文'+(english&&!pair&&!home?'首页':'版'))}${item('en',pair||home?'EN':'EN <small>目录</small>',en,english,pair||home?'Read in English':article?'本文暂无英文版，浏览英文内容':'浏览英文目录')}</div>`;
}

export function addLanguageNavigation(html,{site,route,englishHome=false,pairs=new Map()}){
 if(!/<head\b/i.test(html)||!/<header\b/i.test(html)||/^\/(?:manage|admin|404|500)(?:\/|$)/.test(route))return html;
 // The personal homepage has five real locales. Keep its native route-aware
 // picker, and apply the same sizing, focus and contrast rules to it.
 const native=/\bclass=["'][^"']*\blanguage-picker\b/.test(html);
 html=html.replace(/<nav\b[^>]*class=["'][^"']*\blanguage-switch\b[^"']*["'][^>]*>[\s\S]*?<\/nav>/g,'')
  .replace(/<div\b[^>]*class=["']site-language-control["'][^>]*>[\s\S]*?<\/div>/g,'');
 if(!html.includes('href="/site-language.css"'))html=html.replace('</head>',stylesheet+'</head>');
 if(native)return html;
 const control=languageControl({route,englishHome,pairs});
 html=html.replace(/<header\b[^>]*>[\s\S]*?<\/header>/,header=>{
  if(/\bapp-bar-inner\b/.test(header)){
   const button=header.search(/<button\b[^>]*\bid=["']theme-toggle["']/);
   const at=button<0?header.lastIndexOf('</div>'):button;
   if(at>=0)return header.slice(0,at)+control+header.slice(at);
  }
  return header.replace('</header>',control+'</header>');
 });
 if(englishHome&&!html.includes('src="/site-language.js"'))html=html.replace('</body>',client+'</body>');
 return html;
}

async function htmlFiles(root,prefix=''){
 const files=[];
 for(const e of await readdir(join(root,prefix),{withFileTypes:true})){
  if(e.name.startsWith('.'))continue;
  const path=prefix+e.name;
  if(e.isDirectory())files.push(...await htmlFiles(root,path+'/'));
  else if(e.isFile()&&path.endsWith('.html'))files.push(path);
 }
 return files;
}

export async function finalizeLanguageNavigation({target,site,manifest}){
 const files=await htmlFiles(target),englishHome=files.includes('en/index.html'),pairs=new Map();
 try{
  const editions=JSON.parse(await readFile(join(target,'language-editions.json'),'utf8'));
  for(const edition of editions.editions){
   if(!edition.sourceUrl)continue;
   const source=new URL(edition.sourceUrl);
   if(source.origin!==new URL(site.origin).origin||!files.includes(edition.route.slice(1)+'index.html'))throw Error('Invalid language navigation target');
   pairs.set(source.pathname,edition.route);pairs.set(edition.route,source.pathname);
  }
 }catch(error){if(error.code!=='ENOENT')throw error;}
 for(const file of files){
  // Custom homepage HTML is decorated by its own builder and must retain the
  // exact bytes validated by copyThemeHomepage's artifact manifest.
  if(manifest.homepage&&Object.hasOwn(manifest.byteHashes||{},file))continue;
  const before=await readFile(join(target,file),'utf8'),route='/'+file.replace(/index\.html$/,'');
  const after=addLanguageNavigation(before,{site,route,englishHome,pairs});
  if(after===before)continue;
  await writeFile(join(target,file),after);manifest.hashes[file]=digest(after);
  if(Object.hasOwn(manifest.byteHashes||{},file))manifest.byteHashes[file]=byteHash(after);
 }
 // Chrome changes are separate from article revisions and content timestamps.
 // The release hashes above still verify every byte served to readers.
 for(const [file,path] of [['site-language.css','./site-language.css'],...(englishHome?[['site-language.js','./site-language.js']]:[])]){
  const bytes=await readFile(new URL(path,import.meta.url));await writeFile(join(target,file),bytes);manifest.hashes[file]=digest(bytes);
  if(Object.hasOwn(manifest.byteHashes||{},file))manifest.byteHashes[file]=byteHash(bytes);
 }
 await writeFile(join(target,'release.json'),JSON.stringify(manifest));
 return manifest;
}
