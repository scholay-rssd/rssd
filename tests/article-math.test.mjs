import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile,cp,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {renderArticle,renderArticleParts,renderMathText,mathStyles,mathAssetBase} from '../web/engine/article-math.mjs';
import {writeMathAssets} from '../web/engine/math-assets.mjs';
import {renderArticle as legacyRender} from '../scripts/article-format.mjs';
import {protectMathMarkdown} from '../scripts/article-math.mjs';
import {articleBodyOnPage} from '../scripts/website-publication.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {byteHash} from '../web/engine/theme-homepage.mjs';
import {writeCalendarData} from '../web/themes/academic/calendar-data.mjs';

test('public Markdown renders both delimiter styles, aligned equations and matrices with accessible MathML',()=>{
  for(const source of [String.raw`中文 $x_1^2+\frac{a}{b}$ 公式`,String.raw`中文 \(x<y\) 公式`,String.raw`$$
\begin{aligned}a&=b+c\\d&=e\end{aligned}
$$`,String.raw`\[
\begin{pmatrix}1&2\\3&4\end{pmatrix}
\]`]){
    const result=renderArticle(source);
    assert.match(result,/class="katex"/);assert.match(result,/<math /);assert.match(result,/annotation encoding="application\/x-tex"/);
    assert.doesNotMatch(result,/math-error|<script/);assert.match(mathStyles(result),/\/assets\/math\/katex-/);
  }
  assert.match(renderArticle('> $a_1$\n\n- $b_2$\n\n| A | B |\n|---|---|\n| $x$ | $y$ |'),/<table>/);
  assert.equal((renderArticle('> $a_1$\n\n- $b_2$').match(/class="katex"/g)||[]).length,2);
});

test('ordinary text, code, currency and escaped dollars remain literal; desktop preview stays compatible',()=>{
  const source='价格 $20 和 $30。代码 `$x$`，转义 \\$y$。\n\n```tex\n$$x+y$$\n```\n\n    $z$\n';
  const result=renderArticle(source);
  assert.doesNotMatch(result,/class="katex"|math-error/);assert.match(result,/<code>\$x\$<\/code>/);
  assert.match(result,/\$20 和 \$30/);assert.equal(mathStyles(result),'');
  assert.doesNotMatch(renderMathText(source),/class="katex"/);
  assert.equal(protectMathMarkdown('价格 $20 和 $30；代码 `$x$`').replacements.length,0);
  assert.doesNotMatch(legacyRender('$x_1$'),/katex/);
});

