import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {profiles} from '../../scripts/site-config.mjs';
import branding from '../../sites/branding/manifest.json' with {type:'json'};
import {escapeHtml as esc} from '../modules/shared.mjs';
import {loadLanguagePack,localeNames} from './language-pack.mjs';

export function familyIconEntries(source){
 return profiles.flatMap(site=>{
  const png=branding[site.id]?.icons?.png32;
  const file=png?join(source,'sites/branding',png):site.id==='scholay-today'?join(source,'web/themes/academic/public/scholay-logo.png'):'';
  return file&&existsSync(file)?[{id:site.id,file}]:[];
 });
}
export async function familyLocaleNames(source,locale){
 const names=await Promise.all(profiles.map(async site=>{
  // Another site's optional pack must not prevent this site's publication.
  try{return [site.id,localeNames(await loadLanguagePack(source,site.id),locale)?.name];}
  catch{return [site.id,undefined];}
 }));
 return Object.fromEntries(names.filter(([,name])=>name));
}
export function familyFooter(siteId,{locale='zh-CN',names={}}={}){
 const links=profiles.filter(site=>site.id!==siteId).map(site=>{const name=names[site.id]||site.name;return `<a href="${esc(site.origin)}/" target="_blank" rel="noopener noreferrer" aria-label="${esc(name)}" title="${esc(name)}"><img src="/family/${esc(site.id)}.png" alt="" width="22" height="22"></a>`;}).join('');
 return `<nav class="site-family" aria-label="${locale==='en'?'Other sites':'其他站点'}">${links}</nav>`;
}
