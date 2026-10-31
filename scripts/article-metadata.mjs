import MarkdownIt from 'markdown-it';
import {validateArticleViews} from '../contracts/article-views.mjs';
const parser=new MarkdownIt({html:false});
export function articleViewsFromMarkdown(markdown){
  const blocks=parser.parse(String(markdown),{}).filter(t=>t.type==='fence'&&t.info.trim()==='scholay-view');
  if(!blocks.length)return undefined;
  if(blocks.length!==1)throw Error('每篇文章只允许一个 scholay-view 配置块');
  let value;try{value=JSON.parse(blocks[0].content);}catch{throw Error('scholay-view 必须是有效 JSON');}
  return validateArticleViews(value);
}
