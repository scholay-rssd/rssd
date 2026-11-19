import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,stat,mkdir} from 'node:fs/promises';
import {readFileSync as requireRead} from 'node:fs';
import {createServer} from 'node:http';
import {join,resolve,extname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {profiles} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import {exportDesigns,exportTemplate} from '../web/themes/export/registry.mjs';
import {wechatTagStyle} from '../web/engine/browser-export/wechat-clipboard.mjs';
import {buildDemoVariant} from '../scripts/build-demo.mjs';
import {DEMO_VARIANTS} from '../web/demo/variants.mjs';

test('each configured and migrated site section owns explicitly registered page and WeChat templates',()=>{
 const migratedSites=new Set(['piggytuck','xsime','personal','pets']),migratedSections=['archive','calendar','history','open-source'];
 const ids=new Set(),catalog=new Set();for(const site of profiles){
  const sections=new Map(sectionsForSite(site).map(section=>[section.id,section]));
  for(const id of migratedSections)if(!sections.has(id))sections.set(id,{id,name:id});
  const org=JSON.parse(requireRead(`sites/organization/${site.id}.json`));
  for(const section of org.sections)if(!section.id.startsWith('column-'))sections.set(section.id,section);
  for(const section of sections.values()){
  assert.ok(exportDesigns[site.id]?.sections[section.id],site.id+':'+section.id);
  catalog.add(site.id+':'+section.id);
  for(const format of ['pages','wechat']){const t=exportTemplate({siteId:site.id,workspaceId:site.spaceId,sectionId:section.id,sectionName:section.name,format});assert.ok(!ids.has(t.id));ids.add(t.id);}
  }
 }
 const registered=Object.entries(exportDesigns).flatMap(([siteId,design])=>Object.keys(design.sections).map(sectionId=>siteId+':'+sectionId));
 assert.deepEqual(new Set(registered),catalog);assert.equal(catalog.size,89);assert.equal(ids.size,178);
 for(const siteId of migratedSites)assert.equal(new Set(migratedSections.map(id=>exportDesigns[siteId].sections[id][0])).size,4);
 assert.equal(exportTemplate({siteId:'scholay-today',workspaceId:'academic',sectionId:'briefings',format:'pages'}).layout,'dispatch');
});
test('WeChat clipboard styles keep category colour and stay inside a phone column',()=>{
 const tags=['section','h1','h2','h3','p','img','pre','table','td','a','blockquote','li'];
 for(const siteId of ['metho','scholay-today','piggytuck','xsiching']){
  const sectionId=Object.keys(exportDesigns[siteId].sections)[0];
  const template=exportTemplate({siteId,workspaceId:siteId,sectionId,format:'wechat'});
  assert.equal(template.titleSize>30||template.width>=720,true);
  for(const tag of tags){
   assert.doesNotMatch(wechatTagStyle(tag,template),/max-width|color-mix\(|light-dark\(|width:\s*\d{3,}px/);
  }
  assert.match(wechatTagStyle('img',template),/width:100%;height:auto/);
  assert.match(wechatTagStyle('section',template),/word-break:break-word/);
  assert.match(wechatTagStyle('pre',template),/word-break:break-all/);
  assert.match(wechatTagStyle('h1',template),/font-size:22px/);
  assert.match(wechatTagStyle('a',template)+wechatTagStyle('blockquote',template),new RegExp(template.accent.replace('#','#')));
 }
});
test('native MathML paints in live articles, portable articles and page exports',{skip:!process.env.RSSD_BROWSER_EXECUTABLE,timeout:30000},async t=>{
 const {articleStyles}=await import('../web/engine/browser-export/article-style.mjs');
 const {templateStyles}=await import('../web/engine/browser-export/styles.mjs');
 const {renderMathText,mathAssetBase}=await import('../web/engine/article-math.mjs');
 const {writeMathAssets}=await import('../web/engine/math-assets.mjs');
 const sharp=(await import('sharp')).default;
 const root=await mkdtemp(join(tmpdir(),'rssd-math-visible-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeMathAssets(root);const mathCss=await readFile(join(root,mathAssetBase.slice(1),'math.css'),'utf8');
 const require=createRequire(new URL('../desktop/runtime/package.json',import.meta.url)),{chromium}=require('playwright-core');
 const browser=await chromium.launch({executablePath:process.env.RSSD_BROWSER_EXECUTABLE,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1000,height:900},colorScheme:'light'});
 await page.route('**/*',route=>route.abort());
 const template=exportTemplate({siteId:'metho',sectionId:'statistics',format:'wechat'});
 const formulas=renderMathText(String.raw`\[\hat f(x)=\frac{1}{nh}\sum_{i=1}^{n}K\left(\frac{x-X_i}{h}\right)\]`)+renderMathText(String.raw`\(x^2+1\)`);
 for(const [label,css] of [['live',articleStyles(template,'.rssd-article',{live:true})],['portable',articleStyles(template)],['pages',templateStyles(template)]]){
  await page.setContent(`<style>${mathCss}${css}</style><article class="rssd-article"><div class="rssd-body">${formulas}</div></article>`);
  for(const selector of ['.math-block','.math-inline']){
   const {data,info}=await sharp(await page.locator(selector+' math').screenshot()).removeAlpha().raw().toBuffer({resolveWithObject:true});
   let ink=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]<180&&data[i+1]<180&&data[i+2]<180)ink++;
   assert.ok(ink>20,`${label} ${selector} must paint formula glyphs, got ${ink} dark pixels`);
  }
 }
});

test('page templates size formula pictures apart from ordinary images',async()=>{
 const {templateStyles}=await import('../web/engine/browser-export/styles.mjs');
 const css=templateStyles(exportTemplate({siteId:'metho',sectionId:'statistics',format:'pages'}));
 assert.match(css,/img\.rssd-math\{display:inline-block;[^}]*max-height:none/);
 assert.match(css,/img\.rssd-math-block\{display:block;[^}]*max-height:none/);
});

test('an explicit page break starts a new page without an empty page or a visible rule',{skip:!process.env.RSSD_BROWSER_EXECUTABLE,timeout:30000},async t=>{
 const dir=resolve(import.meta.dirname,'../web/engine/browser-export');
 const server=createServer(async(req,res)=>{try{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><title>pages</title>');return;}
  const path=resolve(dir,'.'+name);if(!path.startsWith(dir+sep)||extname(path)!=='.mjs')throw Error('path');
  res.writeHead(200,{'content-type':'text/javascript'});res.end(await readFile(path));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const require=createRequire(new URL('../desktop/runtime/package.json',import.meta.url)),{chromium}=require('playwright-core');
 const browser=await chromium.launch({executablePath:process.env.RSSD_BROWSER_EXECUTABLE,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const template=exportTemplate({siteId:'metho',sectionId:'statistics',format:'pages'});
 const pages=await page.evaluate(async template=>{
  const {paginate}=await import('./pagination.mjs');
  const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:1200px;height:1600px';document.body.append(frame);
  const cut='<hr class="rssd-page-break">';
  // Two breaks in a row must not leave an empty page between them.
  const model={version:1,site:{id:'metho',name:'Metho',origin:'https://example.test'},sectionName:'统计',title:'分页',locale:'zh-CN',url:'https://example.test/a',
   date:'',author:'',html:'<p>ALPHA</p>'+cut+'<p>BETA</p>'+cut+cut+'<p>GAMMA</p>',templates:{pages:template}};
  const result=await paginate(frame,model,{pause:()=>Promise.resolve()});
  return result.pages.map(p=>({text:p.querySelector('.rssd-body').textContent,rules:p.querySelectorAll('hr').length}));
 },template);
 assert.equal(pages.length,3,JSON.stringify(pages));
 assert.match(pages[0].text,/ALPHA/);assert.match(pages[1].text,/BETA/);assert.match(pages[2].text,/GAMMA/);
 assert.ok(pages.every(p=>p.rules===0),'a page break is never laid out as a rule');
});

test('the share panel offers readers the page address only, and the site ships no distribution tools',{skip:!process.env.RSSD_BROWSER_EXECUTABLE,timeout:60000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-share-'));let output;
 const types={'.html':'text/html;charset=utf-8','.json':'application/json','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
 const requests=[];
 const server=createServer(async(req,res)=>{requests.push(req.url);try{
  let path=resolve(output,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(output+sep))throw Error('path');if((await stat(path)).isDirectory())path=join(path,'index.html');res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream'});res.end(await readFile(path));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
 const build=await buildDemoVariant({...DEMO_VARIANTS.find(x=>x.id==='demo-archie'),origin},{output:root});output=build.target;
 // Only the panel's own script and style reach the site; no article model, page engine or ZIP writer.
 assert.deepEqual((await readdir(join(output,'assets/rssd-export/v1'))).filter(f=>!/^note\./.test(f)).sort(),['share.css','share.mjs']);
 const exports=await readdir(join(output,'export'));assert.ok(exports.length);
 for(const entry of exports)assert.deepEqual((await readdir(join(output,'export',entry))).sort(),['article.css','index.html']);
 const bookmark=await readFile(join(output,'export',exports[0],'index.html'),'utf8'),route=bookmark.match(/url=([^"#]+)#share/)[1];
 const require=createRequire(new URL('../desktop/runtime/package.json',import.meta.url)),{chromium}=require('playwright-core');
 const browser=await chromium.launch({executablePath:process.env.RSSD_BROWSER_EXECUTABLE,headless:true,args:['--disable-gpu']});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+route);
 assert.equal(await page.locator('.rssd-article').count(),1);
 assert.equal(await page.locator('.rssd-article .back').count(),0);assert.equal(await page.locator('.rssd-reading-nav .back').count(),1);
 const lightPaper=await page.locator('.rssd-article').evaluate(x=>getComputedStyle(x).backgroundColor);
 await page.emulateMedia({colorScheme:'dark'});
 assert.notEqual(await page.locator('.rssd-article').evaluate(x=>getComputedStyle(x).backgroundColor),lightPaper);
 await page.locator('.rssd-share-toggle').click();
 assert.equal(await page.locator('.rssd-share-panel').isVisible(),true);
 for(const gone of ['copy-article','download-article','download-pages','cancel'])assert.equal(await page.locator(`[data-action=${gone}]`).count(),0);
 assert.deepEqual(await page.locator('.rssd-share-social a').evaluateAll(links=>links.map(a=>new URL(a.href).searchParams.get('url'))),Array(3).fill(origin+route));
 await page.locator('[data-action=copy-link]').click();await page.waitForFunction(()=>document.querySelector('.rssd-share-status').textContent.includes('已复制'));
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),origin+route);
 const artifacts=resolve(process.env.RSSD_BROWSER_ARTIFACTS||'.local/article-sharing/browser');await mkdir(artifacts,{recursive:true});
 await page.screenshot({path:join(artifacts,'share-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(artifacts,'share-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.keyboard.press('Escape');assert.equal(await page.locator('.rssd-share-panel').isVisible(),false);
 // An old export bookmark still lands on the article with its panel open.
 await page.goto(origin+'/export/'+exports[0]+'/');await page.waitForURL(origin+route+'#share');assert.equal(await page.locator('.rssd-share-panel').isVisible(),true);
 assert.equal(await page.locator('iframe').count(),0);assert.deepEqual(errors,[]);
 assert.ok(requests.every(path=>!path.startsWith('/api/')&&!path.endsWith('content.json')));
});
