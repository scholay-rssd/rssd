import MarkdownIt from 'markdown-it';
import {tex} from './tex-plugin.mjs';
import katex from 'katex';
import {createArticleFormatter} from '../../scripts/article-format.mjs';
import {mathSegments} from '../../scripts/article-math.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const mathAssetBase='/assets/math/katex-'+katex.version;
export const hasMath=html=>/class="(?:katex|math-inline|math-block)(?:[" -])/.test(html);
export const mathStyles=html=>hasMath(html)?`<link rel="stylesheet" href="${mathAssetBase}/math.css">`:'';

// Pre-render at publication time. Visitors need CSS/fonts, never the TeX engine.
// Each formula gets fresh macros; one author's definitions cannot affect another.
function formula(tex,display=false){
  const original=display?'\\['+tex+'\\]':'\\('+tex+'\\)';
  let output;
  try{
    if(tex.length>10000)throw Error('Formula too long');
    output=katex.renderToString(tex,{displayMode:display,output:'htmlAndMathml',
      throwOnError:true,trust:false,strict:'ignore',maxExpand:1000,maxSize:20,macros:{}});
  }catch{
    output=`<code class="math-error" title="公式暂时无法排版，已保留原式">${escape(original)}</code>`;
  }
  return `<span class="math-${display?'block':'inline'}"${display?' tabindex="0" role="region" aria-label="数学公式"':''}>${output}</span>`;
}

const md=new MarkdownIt({html:false,linkify:true,breaks:false}).use(tex,{delimiters:'all',render:formula});
// Do not pair a currency sign with a later delimiter inside a code span.
md.inline.ruler.before('math_inline_dollar','math_code_boundary',(state,silent)=>{
  if(state.src[state.pos]!=='$')return false;
  const tail=state.src.slice(state.pos+1),end=tail.search(/(?<!\\)\$/);
  if(end<0||!tail.slice(0,end).includes('`'))return false;
  if(!silent)state.pending+='$';state.pos++;return true;
});
// Callout atom: a blockquote that opens with [!NOTE], [!TIP], [!IMPORTANT],
// [!WARNING] or [!CAUTION] (GitHub alert syntax), optionally followed by a
// title. Any other blockquote, including quoted "[!x]" text, stays a quote.
export const CALLOUT_TITLES=Object.freeze({note:'说明',tip:'提示',important:'重要',warning:'注意',caution:'警告'});
md.core.ruler.push('article_callouts',state=>{
  const t=state.tokens;
  for(let i=0;i<t.length-2;i++){
    if(t[i].type!=='blockquote_open'||t[i+1].type!=='paragraph_open'||t[i+2].type!=='inline')continue;
    const inline=t[i+2],match=/^\[!(note|tip|important|warning|caution)\][ \t]*([^\n]*)/i.exec(inline.content);
    if(!match)continue;
    const kind=match[1].toLowerCase(),title=match[2].trim()||CALLOUT_TITLES[kind],rest=inline.content.slice(match[0].length).replace(/^\n/,'');
    t[i].attrJoin('class','callout callout-'+kind);
    const heading=new state.Token('html_block','',0);heading.content=`<p class="callout-title">${escape(title)}</p>\n`;
    if(!rest.trim()){t.splice(i+1,3,heading);continue;}
    inline.content=rest;inline.children=[];state.md.inline.parse(rest,state.md,state.env,inline.children);
    t.splice(i+1,0,heading);
  }
});
export const {renderArticle,renderArticleParts}=createArticleFormatter(md);

// Older academic records are plain text. Preserve their whitespace and escaping
// while supporting explicit math; never interpret their text as arbitrary HTML.
export function renderMathText(value){
  const source=String(value??'');
  if(!/\$|\\[([]/.test(source))return escape(source);
  try{return mathSegments(source,{markdown:true}).map(part=>part.tex===undefined?escape(part.text):formula(part.tex,part.display)).join('');}
  catch{return escape(source);}
}
export function recordMathHtml(record,fields){
  const output={};
  for(const field of fields){if(!/\$|\\[([]/.test(record[field]??''))continue;const html=renderMathText(record[field]);if(hasMath(html))output[field]=html;}
  return Object.keys(output).length?{mathHtml:output}:{};
}
