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
import {makeZip,crc32} from '../web/engine/browser-export/zip.mjs';
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
test('browser ZIP preserves numbered files, exact PNG bytes and standard CRC values',async()=>{
 assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
 const zip=new Uint8Array(await(await makeZip([{name:'0001.png',blob:new Blob(['first'])},{name:'0002.png',blob:new Blob(['second'])}])).arrayBuffer());
 const view=new DataView(zip.buffer),decoder=new TextDecoder();let offset=0;const names=[];
 while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),nameSize=view.getUint16(offset+26,true),name=decoder.decode(zip.slice(offset+30,offset+30+nameSize)),body=zip.slice(offset+30+nameSize,offset+30+nameSize+size);names.push(name);assert.equal(view.getUint32(offset+14,true),crc32(body));assert.equal(decoder.decode(body),names.length===1?'first':'second');offset+=30+nameSize+size;}
 assert.deepEqual(names,['0001.png','0002.png']);assert.equal(view.getUint32(offset,true),0x02014b50);assert.equal(view.getUint32(zip.length-22,true),0x06054b50);
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

test('article sharing is lazy, preserves complete content and exports standalone HTML and PNG ZIP',{skip:!process.env.RSSD_BROWSER_EXECUTABLE,timeout:180000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-share-'));let output;
 const types={'.html':'text/html;charset=utf-8','.json':'application/json','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
 const requests=[];
 const server=createServer(async(req,res)=>{requests.push(req.url);try{
  let path=resolve(output,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(output+sep))throw Error('path');if((await stat(path)).isDirectory())path=join(path,'index.html');res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream'});res.end(await readFile(path));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
 const build=await buildDemoVariant({...DEMO_VARIANTS.find(x=>x.id==='demo-archie'),origin},{output:root});output=build.target;
 const exports=await readdir(join(output,'export'));let exportPath,model;
 for(const entry of exports){const candidate=JSON.parse(await readFile(join(output,'export',entry,'content.json'),'utf8'));if(candidate.html.includes('<img')){exportPath='export/'+entry+'/';model=candidate;break;}}
 assert.ok(model);const route=new URL(model.url).pathname;
 model.html+=Array.from({length:8},(_,i)=>`<h2>第 ${i+1} 节</h2><p>${('中文与 English，保留完整正文和来源。Every paragraph must survive. ').repeat(8)}</p>`).join('');
 model.html+='<table><thead><tr><th>项目</th><th>结果</th></tr></thead><tbody>'+Array.from({length:30},(_,i)=>`<tr><td>row-${i+1}</td><td>result-${i+1}</td></tr>`).join('')+'</tbody></table><pre><code>'+Array.from({length:75},(_,i)=>`line_${i+1} = "完整代码";`).join('\n')+'</code></pre><p>THE FINAL SENTENCE</p>';
 await writeFile(join(output,exportPath,'content.json'),JSON.stringify(model));
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
 assert.equal(await page.locator('iframe').count(),0);assert.ok(!requests.some(x=>x.endsWith('content.json')));
 await page.locator('.rssd-share-toggle').click();assert.equal(await page.locator('[data-action=download-pages]').count(),1);assert.equal(await page.locator('#proof').count(),0);
 await page.locator('[data-action=copy-article]').click();await page.waitForFunction(()=>document.querySelector('.rssd-share-status').textContent.includes('已复制'));
 const clipboard=await page.evaluate(async()=>{const item=(await navigator.clipboard.read())[0];return(await item.getType('text/html')).text();});
 assert.doesNotMatch(clipboard,/color\(srgb|light-dark\(|color-mix\(/);
 assert.match(clipboard,/THE FINAL SENTENCE/);assert.match(clipboard,/style=/);assert.match(clipboard,/<img[^>]+src="data:image\/(?:jpeg|png);base64,/);assert.match(clipboard,/line_75/);
 const styles=[...clipboard.matchAll(/style="([^"]*)"/g)].map(match=>match[1]);
 for(const style of styles)assert.doesNotMatch(style,/max-width|color-mix\(|light-dark\(|width:\s*\d{3,}px/);
 assert.ok(styles.some(style=>style.includes('width:100%')));assert.ok(styles.some(style=>style.includes('word-break:break-word')));
 const artifacts=resolve(process.env.RSSD_BROWSER_ARTIFACTS||'.local/article-sharing-20261101/browser');await mkdir(artifacts,{recursive:true});
 await page.screenshot({path:join(artifacts,'share-desktop.png')});
 const [htmlDownload]=await Promise.all([page.waitForEvent('download'),page.locator('[data-action=download-article]').click()]);
 const htmlPath=join(artifacts,'article.html');await htmlDownload.saveAs(htmlPath);const html=await readFile(htmlPath,'utf8');
 assert.match(html,/THE FINAL SENTENCE/);assert.match(html,/src="data:image\//);assert.doesNotMatch(html,/<script|<link[^>]+stylesheet|data-original-src/);
 const offline=await context.newPage();await offline.route('**/*',r=>r.abort());await offline.setContent(html);assert.equal(await offline.locator('img').evaluateAll(imgs=>imgs.every(x=>x.complete&&x.naturalWidth>0)),true);assert.equal(await offline.locator('article').evaluate(x=>getComputedStyle(x).backgroundColor),lightPaper);await offline.setViewportSize({width:390,height:844});assert.ok(await offline.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await offline.close();
 await page.waitForFunction(()=>!document.querySelector('[data-action=download-pages]').disabled);
 // Cancel before rendering starts; a retry must remain usable.
 await page.locator('[data-action=download-pages]').click();await page.locator('[data-action=cancel]').click();await page.waitForFunction(()=>document.querySelector('.rssd-share-status').textContent.includes('已取消'));
 const [zipDownload]=await Promise.all([page.waitForEvent('download',{timeout:120000}),page.locator('[data-action=download-pages]').click()]);const zipPath=join(artifacts,'article.zip');await zipDownload.saveAs(zipPath);
 const zip=await readFile(zipPath);assert.ok(zip.readUInt16LE(zip.length-12)>8);let offset=0,images=0;
 while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),nameSize=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28),body=zip.subarray(offset+30+nameSize+extra,offset+30+nameSize+extra+size);assert.deepEqual([...body.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(zip.readUInt32LE(offset+14),crc32(body));if(images===0)await writeFile(join(artifacts,'first-page.png'),body);images++;offset+=30+nameSize+extra+size;}
 await page.waitForFunction(()=>!document.querySelector('[data-action=download-pages]').disabled);assert.equal(await page.locator('iframe').count(),0);assert.deepEqual(errors,[]);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(artifacts,'share-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.keyboard.press('Escape');assert.equal(await page.locator('.rssd-share-panel').isVisible(),false);
 await page.screenshot({path:join(artifacts,'reading-mobile.png')});
 assert.ok(requests.every(path=>!path.startsWith('/api/')));
});