test('invalid or untrusted TeX cannot break publication, load resources or leak macros',()=>{
  for(const input of [String.raw`$\brokencommand{<script>}$`,String.raw`$\def\a{\a}\a$`,'$'+'x'.repeat(10001)+'$']){
    const html=renderArticle(input);assert.match(html,/math-error/);assert.doesNotMatch(html,/<script/);
  }
  for(const input of [String.raw`$\href{javascript:alert(1)}{click}$`,String.raw`$\includegraphics{https://evil.invalid/a}$`,String.raw`$\htmlStyle{background:url(https://evil.invalid)}{x}$`]){
    assert.doesNotMatch(renderArticle(input),/<a\b|<img\b|style="[^"]*evil|src="/);
  }
  renderArticle(String.raw`$\gdef\private{secret}\private$`);
  assert.match(renderArticle(String.raw`$\private$`),/math-error/);
  assert.match(renderMathText(String.raw`未闭合 \[x`),/未闭合 \\\[x/);
});

test('publication readback accepts math-enabled and prior releases and rejects a changed formula',()=>{
  const source='# 标题\n\n$x_1$\n\n[研究方法](https://metho.scholar.example/)';
  for(const render of [legacyRender,renderArticle])assert(articleBodyOnPage('<div class="article-body">'+render(source.replace(/^# [^\n]+\n+/,''))+'</div>',source));
  assert(!articleBodyOnPage('<div class="article-body">'+renderArticle('$x_2$')+'</div>','$x_1$'));
  const parts=renderArticleParts('$a$\n\n信息由 [Scholay 学术一站式平台](https://www.scholay.com/t/M4ZZW8KRE5) 整理并发表，如有侵权请反馈下架。');
  assert.match(parts.body,/katex/);assert.match(parts.endnotes,/<h2>参考文献<\/h2>/);
  assert.match(parts.endnotes,/<a href="https:\/\/www\.scholay\.com\/t\/M4ZZW8KRE5"[^>]*>Scholay 学术一站式平台<\/a> 整理并发表，如有侵权请反馈下架。/);
});

test('self-hosted assets contain only CSS, WOFF2 and license, with a small transferred CSS budget',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'math-assets-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const files=await writeMathAssets(dir),css=await readFile(join(dir,mathAssetBase,'math.css'),'utf8');
  assert(files.every(x=>/\.(?:css|woff2|txt)$/.test(x)));assert(files.some(x=>x.endsWith('LICENSE.txt')));
  assert.doesNotMatch(css,/url\([^)]*\.(?:woff|ttf)\)|https?:\/\//);assert(gzipSync(css).length<6000);
  for(const [,path] of css.matchAll(/url\(([^)]+)\)/g))await access(join(dir,mathAssetBase,path));
});

test('ten actual site profiles publish formulas without client math JS or homepage regressions',async t=>{
  const root=await mkdtemp(join(tmpdir(),'all-sites-math-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await cp('sites',join(root,'sites'),{recursive:true});await mkdir(join(root,'web/themes'),{recursive:true});
  await cp('web/themes/content.css',join(root,'web/themes/content.css'));
  await cp('web/themes/academic/public',join(root,'web/themes/academic/public'),{recursive:true});
  for(const site of profiles){
    if(['personal','piggytuck'].includes(site.id)){
      const theme=site.id==='personal'?'personal':'portfolio',folder=join(root,'theme-homepages',theme);
      await mkdir(join(folder,'public'),{recursive:true});
      const home='<html><body>Original '+site.id+' homepage</body></html>';
      await writeFile(join(folder,'public/index.html'),home);
      const files={'index.html':byteHash(home)};
      if(site.id==='personal')for(const slug of ['rimes','scholay-today','scholay','skills','scholay-wiki']){
        const path='projects/'+slug+'/index.html';await mkdir(join(folder,'public/projects',slug),{recursive:true});await writeFile(join(folder,'public',path),home);files[path]=byteHash(home);
      }
      await writeFile(join(folder,'manifest.json'),JSON.stringify({version:1,siteId:site.id,origin:site.origin,themeId:theme,files}));
    }
    const snapshot={news:[{id:'math',title:'公式示例',category:site.columns[1],date:'2026-10-19',markdown:'# 公式示例\n\n行内 $E=mc^2$。\n\n$$\n\\frac{1}{2}\n$$',author:'测试',summary:'示例'}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:math':'/news/math/'}};
    if(site.id==='scholay-today'){
      snapshot.data.year.push({id:'year',title:'会议',category:'学术会议',tags:[],start:'2026-10-19',dateBasis:'官网日期',summary:'$x$',body:'$y$',sourceName:'主办方',sourceUrl:'https://example.org/event',provenance:'已核验官网'});
      snapshot.data.history.push({id:'history',title:'历史',dateKey:'10-19',year:2000,domain:'计算史',eventType:'论文发表',importance:'A',factSummary:'$x$',historicalSignificance:'$y$',sources:[{label:'论文',url:'https://example.org/paper'}]});
      snapshot.openSource.items.push({title:'工具',date:'2026-10-19',category:'文献与写作',summary:'简介',value:'$x$',url:'https://example.org/project',status:'公开收录'});
    }
    const input=JSON.stringify(snapshot),target=join(root,'out',site.id);
    const manifest=await buildSiteRelease({site,source:root,target,job:{id:'math-'+site.id,snapshot,snapshot_hash:'fixture'}});
    const html=await readFile(join(target,'news/math/index.html'),'utf8');
    assert.match(html,/class="katex"/,site.id);assert.match(html,/href="\/assets\/math\/katex-[^"]+\/math.css"/);
    assert.doesNotMatch(html,/<script[^>]+(?:katex|mathjax)|cdn\.jsdelivr/);
    assert.equal(JSON.stringify(snapshot),input);assert(manifest.hashes[mathAssetBase.slice(1)+'/math.css']);
    const home=await readFile(join(target,'index.html'),'utf8');assert.doesNotMatch(home,/href="[^"]*math.css/);
  }
});

test('calendar math is regenerated from source, details stay lazy and plain fields remain intact',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'calendar-math-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const data={year:[{id:'one',summary:'行内 $x$',body:String.raw`\[\frac{a}{b}\]`,mathHtml:{summary:'<script>bad()</script>'}}],history:[{id:'old',factSummary:'$y$',historicalSignificance:String.raw`\(z^2\)`,mathHtml:{factSummary:'<img onerror=bad()>'}}]};
  const original=JSON.stringify(data),manifest=await writeCalendarData(dir,data),read=async p=>JSON.parse(await readFile(join(dir,p)));
  const year=await read(manifest.year),detail=await read(year[0].detailUrl),history=await read(manifest.history);
  assert.match(year[0].mathHtml.summary,/katex/);assert.equal(year[0].mathHtml.body,undefined);
  assert.match(detail.mathHtml.body,/katex-display/);assert.equal(detail.body,data.year[0].body);
  assert.match(history[0].mathHtml.historicalSignificance,/katex/);assert.doesNotMatch(JSON.stringify([year,detail,history]),/<script|onerror/);
  assert.equal(JSON.stringify(data),original);
});

test('public readback uses the KaTeX already available in the independent desktop runtime',async()=>{
  const website=JSON.parse(await readFile('package.json')),desktop=JSON.parse(await readFile('desktop/runtime/package.json'));
  assert.equal(website.dependencies.katex,desktop.dependencies.katex);
  assert.match(await readFile('web/engine/tex-plugin.mjs','utf8'),/The MIT License/);
});
