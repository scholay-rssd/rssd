import {validateSectionId} from '../contracts/site-sections.mjs';
import {SITE} from '../scripts/site-config.mjs';
import {createHash, randomUUID} from 'node:crypto';
import {validateNews} from './news.mjs';
import {recordMarkdown} from '../scripts/editorial-record.mjs';
import {editionRoute} from '../contracts/language-editions.mjs';

export const kinds = {year:SITE.columns[3],history:SITE.columns[4],openSource:SITE.columns[2],news:'档案文章'};
export const yearCategories=SITE.yearCategories;
export const sourceCategories=SITE.sourceCategories;
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export function fail(message,statusCode=400) { const error=new Error(message);error.statusCode=statusCode;throw error; }
export function plain(value,max=16000) {
  if(typeof value!=='string'||value.length>max) fail('文本格式错误或超过长度限制');
  return value.trim();
}
export function url(value,required=false) {
  if(!value&&!required)return '';
  try { const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2000)throw 0;return u.href; }
  catch { fail('来源必须是有效的 HTTP / HTTPS 链接'); }
}
export function day(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('日期格式应为 YYYY-MM-DD');
  const d=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)fail('日期不存在');
  return value;
}
export function annualRule(rule,start){if(!rule||rule.frequency!=='yearly'||rule.monthDay!==start.slice(5)||!['skip','feb28'].includes(rule.leapDay||'skip'))fail('年度惯例须提供与开始日期一致的月日和有效闰日规则');return {frequency:'yearly',monthDay:rule.monthDay,leapDay:rule.leapDay||'skip'};}
export function validate(kind,input,previous=null,site=SITE) {
  if(!Object.hasOwn(kinds,kind)||!input||Array.isArray(input)||typeof input!=='object')fail('内容类型错误');
  const required=(key,max=16000)=>{const v=plain(input[key]??'',max);if(!v)fail('请填写 '+key);return v;};
  const optional=(key,max=16000)=>plain(input[key]??'',max);
  if(kind==='news')return validateNews(input,previous,site);
  const title=required('title',500);
  const sectionId=validateSectionId(input.sectionId,site);
  const withMedia=data=>{
    if(sectionId)data={...data,sectionId};
    if(input.assets===undefined)return data;
    const article=validateNews({id:'structured-record',title,summary:(data.summary||data.factSummary||title).slice(0,4000),date:'2000-01-01',markdown:recordMarkdown(kind,data),assets:input.assets});
    return article.assets.length?{...data,assets:article.assets}:data;
  };
  if(kind==='year') {
    const start=day(input.start),end=input.end?day(input.end):null;
    if(end&&end<start)fail('结束日期不能早于开始日期');
    if(!site.yearCategories.includes(input.category))fail('请选择有效的栏目分类');
    const provenance=optional('provenance',40)||'原文资料';
    if(!['原文资料','已核验官网','已核验','来源待核验','待核验'].includes(provenance))fail('核验状态无效');
    if(!Array.isArray(input.tags)||input.tags.length>30)fail('标签格式错误');
    return withMedia({id:previous?.id||'year:editor:'+randomUUID(),title,category:input.category,tags:[...new Set(input.tags.map(x=>plain(x,80)).filter(Boolean))],start,end,...(input.recurrence?{recurrence:annualRule(input.recurrence,start)}:{}),dateBasis:required('dateBasis',500),summary:required('summary',4000),body:optional('body',32000),bodyTruncated:Boolean(input.bodyTruncated),sourceName:required('sourceName',300),sourceUrl:url(input.sourceUrl,true),provenance,reviewedAt:['已核验官网','已核验'].includes(provenance)?(input.reviewedAt||new Date().toISOString()):null});
  }
  if(kind==='history') {
    if(!/^\d{2}-\d{2}$/.test(input.dateKey||''))fail('历史日期格式应为 MM-DD');
    day('2000-'+input.dateKey);
    if(!Number.isInteger(input.year)||input.year<1||input.year>9999)fail('发生年份无效');
    if(!['S','A','B'].includes(input.importance))fail('重要性应为 S、A 或 B');
    if(!Array.isArray(input.sources)||!input.sources.length||input.sources.length>20)fail('至少填写一个来源，最多 20 个');
    if(input.sources.some(s=>!s||typeof s!=='object'||Array.isArray(s)))fail('来源格式错误');
    return withMedia({id:previous?.id||'history:editor:'+randomUUID(),title,dateKey:input.dateKey,year:input.year,domain:required('domain',100),eventType:required('eventType',100),importance:input.importance,factSummary:required('factSummary',8000),historicalSignificance:required('historicalSignificance',16000),sources:input.sources.map(s=>({label:plain(s.label||'原始来源',300),url:url(s.url,true)})),preciseToDay:Boolean(input.preciseToDay)});
  }
  if(!site.sourceCategories.includes(input.category))fail('请选择有效的开源分类');
  return withMedia({title,date:day(input.date),category:input.category,summary:required('summary',8000),value:required('value',8000),url:url(input.url,true),relatedUrl:url(input.relatedUrl),status:optional('status',100)||'公开收录'});
}
const slug=value=>String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,68)||'record';
const stableSlug=value=>slug(value)+'-'+digest(value).slice(0,10);
export function permalink(kind,item) {
  if(kind==='news')return editionRoute(item);
  if(kind==='year')return '/calendar/'+item.start+'-'+stableSlug(item.id)+'/';
  if(kind==='history')return '/history/'+item.dateKey.replace('-','')+'-'+item.year+'-'+stableSlug(item.id)+'/';
  return '/open-source/'+item.date+'-'+stableSlug(item.title)+'/';
}
export const sourceKey=(kind,item)=>kind+':'+(kind==='openSource'?item.url:item.id);
export const visibleState=row=>row.latest_revision===row.published_revision?'published':row.review_state;
