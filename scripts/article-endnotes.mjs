import MarkdownIt from 'markdown-it';
import {normalizeArticleEndnotes} from './article-format.mjs';

const md=new MarkdownIt({html:false});
const headings=new Set(['参考文献','参考资料','来源','附注','品牌与发布说明']);
// Persist a single final bibliography. Keep every entry's inline Markdown,
// continuation paragraphs, links and ordering; never rewrite body prose.
export function canonicalArticleEndnotes(markdown,options={}){
  const text=normalizeArticleEndnotes(markdown,options),tokens=md.parse(text,{}),lines=text.split('\n');
  const sections=[];
  for(let i=0;i<tokens.length;i++)if(tokens[i].type==='heading_open'&&tokens[i].level===0)sections.push({i,line:tokens[i].map[0],title:tokens[i+1].content,tag:tokens[i].tag});
  let first=sections.length;
  while(first>0&&headings.has(sections[first-1].title))first--;
  if(first===sections.length)return text;
  const tail=sections.slice(first),entries=[];
  for(let s=0;s<tail.length;s++){
    const start=tail[s].i+3,end=tail[s+1]?.i??tokens.length;
    for(let i=start;i<end;){
      const token=tokens[i];
      if(token.level!==0)return text;
      if(token.type==='ordered_list_open'||token.type==='bullet_list_open'){
        let close=i+1;while(close<end&&tokens[close].level!==0)close++;
        if(close>=end||!['ordered_list_close','bullet_list_close'].includes(tokens[close].type))return text;
        for(const item of tokens.slice(i+1,close).filter(t=>t.type==='list_item_open'&&t.level===1)){
          const chunk=lines.slice(...item.map),match=chunk[0].match(/^(\s*)(?:\d+[.)]|[-+*])(\s+)/);
          if(!match)return text;
          const width=match[0].length;
          chunk[0]=chunk[0].slice(width);
          entries.push(chunk.map((line,n)=>n?line.replace(new RegExp('^ {1,'+width+'}'),''):line).join('\n').trimEnd());
        }
        i=close+1;
      }else if(token.type==='paragraph_open'&&tokens[i+2]?.type==='paragraph_close'){
        entries.push(lines.slice(...token.map).join('\n').trimEnd());i+=3;
      }else return text; // Code, quotes, tables and nested sections stay untouched.
    }
  }
  if(!entries.length)return text;
  const heading=tail.find(s=>s.title==='参考文献'||s.title==='参考资料')||tail[0];
  const numbered=entries.map((entry,i)=>{const prefix=(i+1)+'. ';return prefix+entry.replace(/\n/g,'\n'+' '.repeat(prefix.length));}).join('\n\n');
  return lines.slice(0,tail[0].line).join('\n').trimEnd()+'\n\n'+'#'.repeat(Number(heading.tag.slice(1)))+' 参考文献\n\n'+numbered+'\n';
}
