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
export function renderNavigation(site,path='/'){
 return navigationForSite(site).map(item=>`<a href="${esc(item.href)}" data-nav="${esc(item.id)}"${navigationMatches(item,path)?' class="active" aria-current="page"':''}>${esc(item.label)}</a>`).join('');
}
// The authored Theme keeps its surrounding layout; only this explicit slot is filled.
export function fillNavigationSlot(html,site,path='/'){
 return html.replace(/<!-- site-navigation:start -->[\s\S]*?<!-- site-navigation:end -->/,`<!-- site-navigation:start -->${renderNavigation(site,path)}<!-- site-navigation:end -->`);
}
