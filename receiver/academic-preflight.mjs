import {visible} from '../contracts/rssd-publication.cjs';

// Existing v1 receipts are checked before this guard. Do not rewrite their
// payloads or apply new validation to replayed requests.
export function preflightAcademicNews(value,site){
  if(site.id!=='scholay-today'||value.locale!=='zh-CN'||!visible(value)||value.content.metadata.record)return;
  const fail=message=>{throw Object.assign(new Error(message),{statusCode:400,code:'invalid_academic_news'});};
  if(!/^\/(?:calendar|history|open-source|news)\/[a-zA-Z0-9-]+\/$/.test(value.route))fail('文章路径不符合今日学术的路由格式');
  const {content}=value,metadata=content.metadata;
  const field=(input,max,name)=>{
    if(typeof input!=='string'||input.length>max)fail(name+'为空或超过长度限制');
    return input.trim();
  };
  if(!field(content.title,500,'标题')||!field(content.summary,4000,'摘要')||!field(content.bodyMarkdown,160000,'正文'))fail('请填写标题、摘要与正文');
  const section=site.sections.find(s=>s.id===value.sectionId);
  field(metadata.author||site.author,100,'作者');
  field(metadata.category||section?.name||site.columns[1],80,'分类');
  const date=field(metadata.date||'1970-01-01',10,'日期');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('文章日期无效');
}
