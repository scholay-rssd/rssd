import type {ArticleSummary} from '../types';
import type {NewsItem} from './taskWorkbench';
import type {TopicTemplate} from './topicTemplates';
import type {CalendarEvent} from '../calendar/types';
import { tr } from "../uiText";
export type {TopicTemplate} from './topicTemplates';
export type TopicSource={kind:'article';article:ArticleSummary}|{kind:'template';template:TopicTemplate}|{kind:'record';event:CalendarEvent};
export const TEMPLATE_SETTING='editorial.topic-templates.v1';
export const sourceKey=(s:TopicSource)=>s.kind==='article'?'article:'+s.article.id:s.kind==='record'?'record:'+s.event.id:'template:'+s.template.id;
export const urlKey=(url:string)=>{try{const u=new URL(url);return u.origin+u.pathname.replace(/\/$/,'');}catch{return url;}};
export function sourceUsable(s:TopicSource,usedUrls:string[]){
 if(s.kind==='template')return true;
 if(s.kind==='record'&&(!s.event.id||s.event.id.length>200))return false;
 const urls=s.kind==='record'?[...(s.event.payload.sources||[]).map(link=>link.url),s.event.payload.sourceUrl||''].filter(url=>/^https?:\/\//i.test(url)):[s.article.url||''];
 return urls.some(url=>/^https?:\/\//i.test(url))&&!urls.some(url=>usedUrls.some(used=>urlKey(used)===urlKey(url)));
}
export function articleMaterial(a:ArticleSummary,id:string):NewsItem{
 const published=a.publishedAt?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]||'',fetched=published?'':a.fetchedAt?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]||'',date=published||fetched;
 const body=a.snippet?.trim()||'RSS 未提供摘要，写作前需核对原文。';
 return {id,title:a.title,summary:a.author?.trim()?'作者：'+a.author.trim()+'\n'+body:body,url:a.url!,publisher:a.feedTitle,date,dateBasis:published?'RSS 标注的发布日期，写作前核对原文':fetched?'RSS 未标注发布日期，此为订阅抓取日期，写作前核对原文':'RSS 未提供发布日期',acquiredVia:'rss',rssId:String(a.id),selected:true,locked:true,excluded:false};
}

export const articleDateLabel=(a:ArticleSummary)=>a.publishedAt?.slice(0,10)||(a.fetchedAt?tr('{{date}} 抓取',{date:a.fetchedAt.slice(0,10)}):tr('日期未提供'));
/** Plain text of an article body, capped so a placed item stays a usable prompt. */
export function articleFullText(html:string|null|undefined,max=1500){
 if(!html)return '';const doc=new DOMParser().parseFromString(html.replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>|<br\s*\/?>/gi,m=>m+' '),'text/html');doc.querySelectorAll('script,style').forEach(n=>n.remove());
 return (doc.body.textContent||'').replace(/\s+/g,' ').trim().slice(0,max);
}
