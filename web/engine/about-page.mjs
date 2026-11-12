// A site's 关于 page, from sites/about/<siteId>.json:
//   {"version":1,"siteId":"…","title":"关于…","paragraphs":["…","…"]}
// Paragraphs are plain text; **text** marks a section name in bold.
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {escapeHtml as esc} from '../modules/shared.mjs';

export const ABOUT_ROUTE='/about/';
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;

export function validateAbout(value,siteId){
  if(value?.version!==1||value.siteId!==siteId||!text(value.title,80)||!Array.isArray(value.paragraphs)||!value.paragraphs.length||value.paragraphs.length>8||value.paragraphs.some(p=>!text(p,1200)))throw Error('Invalid about page');
  return {version:1,siteId,title:value.title.trim(),paragraphs:value.paragraphs.map(p=>p.trim())};
}
export async function loadAbout(source,siteId){
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(siteId||''))throw Error('Invalid about site ID');
  const file=join(source,'sites/about',siteId+'.json');
  try{
    if((await lstat(file)).isSymbolicLink())throw Error('About page symlink rejected');
    return validateAbout(JSON.parse(await readFile(file,'utf8')),siteId);
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
const inline=value=>esc(value).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
export function renderAbout(about){
  return `<article class="about-page"><section class="hero compact"><p class="eyebrow">ABOUT</p><h1>${esc(about.title)}</h1></section><div class="about-body">${about.paragraphs.map(p=>`<p>${inline(p)}</p>`).join('')}</div></article>`;
}
