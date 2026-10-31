import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {layoutNoteCards} from './note-cards/layout.mjs';
import {prepareNoteMath} from './note-cards/math-runtime.mjs';
import {protectMathMarkdown,restoreMathHtml,mathSegments} from '../../scripts/article-math.mjs';
import {renderArticle} from '../../scripts/article-format.mjs';
import {browserPath,renderCards,readPage,exportCards,approvedMedia} from './note-cards.mjs';
const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {chromium}=require('playwright-core'),sharp=require('sharp');
let browser,root;
before(async()=>{root=await mkdtemp(join(tmpdir(),'today-note-cards-'));process.env.SCHOLAY_APP_DATA=join(root,'state');process.env.SCHOLAY_SITE_JSON=JSON.stringify({name:'图文笔记测试',origin:'https://example.com'});browser=await chromium.launch({executablePath:await browserPath(),headless:true});});
after(async()=>{await browser?.close();await rm(root,{recursive:true,force:true});});
async function layout(html,breaks={}){const page=await browser.newPage({viewport:{width:1080,height:1440}});await page.route('**/*',route=>route.abort());await prepareNoteMath(page);try{const result=await page.evaluate(layoutNoteCards,{html,breaks});return {page,result};}catch(error){await page.close();throw error;}}
test('all text, emphasis and list structure survive continuation without overflow',async()=>{
 const paragraph='长段落需要依据真实字体测量，确保所有字都能完整保留。'.repeat(80),list='列表项目同样可能很长，续页后仍然保持列表结构。'.repeat(65);
 const {page,result}=await layout(`<h1>测试标题</h1><p><strong>${paragraph}</strong></p><h2>第二节</h2><ol start="3"><li>${list}</li></ol><pre>${'const example = 123;\n'.repeat(100)}</pre>`);
 try{
  assert.equal(result.pages.map(p=>p.text).join(''),result.text);assert.ok(result.pages.length>5);
  for(const p of result.pages){assert.deepEqual([...new Set(p.positions.map(x=>x.id))],p.blocks);for(const position of p.positions){assert.ok(position.left>=0&&position.left<1080);assert.ok(position.top>=0&&position.top<1440);}}
  assert.equal(result.blocks.find(b=>b.id==='b1').text,paragraph);
  assert.ok(result.pages.filter(p=>p.positions.some(x=>x.id==='b1')).length>1);
  assert.equal(await page.locator('.card strong').evaluateAll(elements=>elements.map(e=>e.textContent).join('')),paragraph);
  assert.equal(await page.locator('.card ol > li').evaluateAll(elements=>elements.map(e=>e.textContent).join('')),list);
  assert.equal(await page.locator('.card .body').evaluateAll(elements=>elements.every(e=>e.scrollHeight<=e.clientHeight+1)),true);
  assert.equal(await page.locator('.card ol').first().getAttribute('start'),'3');
 }finally{await page.close();}
});
test('headings start pages and explicit flow / page overrides alter only layout',async()=>{
 const html='<h1>标题</h1><p>开场</p><h2>第一节</h2><p>第一段</p><p>第二段</p><h3>小节</h3><p>结束</p>';
 for(const [breaks,count] of [[{},3],[{b2:'flow',b5:'flow'},1],[{b2:'flow',b4:'page',b5:'flow'},2]]){
  const {page,result}=await layout(html,breaks);try{assert.equal(result.pages.length,count);assert.equal(result.pages.map(p=>p.text).join(''),result.text);}finally{await page.close();}
 }
});
test('figures and captions remain together; table rows and repeated headers remain visible',async()=>{
 const image=(await sharp({create:{width:900,height:600,channels:3,background:'#b8cdb0'}}).webp().toBuffer()).toString('base64');
 const rows=Array.from({length:32},(_,i)=>`<tr><td>ROW-${i}</td><td>需要保留的表格文字 ${i}</td></tr>`).join('');
 const {page,result}=await layout(`<h1>图表</h1><p>${'介绍图表的背景。'.repeat(30)}</p><p><img src="data:image/webp;base64,${image}"></p><p>图：测试说明</p><h2>数据</h2><table><thead><tr><th>编号</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`);
 try{
  assert.equal(await page.locator('.card figure:has(img) figcaption').textContent(),'图：测试说明');
  assert.equal(await page.locator('.card tbody tr').count(),32);
  assert.equal(await page.locator('.card table').count(),await page.locator('.card table thead').count());
  assert.equal(await page.locator('.card .body').evaluateAll(elements=>elements.every(e=>e.scrollHeight<=e.clientHeight+1)),true);
  assert.ok(result.pages.length>=4);
 }finally{await page.close();}
});
test('active content and arbitrary network images are rejected',async()=>{
 const {page}=await layout('<script>window.bad=true</script><h1 onclick="window.bad=true">安全标题</h1><iframe src="https://example.com"></iframe><p style="display:none">仍然可见</p>');
 try{assert.equal(await page.evaluate(()=>window.bad),undefined);assert.equal(await page.locator('.card [onclick],.card script,.card iframe').count(),0);assert.equal(await page.locator('.card p').textContent(),'仍然可见');}finally{await page.close();}
 const untrusted=await browser.newPage();try{await assert.rejects(untrusted.evaluate(layoutNoteCards,{html:'<img src="https://attacker.example/a.png">'}),/配图/);}finally{await untrusted.close();}
 assert.equal(approvedMedia('https://example.com/article-media/'+'a'.repeat(64)+'.webp','https://example.com'),true);
 for(const value of ['https://attacker.example/article-media/'+'a'.repeat(64)+'.webp','https://example.com/admin/api','https://example.com/article-media/'+'a'.repeat(64)+'.webp?token=secret'])assert.equal(approvedMedia(value,'https://example.com'),false);
});
test('PNG export is the preview itself; JPG dimensions and original files stay intact',async()=>{
 const manuscripts=join(root,'manuscripts'),output=join(root,'exports');await mkdir(manuscripts);await mkdir(output);
 const original=join(manuscripts,'正文.md');await writeFile(original,'# 原稿\n\n不可改动');
 const rendered=await renderCards({articleId:'local-test',html:'<h1>可导出的笔记</h1><p>预览与导出共用图片。</p><h2>第二页</h2><p>编号保持阅读顺序。</p>'});
 const png=await exportCards({id:rendered.id,sourceHash:rendered.sourceHash,format:'png',platform:'xiaohongshu',directory:output,manuscriptRoot:manuscripts});
 assert.equal(png.count,2);const preview=Buffer.from((await readPage({id:rendered.id,index:0})).image.split(',')[1],'base64');assert.deepEqual(await readFile(join(png.directory,'01.png')),preview);
 const jpg=await exportCards({id:rendered.id,sourceHash:rendered.sourceHash,format:'jpeg',platform:'douyin',directory:output,manuscriptRoot:manuscripts});
 const meta=await sharp(await readFile(join(jpg.directory,'01.jpg'))).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,1440);assert.equal(meta.format,'jpeg');
 assert.equal(await readFile(original,'utf8'),'# 原稿\n\n不可改动');assert.deepEqual(await readdir(manuscripts),['正文.md']);
 await assert.rejects(exportCards({id:rendered.id,sourceHash:rendered.sourceHash,format:'png',platform:'douyin',directory:manuscripts,manuscriptRoot:manuscripts}),/工作目录之外/);
 await assert.rejects(exportCards({id:rendered.id,sourceHash:'stale',format:'png',platform:'douyin',directory:output}),/正文已变化/);
 await writeFile(join(root,'state/note-cards',rendered.id,'01.png'),'corrupt');await assert.rejects(readPage({id:rendered.id,index:0}),/文件已变化/);
});
test('Markdown protection preserves TeX through Markdown parsing, leaving code and prices intact',()=>{
 const source=String.raw`# 公式

行内 \(x_i^2 + \sqrt{y}\)，还有 $a_b$。

\[
\begin{aligned}a &= b_1 \\
c &= \frac{d}{e}\end{aligned}
\]

价格 $20 和 $30；普通括号（说明），(R)。

`+'`$code$`\n\n```tex\n\\[code\\]\n```\n\n    $indented$\n';
 const result=protectMathMarkdown(source),html=restoreMathHtml(renderArticle(result.markdown),result.replacements);
 assert.equal(result.replacements.length,3);assert.ok(result.markdown.includes('$20 和 $30'));assert.ok(result.markdown.includes('`$code$`'));
 assert.ok(html.includes(String.raw`\(x_i^2 + \sqrt{y}\)`));assert.ok(html.includes(String.raw`\frac{d}{e}`));assert.ok(html.includes('$indented$'));
 assert.equal(restoreMathHtml('<p>TOKEN</p>',[{token:'TOKEN',text:'$x<y$'}]),'<p>$x&lt;y$</p>');
 assert.equal(mathSegments('价格 $20 和 $30；(R)；[普通括号]',{legacy:true}).filter(x=>x.tex!==undefined).length,0);
 assert.throws(()=>protectMathMarkdown(String.raw`\[x+1`),/未闭合/);
});
test('inline, display, legacy and list formulas stay whole across measured pagination with bundled fonts',async()=>{
 const equation=String.raw`\(\frac{a_i^2}{\sqrt{b}} + \sum_{n=1}^{10} n\)`;
 const repeated=('文字保留，并检查公式 '+equation+'。').repeat(42);
 const html=String.raw`<h1>公式分页</h1><p>${repeated}</p><h2>分式与矩阵</h2><p>\[\begin{aligned}N &= \frac{M C}{R} \\ x &= \begin{pmatrix}1&amp;2\\3&amp;4\end{pmatrix}\end{aligned}\]</p><p>[ \hat N = \frac{(M+1)(C+1)}{R+1} - 1 ]</p><ul><li><strong>\(\operatorname{Var}(\hat N)=\dfrac{(M+1)(C+1)(M-R)(C-R)}{(R+1)^2(R+2)}\)</strong></li></ul><pre>\(literal_code\)</pre>`;
 const {page,result}=await layout(html);
 try{
  assert.equal(result.formulaCount,45);assert.equal(await page.locator('.card .note-math').count(),45);assert.equal(result.pages.map(p=>p.text).join(''),result.text);
  assert.equal(await page.locator('.card .note-math').evaluateAll(nodes=>nodes.every(e=>!!e.querySelector('.katex')&&parseFloat(getComputedStyle(e).fontSize)>=22)),true);
  assert.equal(await page.locator('.card .body').evaluateAll(nodes=>nodes.every(e=>e.scrollHeight<=e.clientHeight+1&&[...e.querySelectorAll('*')].filter(c=>!(c instanceof SVGElement)||c.tagName==='svg').every(c=>c.getBoundingClientRect().right<=e.getBoundingClientRect().right+1))),true);
  assert.equal(await page.locator('.card pre').textContent(),String.raw`\(literal_code\)`);
  assert.ok(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='KaTeX_Main'&&f.status==='loaded')));
 }finally{await page.close();}
});
test('formula exports share preview pixels; invalid or unsafe TeX prevents a misleading export',async()=>{
 const output=join(root,'math-exports');await mkdir(output);
 const html=String.raw`<h1>种群估计</h1><p>\[\hat N=\frac{(M+1)(C+1)}{R+1}-1\]</p><p>行内 \(R\ge 7\)，方差 \(\sigma^2\)。</p>`;
 const rendered=await renderCards({articleId:'math-test',html});assert.equal(rendered.formulaCount,3);
 for(const format of ['png','jpeg']){
  const result=await exportCards({id:rendered.id,sourceHash:rendered.sourceHash,format,platform:'xiaohongshu',directory:output});
  const bytes=await readFile(join(result.directory,format==='png'?'01.png':'01.jpg')),meta=await sharp(bytes).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,1440);
  if(format==='png')assert.deepEqual(bytes,Buffer.from((await readPage({id:rendered.id,index:0})).image.split(',')[1],'base64'));
 }
 await assert.rejects(renderCards({html:String.raw`<p>\(\unknowncommand{x}\)</p>`}),/公式无法排版/);
 await assert.rejects(renderCards({html:String.raw`<p>\(\href{https://attacker.example}{x}\)</p>`}),/外部链接/);
});
