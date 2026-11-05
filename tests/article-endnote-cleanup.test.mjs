import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalArticleEndnotes as clean} from '../scripts/article-endnotes.mjs';
import {markdownLinks} from '../scripts/article-format.mjs';
test('persisted references and brands have continuous literal numbers and preserve multiline notes',()=>{
 const text='正文 **原文**。\n\n## 参考文献\n\n1. [论文](https://example.org/paper)\n2. 第二篇\n\n### 品牌与发布说明\n\n1. [品牌](https://example.org/brand)\n\n   关系说明。\n2. 同步说明\n';
 const out=clean(text);assert.match(out,/3\. \[品牌\]/);assert.match(out,/4\. 同步说明/);assert.match(out,/   关系说明/);assert.doesNotMatch(out,/品牌与发布说明/);assert.equal(clean(out),out);assert.deepEqual(markdownLinks(out),markdownLinks(text));assert.ok(out.startsWith('正文 **原文**。'));
});
test('source bullets and explanatory endnotes precede brands in one final list',()=>{
 const text='正文\n\n### 来源\n\n- 材料\n\n### 附注\n\n1. 注释\n\n### 品牌与发布说明\n\n1. 品牌\n';
 assert.equal(clean(text),'正文\n\n### 参考文献\n\n1. 材料\n\n2. 注释\n\n3. 品牌\n');
});
test('body, quotes, code and non-final sections are never consumed',()=>{
 for(const text of ['正文\n\n```md\n### 品牌与发布说明\n```','正文\n\n### 品牌与发布说明\n\n1. 品牌\n\n## 正文继续\n\n后文','正文\n\n> 品牌'])assert.equal(clean(text),text);
});
test('legacy trailing site signatures become numbered references without inventing brands',()=>{
 const site={name:'学术门户',origin:'https://enter.scholay.com'};
 assert.equal(clean('正文。\n\n[学术门户](https://enter.scholay.com)',{site}),'正文。\n\n### 参考文献\n\n1. [学术门户](https://enter.scholay.com)\n');
});
test('canonical references remain at the end after theme source panels',async()=>{
 const {renderArticleParts}=await import('../scripts/article-format.mjs');
 const parts=renderArticleParts('正文。\n\n### 参考文献\n\n1. 文献\n2. 品牌\n');
 assert.equal(parts.body,'<p>正文。</p>\n');assert.match(parts.endnotes,/<h3>参考文献<\/h3>/);assert.equal((parts.endnotes.match(/<li>/g)||[]).length,2);
});
