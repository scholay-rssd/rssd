import MarkdownIt from 'markdown-it';
import {createArticleFormatter} from '../../scripts/article-format.mjs';
import {protectMathMarkdown} from '../../scripts/article-math.mjs';
// CDATA is still XML: only XML 1.0 characters are valid in either representation.
const xmlText=value=>String(value??'').replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu,'');
const xml=value=>xmlText(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const cdata=value=>'<![CDATA['+xmlText(value).replaceAll(']]>',']]]]><![CDATA[>')+']]>';
const md=new MarkdownIt({html:false,linkify:true});
md.core.ruler.push('rss_absolute_urls',state=>{
  const visit=tokens=>{for(const token of tokens){
    for(const attr of ['href','src']){
      const value=token.attrGet(attr);
      if(value){try{const url=new URL(value,state.env.articleUrl);if(['http:','https:'].includes(url.protocol))token.attrSet(attr,url.href);}catch{}}
    }
    if(token.children)visit(token.children);
  }};
  visit(state.tokens);
});
const formatter=createArticleFormatter(md);
function renderBody(markdown,articleUrl,site){
  // Keep TeX source portable for the receiving community's math renderer.
  let math;
  try{math=protectMathMarkdown(markdown);}
  catch{
    // An unfinished formula in an existing article must not break the whole feed.
    return formatter.renderArticle(markdown,{articleUrl,site});
  }
  let body=formatter.renderArticle(math.markdown,{articleUrl,site});
  for(const {token,text} of math.replacements)body=body.replaceAll(token,()=>md.utils.escapeHtml(text));
  return body;
}
export function renderRssFeed(site,records,{feedPath='/content-feed.xml',language='zh-CN'}={}){
  const categoryCounts=new Map();
  const items=[...records].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.route.localeCompare(b.route)).filter(record=>{
    const count=categoryCounts.get(record.category)||0;categoryCounts.set(record.category,count+1);return count<20;
  }).map(record=>{
    const url=new URL(record.route,site.origin).href;
    const body=renderBody(record.markdown||'',url,site);
    const date=record.date&&new Date(record.date+'T00:00:00Z');
    return '<item><title>'+xml(record.title)+'</title><link>'+xml(url)+'</link><guid isPermaLink="true">'+xml(url)+'</guid><description>'+xml(record.summary)+'</description><content:encoded>'+cdata(body)+'</content:encoded>'+(date&&Number.isFinite(+date)?'<pubDate>'+date.toUTCString()+'</pubDate>':'')+(record.category?'<category>'+xml(record.category)+'</category>':'')+'</item>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>'+xml(site.name)+'</title><link>'+xml(site.origin)+'</link><description>'+xml(site.description)+'</description><language>'+xml(language)+'</language><atom:link href="'+xml(site.origin+feedPath)+'" rel="self" type="application/rss+xml"/>'+items+'</channel></rss>';
}
