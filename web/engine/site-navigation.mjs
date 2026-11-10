import {profiles} from '../../scripts/site-config.mjs';
import {validateNavigation,navigationMatches} from '../../contracts/site-navigation.mjs';
import {escapeHtml as esc} from '../modules/shared.mjs';

export function navigationForSite(site){
 const configured=site.navigation??profiles.find(p=>p.id===site.id)?.navigation??[
  {id:'home',label:'首页',href:'/',view:'home'},
  {id:'feed',label:'文章',href:'/archive/',view:'feed',match:['/archive/','/news/','/journal/']},
 ];
 return validateNavigation(configured).filter(item=>(!item.module||site.display?.modules?.[item.module]?.enabled===true)&&(!item.service||site.services?.[item.service]?.enabled===true));
}
export function feedLabel(site){return navigationForSite(site).find(item=>item.view==='feed')?.label||'文章';}
export const RSSD_SOURCE='https://github.com/scholay-rssd/rssd';
const GITHUB_MARK='<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.7 7.7 0 0 1 8 3.87c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
export function githubNavLink(){
 return `<a class="github-mark" href="${RSSD_SOURCE}" target="_blank" rel="noopener noreferrer" aria-label="RSSD 源代码" title="RSSD 源代码">${GITHUB_MARK}</a>`;
}
export function renderNavigation(site,path='/'){
 return navigationForSite(site).map(item=>`<a href="${esc(item.href)}" data-nav="${esc(item.id)}"${navigationMatches(item,path)?' class="active" aria-current="page"':''}>${esc(item.label)}</a>`).join('');
}
// The authored Theme keeps its surrounding layout; only this explicit slot is filled.
export function fillNavigationSlot(html,site,path='/'){
 return html.replace(/<!-- site-navigation:start -->[\s\S]*?<!-- site-navigation:end -->/,`<!-- site-navigation:start -->${renderNavigation(site,path)}<!-- site-navigation:end -->`);
}
