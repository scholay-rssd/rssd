import {ACTIVE_SITE as SITE} from './site-profile.mjs';
// Calendar/history records keep their structured fields while their prose can
// be edited with the same Markdown tools as an ordinary article.
// THE definition of each structured column: its record kind and the fixed "## heading" → field sections.
// The converter, the save-time check, the editor's locked headings, the agent instructions and the
// WeChat styles all read it from here, so the contract cannot drift between them.
export const RECORD_STRUCTURE={
  year:{category:SITE.columns[3],sections:[['summary','摘要'],['body','正文']]},
  history:{category:SITE.columns[4],sections:[['factSummary','事实摘要'],['historicalSignificance',SITE.legacy?'学术意义':'历史意义']]},
  openSource:{category:SITE.columns[2],sections:[['summary','项目简介'],['value',SITE.legacy?'学术价值':'使用价值']]}
};
const sections=Object.fromEntries(Object.entries(RECORD_STRUCTURE).map(([kind,v])=>[kind,v.sections]));
/** Headings that organise an article rather than open a chapter; layouts never number them. */
export const UNNUMBERED_HEADINGS=['摘要','正文','来源','参考资料','参考文献','延伸阅读','结语'];
export const kindOfCategory=category=>Object.keys(RECORD_STRUCTURE).find(kind=>RECORD_STRUCTURE[kind].category===category)||null;
export const recordHeadings=kind=>(sections[kind]||[]).map(([,label])=>label);
/** “## 摘要”“## 正文” — the wording used wherever the contract is explained to a writer or an agent. */
export const headingContract=kind=>recordHeadings(kind).map(label=>'“## '+label+'”').join('');
export function structureFor(category,kind=kindOfCategory(category)){
  const labels=recordHeadings(kind);
  return {kind:labels.length?kind:null,sections:labels,unnumbered:[...new Set([...labels,...UNNUMBERED_HEADINGS])]};
}
const squash=text=>text.normalize('NFKC').replace(/\s+/g,'');
/** Reading is tolerant: a structural heading typed with stray spaces, full-width marks or a trailing
 *  "##" is recognised and rewritten to its canonical "## 标题" form. Fenced code is left alone. */
export function normalizeRecordMarkdown(kind,markdown){
  const labels=recordHeadings(kind);if(!labels.length||typeof markdown!=='string')return markdown;
  const canonical=new Map(labels.map(label=>[squash(label),label]));let fenced=false;
  return markdown.replace(/\r\n?/g,'\n').split('\n').map(line=>{
    if(/^\s{0,3}(```|~~~)/.test(line)){fenced=!fenced;return line;}
    if(fenced)return line;
    const match=/^[ \t\u3000]{0,3}[#＃]{2}(?![#＃])[ \t\u3000]*(.*?)[ \t\u3000]*[#＃]*[ \t\u3000]*$/.exec(line);
    const label=match&&canonical.get(squash(match[1]));
    return label?'## '+label:line;
  }).join('\n');
}
/** Why this Markdown cannot be turned back into the record's fields, or null when it can. */
export function recordStructureIssue(kind,markdown){
  if(!sections[kind])return null;
  try{recordFields(kind,{},markdown);return null;}catch(error){return error.message;}
}
export function recordMarkdown(kind,data){
  return '# '+data.title+'\n\n'+sections[kind].map(([key,label])=>'## '+label+'\n\n'+(data[key]||'')).join('\n\n')+'\n';
}
export function recordFields(kind,original,markdown){
  const list=sections[kind];if(!list)throw Error('不支持的官网记录类型');
  markdown=normalizeRecordMarkdown(kind,markdown);
  const data={...original,title:markdown.match(/^# (.+)$/m)?.[1]?.trim()};
  if(!data.title)throw Error('结构化记录需要保留一级标题');
  const first=markdown.indexOf('## '+list[0][1]+'\n');
  const leading=markdown.slice(0,first).replace(/^# [^\n]+\n?/,'').trim();
  if(first>=0&&leading)throw Error('结构化记录的导语和说明请放在“'+list[0][1]+'”内，防止上云时丢失段落');
  let last=-1;
  for(let i=0;i<list.length;i++){
    const [key,label]=list[i],heading='## '+label+'\n',start=markdown.indexOf(heading);
    if(start<last||start<0||markdown.indexOf(heading,start+heading.length)!==-1)throw Error('请保留结构化记录的“'+label+'”二级标题，便于还原官网字段');
    const end=i+1<list.length?markdown.indexOf('## '+list[i+1][1]+'\n',start+heading.length):markdown.length;
    if(end<0)throw Error('结构化记录缺少“'+list[i+1][1]+'”二级标题，请补回这个章节');
    data[key]=markdown.slice(start+heading.length,end).trim();last=start;
  }
  return data;
}
export function asEditorialRecord(row,data){
  if(row.kind==='news')return data;
  const {assets,...fields}=data;
  return {id:'record-'+row.id,title:data.title,summary:data.summary||data.factSummary||'',markdown:recordMarkdown(row.kind,data),
    date:new Date(row.updated).toISOString().slice(0,10),author:SITE.author,...(data.sectionId?{sectionId:data.sectionId}:{}),category:RECORD_STRUCTURE[row.kind]?.category,assets:data.assets||[],
    record:{documentId:row.id,kind:row.kind,fields}};
}

// A continuation is a full reading copy. Structured forms can keep source
// links outside their editable prose; include them in the translation package
// without modifying the source record or the editor's reversible headings.
export function withRecordSourceLinks(data){
  if(!data.record)return data;
  const {kind,fields}=data.record;
  const links=kind==='history'?fields.sources||[]:kind==='year'?[{label:fields.sourceName||'原始来源',url:fields.sourceUrl}]:[{label:'项目原页',url:fields.url},{label:'关联资料',url:fields.relatedUrl}];
  const missing=links.filter((link,i)=>/^https?:\/\//.test(link?.url||'')&&!data.markdown.includes(link.url)&&links.findIndex(x=>x?.url===link.url)===i);
  if(!missing.length)return data;
  return {...data,markdown:data.markdown.trimEnd()+'\n\n## 来源\n\n'+missing.map(({label,url})=>'- ['+String(label||'原始来源').replace(/[\[\]\\\r\n]/g,' ')+']('+url+')').join('\n')+'\n'};
}
