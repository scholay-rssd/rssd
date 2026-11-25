import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {notebookMarkdown} from '../desktop/scripts/agent/notebook.mjs';
import {canonicalArticleEndnotes} from '../scripts/article-endnotes.mjs';
import {renderArticleParts} from '../scripts/article-format.mjs';

// Shape of the Center notebooks behind the 2026-11-24/25 Scholay walkthroughs:
// marked reference rows under a 参考文献 heading, then an unmarked platform note.
const row=(id,text,extra={})=>({id,type:'paragraph',state:'ready',text,sourceIds:[],...extra});
const brandNote='Scholay 是研究方法所属品牌的学术平台，科研助手是其中的数据分析与对话功能。';
const fisher='Fisher RA. The use of multiple measurements in taxonomic problems. Annals of Eugenics, 1936, 7(2): 179–188. DOI: [10.1111/j.1469-1809.1936.tb02137.x](https://doi.org/10.1111/j.1469-1809.1936.tb02137.x).';
const mantel='Mantel N. Evaluation of survival data and two new rank order statistics arising in its consideration. Cancer Chemotherapy Reports, 1966, 50(3): 163–170.';
const kaplan='Kaplan EL, Meier P. Nonparametric estimation from incomplete observations. Journal of the American Statistical Association, 1958, 53(282): 457–481. DOI: 10.1080/01621459.1958.10501452.';
const walkthrough=()=>({
 version:2,kind:'article',title:'界面演示',skills:[],fields:{},groups:[],mounts:{templates:[],brands:[]},
 blocks:[
  row('intro','正文引用三篇方法文献。[1][2][3]',{sourceIds:['fisher-wiley','mantel-pubmed','kaplan-doi','dataset']}),
  row('heading-references','参考文献',{type:'heading',level:2}),
  row('reference-1','1. '+fisher,{purpose:'reference',sourceIds:['fisher-wiley']}),
  row('reference-2','2. '+mantel,{purpose:'reference'}),
  row('reference-3','3. '+kaplan,{type:'markdown',purpose:'reference'}),
  row('brand',brandNote),
 ],
 sources:[
  // Cited by a reference row: merged by sourceIds even though the URLs differ.
  {id:'fisher-wiley',title:'The use of multiple measurements in taxonomic problems',url:'https://onlinelibrary.wiley.com/doi/10.1111/j.1469-1809.1936.tb02137.x',summary:'',acquiredVia:'web',reviewed:false},
  // Not linked by any row: merged by its full title.
  {id:'mantel-pubmed',title:'Evaluation of survival data and two new rank order statistics arising in its consideration',url:'https://pubmed.ncbi.nlm.nih.gov/5910392/',summary:'',acquiredVia:'web',reviewed:false},
  // Different title wording: merged by the DOI in its URL.
  {id:'kaplan-doi',title:'Kaplan–Meier 1958',url:'https://doi.org/10.1080%2F01621459.1958.10501452',summary:'',acquiredVia:'web',reviewed:false},
  // A body source absent from the authored list is still listed.
  {id:'dataset',title:'NCCTG Lung Cancer Data',url:'https://stat.ethz.ch/R-manual/R-devel/library/survival/html/lung.html',summary:'',acquiredVia:'web',reviewed:false},
 ],
});
const finalList=text=>text.slice(text.lastIndexOf('## 参考文献'));
const items=text=>new MarkdownIt().parse(finalList(text),{}).filter(t=>t.type==='list_item_open'&&t.level===1).length;

test('a trailing unmarked paragraph after marked references stays body prose, never a numbered entry',()=>{
 const input=walkthrough(),original=structuredClone(input),text=notebookMarkdown(input,{site:null});
 assert.deepEqual(input,original);
 assert.doesNotMatch(finalList(text),/所属品牌/);
 assert.ok(text.indexOf(brandNote)<text.indexOf('## 参考文献'));
 assert.ok(text.indexOf('正文引用三篇方法文献')<text.indexOf(brandNote));
 assert.equal(text.split(brandNote).length,2);
 const parts=renderArticleParts(text,{});
 assert.match(parts.body,/所属品牌/);
 assert.match(parts.endnotes,/<h2>参考文献<\/h2>\n<ol>/);
 assert.doesNotMatch(parts.endnotes,/所属品牌/);
 assert.equal(canonicalArticleEndnotes(text,{site:null}),text);
});

test('sources already in the authored bibliography are merged by sourceIds, DOI or title instead of appended',()=>{
 const text=notebookMarkdown(walkthrough(),{site:null}),list=finalList(text);
 assert.equal(items(text),4);
 assert.match(list,/^1\. Fisher RA\./m);
 assert.match(list,/^2\. Mantel N\./m);
 assert.match(list,/^3\. Kaplan EL, Meier P\./m);
 assert.match(list,/^4\. \[NCCTG Lung Cancer Data\]\(https:\/\/stat\.ethz\.ch\/R-manual\/R-devel\/library\/survival\/html\/lung\.html\)$/m);
 assert.doesNotMatch(list,/onlinelibrary\.wiley\.com|pubmed\.ncbi|01621459\.1958\.10501452\)|\[Kaplan–Meier 1958\]/);
});

test('short or unrelated titles never suppress a used source',()=>{
 const input=walkthrough();
 input.sources.push({id:'short',title:'Data',url:'https://example.org/data',summary:'',acquiredVia:'web',reviewed:false});
 input.blocks[0].sourceIds.push('short');
 assert.match(finalList(notebookMarkdown(input,{site:null})),/\[Data\]\(https:\/\/example\.org\/data\)/);
});

test('a reference section without marked entries keeps the existing entry order',()=>{
 const input=walkthrough();
 for(const b of input.blocks)delete b.purpose;
 const text=notebookMarkdown(input,{site:null});
 assert.ok(text.indexOf('## 参考文献')<text.indexOf(brandNote));
 assert.match(finalList(text),/^4\. Scholay 是研究方法所属品牌/m);
});

test('prose between marked entries is not moved, and later sections are untouched',()=>{
 const input=walkthrough();
 input.blocks.splice(3,0,row('between','以下两篇为补充文献。'));
 input.blocks.push(row('appendix','附录',{type:'heading',level:2}),row('appendix-body','附录正文。'));
 const text=notebookMarkdown(input,{site:null});
 assert.ok(text.indexOf('## 参考文献')<text.indexOf('以下两篇为补充文献。'));
 assert.ok(text.indexOf(brandNote)<text.indexOf('## 参考文献'));
 assert.ok(text.indexOf('## 附录')<text.indexOf('附录正文。'));
});
