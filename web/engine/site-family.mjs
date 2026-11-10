import {join} from 'node:path';
import {profiles} from '../../scripts/site-config.mjs';
import branding from '../../sites/branding/manifest.json' with {type:'json'};
import {escapeHtml as esc} from '../modules/shared.mjs';

export function familyIconEntries(source){
 return profiles.map(site=>{
  const png=branding[site.id]?.icons?.png32;
  const file=png?join(source,'sites/branding',png):site.id==='scholay-today'?join(source,'web/themes/academic/public/scholay-logo.png'):'';
  if(!file)throw Error('Missing family icon for '+site.id);
  return {id:site.id,file};
 });
}
export function familyFooter(siteId){
 const links=profiles.filter(site=>site.id!==siteId).map(site=>`<a href="${esc(site.origin)}/" target="_blank" rel="noopener noreferrer" aria-label="${esc(site.name)}" title="${esc(site.name)}"><img src="/family/${esc(site.id)}.png" alt="" width="22" height="22"></a>`).join('');
 return `<nav class="site-family" aria-label="其他站点">${links}</nav>`;
}
