import MarkdownIt from 'markdown-it';
import {validateArticleViews} from '../contracts/article-views.mjs';
import {siteBrandLine} from '../contracts/brand-endnotes.mjs';

// Shared by local website preview and the public renderer. Raw HTML is text.
export function createArticleFormatter(md=new MarkdownIt({html:false,linkify:true,breaks:false})){
// Link actual URLs in prose, captions and bibliographies without interpreting
// arbitrary dotted words or email addresses as links. Code stays literal.
// Extend linkify-it's path delimiters before its validators compile. Chinese
// punctuation then ends a bare URL in both inline and block parsing. Explicit
// Markdown links retain their exact destinations, including Unicode punctuation.
md.linkify.onCompile=function(){
  this.re.src_path=this.re.src_path.replaceAll(this.re.src_ZCc,
    `(?:${this.re.src_ZCc}|[，。！？；：、‘’“”「」『』【】（）《》])`);
};
md.linkify.set({fuzzyLink:false,fuzzyEmail:false}).add('https:','http:');
const originalFence=md.renderer.rules.fence;
md.renderer.rules.fence=(tokens,i,options,env,self)=>{
  if(tokens[i].info.trim()!=='scholay-view')return originalFence(tokens,i,options,env,self);
  validateArticleViews(JSON.parse(tokens[i].content));
  return ''; // Rendered as an article panel / aggregate view, never as code.
};
const originalLink=md.renderer.rules.link_open||((tokens,i,options,env,self)=>self.renderToken(tokens,i,options));
md.renderer.rules.link_open=(tokens,i,options,env,self)=>{
  tokens[i].attrSet('rel','noopener noreferrer');
  return originalLink(tokens,i,options,env,self);
};
const originalImage=md.renderer.rules.image;
md.renderer.rules.image=(tokens,i,options,env,self)=>{
  const src=tokens[i].attrGet('src')||'';
  // A local preview supplies replacements keyed by parsed Markdown image URLs.
  // Keep the default public renderer's URL restrictions, including raw data URLs.
  if(env.imageSources?.has(src)){
    const replacement=env.imageSources.get(src);
    if(typeof replacement!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(replacement))return '<span class="muted">[图片无法预览]</span>';
    tokens[i].attrSet('src',replacement);
  }else if(!/^https?:\/\//i.test(src)&&!/^\/article-media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(src))return '<span class="muted">[图片未打包]</span>';
  const size=env.imageSizes?.get(src);
  if(size){tokens[i].attrSet('width',String(size.width));tokens[i].attrSet('height',String(size.height));}
  // The first picture is usually the largest paint. Later pictures stay lazy.
  env.imageOrdinal=(env.imageOrdinal||0)+1;
  tokens[i].attrSet('decoding','async');
  if(env.imageOrdinal===1)tokens[i].attrSet('fetchpriority','high');
  else tokens[i].attrSet('loading','lazy');
  return originalImage(tokens,i,options,env,self);
};
// Older publications stored selected brand notes as plain final paragraphs.
// Recognize only the established disclosures and an exact site-name/home link;
// never infer a brand from prose, quotations, code, or arbitrary reference links.
const normalizeArticleEndnotes=(markdown,{site}={})=>{
  const text=String(markdown),lines=text.split('\n'),tokens=md.parse(text,{}),notes=[];
  let end=tokens.length,start=lines.length;
  const selectedBrand=inline=>{
    const value=inline.content.trim();
    if(/^信息由\s*\[Scholay 学术一站式平台\]\(https:\/\/www\.scholay\.com\/t\/M4ZZW8KRE5\/?\)\s*整理并发表，如有侵权请反馈下架。?$/.test(value))return true;
    if(/^信息同步发表于\s*\[恩特学术\]\(https:\/\/enterscholar\.com\/?\)，智能时代的学者社区。?$/.test(value))return true;
    if(site?.origin&&siteBrandLine(value,site.origin))return true;
    const children=inline.children||[];
    if(!site?.name||!site.origin||children.length!==3||children[0].type!=='link_open'||children[1].type!=='text'||children[1].content!==site.name||children[2].type!=='link_close')return false;
    try{const link=new URL(children[0].attrGet('href')),home=new URL(site.origin);return link.origin===home.origin&&link.pathname==='/'&&!link.search&&!link.hash;}catch{return false;}
  };
  while(end>=3){
    const [open,inline,close]=tokens.slice(end-3,end);
    if(open.type!=='paragraph_open'||open.level!==0||inline.type!=='inline'||close.type!=='paragraph_close'||!selectedBrand(inline))break;
    notes.unshift(lines.slice(...open.map).join('\n').trim());start=open.map[0];end-=3;
  }
  if(!notes.length)return text;
  const body=lines.slice(0,start).join('\n').trimEnd().replace(/(?:^|\n)#{1,6} 品牌与发布说明$/,'').trimEnd();
  return body+'\n\n### 品牌与发布说明\n\n'+notes.map((note,i)=>{
    const prefix=(i+1)+'. ';
    return prefix+note.replace(/\r?\n/g,'\n'+' '.repeat(prefix.length));
  }).join('\n\n')+'\n';
};
// Captions exported by the notebook are plain paragraphs. Only classify an
// image-adjacent paragraph with an explicit caption/source label; ordinary
// paragraphs following an illustration must retain their body typography.
md.core.ruler.push('article_captions',state=>{
  const t=state.tokens;
  for(let i=3;i<t.length-2;i++){
    if(t[i].type!=='paragraph_open'||t[i].level!==0||t[i-3]?.type!=='paragraph_open')continue;
    const image=t[i-2]?.children?.filter(x=>x.type!=='text'||x.content.trim());
    if(image?.length!==1||image[0].type!=='image')continue;
    const label=(t[i+1].children||[]).filter(x=>x.type==='text'||x.type==='code_inline').map(x=>x.content).join('').trim();
    if(/^(?:图(?:注|示|片|像|[｜|：:]|\s*\d)|图片来源|来源[：:]|Figure\s*\d|Photo[：:]|AI\s*生成)/i.test(label)||/(?:图[：:]|图片来源[：:]|摄影[：:]|\bCC BY(?:-SA)?\b|AI\s*(?:生成|辅助)|示意图)/i.test(label))t[i].attrSet('class','article-caption');
  }
});
// Presentation only: the stored manuscript and selected brand snapshots remain
// unchanged. Merge an adjacent bibliography list with the final brand list.
const articlePresentation=(markdown,options)=>{
  let text=normalizeArticleEndnotes(markdown,options),tokens=md.parse(text,{});
  const finalHeading=tokens.findLastIndex(t=>t.type==='heading_open'&&t.level===0);
  if(finalHeading>=0&&/^(参考文献|参考资料|来源|附注|品牌与发布说明)$/.test(tokens[finalHeading+1]?.content)){
    const lines=text.split('\n'),start=tokens[finalHeading].map[0],parents=[];let changed=false;
    for(const token of tokens){
      if(token.nesting===1)parents.push(token.type);
      if(token.type==='inline'&&token.map?.[0]>start&&token.map[1]===token.map[0]+1&&
         (parents.join('/')==='paragraph_open'||/^(ordered_list_open|bullet_list_open)\/list_item_open\/paragraph_open$/.test(parents.join('/')))){
        const i=token.map[0],match=lines[i].match(/^( {0,3}(?:(?:\d+[.)]|[-+*])\s+)?)(\[.+)$/);
        const next=match&&siteBrandLine(match[2]);if(next&&next!==match[2]){lines[i]=match[1]+next;changed=true;}
      }
      if(token.nesting===-1)parents.pop();
    }
    if(changed){text=lines.join('\n');tokens=md.parse(text,{});}
  }
  const heading=tokens.findLastIndex((t,i)=>t.type==='heading_open'&&t.level===0&&tokens[i+1]?.content==='品牌与发布说明');
  if(heading<0){
    const reference=tokens.findLastIndex((t,i)=>t.type==='heading_open'&&t.level===0&&tokens[i+1]?.content==='参考文献');
    const finalList=reference>=0&&tokens[reference+3]?.type==='ordered_list_open'&&tokens.at(-1)?.type==='ordered_list_close'&&!tokens.slice(reference+4,-1).some(t=>t.level===0);
    return {text,start:finalList?tokens[reference].map[0]:null};
  }
  if(tokens[heading+3]?.type!=='ordered_list_open'||tokens.at(-1)?.type!=='ordered_list_close'||tokens.slice(heading+4,-1).some(t=>t.level===0))return {text,start:null};
  const lines=text.split('\n');
  let start=tokens[heading].map[0],prefix='## 参考文献\n\n',listStart=tokens[heading+3].map[0];
  const ref=tokens.findLastIndex((t,i)=>i<heading&&t.type==='heading_open'&&t.level===0&&/^(参考文献|参考资料|来源|附注)$/.test(tokens[i+1]?.content));
  if(ref>=0&&['ordered_list_open','bullet_list_open'].includes(tokens[ref+3]?.type)&&tokens.slice(ref+4,heading).filter(t=>t.level===0).length===1){
    start=tokens[ref].map[0];
    // Convert only top-level list markers; nested lists and continuation lines
    // remain intact. Markdown handles consecutive numbering in the merged list.
    const first=tokens[ref+3],items=tokens.slice(ref+4,heading).filter(t=>t.type==='list_item_open'&&t.level===1);
    const refLines=lines.slice(first.map[0],tokens[heading].map[0]);
    const initial=Number(first.attrGet('start')||1);
    for(const [i,item] of items.entries())refLines[item.map[0]-first.map[0]]=refLines[item.map[0]-first.map[0]].replace(/^(\s*)(?:[-+*]|\d+[.)])\s+/,(_,space)=>space+(initial+i)+'. ');
    prefix+=refLines.join('\n').trimEnd()+'\n\n';
  }
  return {text:lines.slice(0,start).join('\n')+(start?'\n':'')+prefix+lines.slice(listStart).join('\n'),start};
};
// Resolve citations from the authored bibliography, never from arbitrary body
// links. Pass the same index to split body/endnote renders. Code and references
// remain literal; all generated markup is renderer-owned (raw HTML stays off).
const citationIndex=text=>{
 const tokens=md.parse(text,{}),urls=new Map(),numbers=new Map();let refs=false,number=0;
 for(let i=0;i<tokens.length;i++){
  const t=tokens[i];
  if(t.type==='heading_open'&&t.level===0)refs=/^(参考文献|参考资料|References)$/i.test(tokens[i+1]?.content||'');
  if(!refs)continue;
  if(t.type==='ordered_list_open'&&t.level===0)number=Number(t.attrGet('start')||1)-1;
  if(t.type==='list_item_open'&&t.level===1){number++;numbers.set(number,null);}
  if(t.type==='inline')for(const child of t.children||[])if(child.type==='link_open'&&number){const url=child.attrGet('href');if(!urls.has(url))urls.set(url,number);if(!numbers.get(number))numbers.set(number,url);}
 }
 return {urls,numbers};
};
md.core.ruler.push('article_citations',state=>{
 const index=state.env.citations;if(!index)return;
 let refs=false;
 const marker=(number,url)=>{
  const token=(type,tag,nesting,content)=>{const t=new state.Token(type,tag,nesting);if(content)t.content=content;return t;};
  const open=token('sup_open','sup',1);open.attrSet('class','article-citation');
  const result=[open];if(url){const link=token('link_open','a',1);link.attrSet('href',url);link.attrSet('aria-label','参考文献 '+number);result.push(link);}
  result.push(token('text','',0,'['+number+']'));if(url)result.push(token('link_close','a',-1));result.push(token('sup_close','sup',-1));return result;
 };
 for(let i=0;i<state.tokens.length;i++){
  const t=state.tokens[i];
  if(t.type==='heading_open'&&t.level===0)refs=/^(参考文献|参考资料|来源|附注|品牌与发布说明|References)$/i.test(state.tokens[i+1]?.content||'');
  if(refs||t.type!=='inline')continue;
  const result=[],children=t.children||[];let linked=false;
  for(let j=0;j<children.length;j++){
   const child=children[j],url=child.type==='link_open'&&child.attrGet('href'),number=index.urls.get(url);
   if(number){let end=j+1;while(end<children.length&&children[end].type!=='link_close')end++;if(end<children.length){result.push(...children.slice(j+1,end),...marker(number,url));j=end;continue;}}
   if(child.type==='link_open')linked=true;
   if(child.type==='text'&&!linked){let offset=0;for(const m of child.content.matchAll(/\[(\d+)\]/g)){const n=Number(m[1]);if(!index.numbers.has(n))continue;const text=new state.Token('text','',0);text.content=child.content.slice(offset,m.index);result.push(text,...marker(n,index.numbers.get(n)));offset=m.index+m[0].length;}if(offset){const text=new state.Token('text','',0);text.content=child.content.slice(offset);result.push(text);continue;}}
   result.push(child);if(child.type==='link_close')linked=false;
  }
  t.children=result;
 }
});
const renderArticle=(markdown,options={})=>{const {text}=articlePresentation(markdown,options);return md.render(text,{imageSources:options.imageSources,imageSizes:options.imageSizes,articleUrl:options.articleUrl,citations:citationIndex(text)});};
const renderArticleParts=(markdown,options={})=>{
  const {text,start}=articlePresentation(markdown,options),env={imageSources:options.imageSources,imageSizes:options.imageSizes,citations:citationIndex(text)};
  if(start===null)return {body:md.render(text,env),endnotes:''};
  const lines=text.split('\n');
  return {body:md.render(lines.slice(0,start).join('\n'),env),endnotes:md.render(lines.slice(start).join('\n'),env)};
};
const markdownImages=markdown=>{
  const found=[];
  const walk=tokens=>{for(const token of tokens||[]){if(token.type==='image')found.push(token.attrGet('src'));walk(token.children);}};
  walk(md.parse(String(markdown),{}));return [...new Set(found)];
};
const markdownImageDetails=markdown=>{
  const found=new Map();
  const walk=tokens=>{for(const token of tokens||[]){if(token.type==='image'){const src=token.attrGet('src');if(!found.has(src))found.set(src,{src,alt:token.content||''});}walk(token.children);}};
  walk(md.parse(String(markdown),{}));return [...found.values()];
};
const markdownLinks=markdown=>{
  const found=new Set();
  const walk=tokens=>{for(const token of tokens||[]){if(token.type==='link_open')found.add(token.attrGet('href'));walk(token.children);}};
  walk(md.parse(String(markdown),{}));return [...found];
};
return {normalizeArticleEndnotes,renderArticle,renderArticleParts,markdownImages,markdownImageDetails,markdownLinks};
}
// Desktop editors keep their existing preview contract; public themes opt into
// formula rendering through web/engine/article-math.mjs.
export const {normalizeArticleEndnotes,renderArticle,renderArticleParts,markdownImages,markdownImageDetails,markdownLinks}=createArticleFormatter();
