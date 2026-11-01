import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,stat,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve,extname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {profiles} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import {exportDesigns,exportTemplate} from '../web/themes/export/registry.mjs';
import {makeZip,crc32} from '../web/engine/browser-export/zip.mjs';
import {buildDemoVariant} from '../scripts/build-demo.mjs';
import {DEMO_VARIANTS} from '../web/demo/variants.mjs';

test('each configured and migrated site section owns explicitly registered page and WeChat templates',()=>{
 const migratedSites=new Set(['piggytuck','lingxi','personal','pets']),migratedSections=['archive','calendar','history','open-source'];
 const ids=new Set(),catalog=new Set();for(const site of profiles){
  const sections=new Map(sectionsForSite(site).map(section=>[section.id,section]));
  if(migratedSites.has(site.id))for(const id of migratedSections)if(!sections.has(id))sections.set(id,{id,name:id});
  for(const section of sections.values()){
  assert.ok(exportDesigns[site.id]?.sections[section.id],site.id+':'+section.id);
  catalog.add(site.id+':'+section.id);
  for(const format of ['pages','wechat']){const t=exportTemplate({siteId:site.id,workspaceId:site.spaceId,sectionId:section.id,sectionName:section.name,format});assert.ok(!ids.has(t.id));ids.add(t.id);}
  }
 }
 const registered=Object.entries(exportDesigns).flatMap(([siteId,design])=>Object.keys(design.sections).map(sectionId=>siteId+':'+sectionId));
 assert.deepEqual(new Set(registered),catalog);assert.equal(catalog.size,60);assert.equal(ids.size,120);
 for(const siteId of migratedSites)assert.equal(new Set(migratedSections.map(id=>exportDesigns[siteId].sections[id][0])).size,4);
 assert.equal(exportTemplate({siteId:'scholay-today',workspaceId:'academic',sectionId:'briefings',format:'pages'}).layout,'dispatch');
});
test('browser ZIP preserves numbered files, exact PNG bytes and standard CRC values',async()=>{
 assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
 const zip=new Uint8Array(await(await makeZip([{name:'0001.png',blob:new Blob(['first'])},{name:'0002.png',blob:new Blob(['second'])}])).arrayBuffer());
 const view=new DataView(zip.buffer),decoder=new TextDecoder();let offset=0;const names=[];
 while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),nameSize=view.getUint16(offset+26,true),name=decoder.decode(zip.slice(offset+30,offset+30+nameSize)),body=zip.slice(offset+30+nameSize,offset+30+nameSize+size);names.push(name);assert.equal(view.getUint32(offset+14,true),crc32(body));assert.equal(decoder.decode(body),names.length===1?'first':'second');offset+=30+nameSize+size;}
 assert.deepEqual(names,['0001.png','0002.png']);assert.equal(view.getUint32(offset,true),0x02014b50);assert.equal(view.getUint32(zip.length-22,true),0x06054b50);
});

test('real browser preserves long mixed content, renders PNG pages, downloads ZIP and copies rich text',{skip:!process.env.RSSD_BROWSER_EXECUTABLE,timeout:180000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-export-'));let output;
 const types={'.html':'text/html;charset=utf-8','.json':'application/json','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
 const requests=[];
 const server=createServer(async(req,res)=>{requests.push({method:req.method,path:req.url});try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let path=resolve(output,'.'+pathname);if(!path.startsWith(output+sep))throw Error('path');if((await stat(path)).isDirectory())path=join(path,'index.html');const bytes=await readFile(path);res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
 const build=await buildDemoVariant({...DEMO_VARIANTS.find(x=>x.id==='demo-archie'),origin},{output:root});output=build.target;
 const baseRecords=JSON.parse(await readFile(join(output,'published-content.json'),'utf8')).records;
 const englishRecords=JSON.parse(await readFile(join(output,'en/published-content.json'),'utf8')).records;
 assert.equal(build.manifest.browserExports.articles,baseRecords.length+englishRecords.length);
 const exports=await readdir(join(output,'export'));let route,model;
 for(const entry of exports){const candidate=JSON.parse(await readFile(join(output,'export',entry,'content.json'),'utf8'));if(candidate.html.includes('<img')){route='/export/'+entry+'/';model=candidate;break;}}
 assert.ok(route);model.title='分页验证 · Complete article';model.templates.pages=exportTemplate({siteId:'metho',workspaceId:'metho',sectionId:'methods',sectionName:'方法百科',format:'pages'});model.templates.wechat={...model.templates.pages,format:'wechat',paper:'#ffffff'};
 model.html+=Array.from({length:18},(_,i)=>`<h2>第 ${i+1} 节 · Research notes</h2><p>${('中文与 English 混排，保留完整正文。A reproducible result includes every paragraph and every source. ').repeat(5)}</p>`).join('');
 model.html+='<h2>完整表格</h2><table><thead><tr><th>项目</th><th>结果</th></tr></thead><tbody>'+Array.from({length:30},(_,i)=>`<tr><td>row-${i+1}</td><td>result-${i+1} 完整保留</td></tr>`).join('')+'</tbody></table>';
 model.html+='<h2>完整代码</h2><pre><code>'+Array.from({length:75},(_,i)=>`line_${i+1} = "保留代码与标点";`).join('\n')+'</code></pre><p>THE FINAL SENTENCE · 最后一句必须出现。</p>';
 await writeFile(join(output,route,'content.json'),JSON.stringify(model));
 const require=createRequire(new URL('../desktop/runtime/package.json',import.meta.url)),{chromium}=require('playwright-core');
 const browser=await chromium.launch({executablePath:process.env.RSSD_BROWSER_EXECUTABLE,headless:true,args:['--disable-gpu']});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+route);
 await page.waitForFunction(()=>document.documentElement.dataset.exportReady||document.documentElement.dataset.exportError,{},{timeout:90000});
 assert.equal(await page.locator('#status').getAttribute('data-error'),'false',await page.locator('#status').textContent());assert.deepEqual(errors,[]);
 const measure=page.frames().find(f=>f!==page.mainFrame());
 const details=await measure.evaluate(()=>({pages:document.querySelectorAll('.rssd-page').length,text:[...document.querySelectorAll('.rssd-page .rssd-body')].map(x=>x.textContent).join(''),overflows:[...document.querySelectorAll('.rssd-page .rssd-body')].filter(x=>x.scrollHeight>x.clientHeight+1).length}));
 assert.ok(details.pages>10);assert.equal(details.overflows,0);assert.match(details.text,/THE FINAL SENTENCE/);for(let i=1;i<=30;i++)assert.equal((details.text.match(new RegExp('row-'+i+'(?![0-9])','g'))||[]).length,1);for(let i=1;i<=75;i++)assert.match(details.text,new RegExp('line_'+i+' ='));
 const artifacts=resolve(process.env.RSSD_BROWSER_ARTIFACTS||'.local/browser-export-qa');await mkdir(artifacts,{recursive:true});await page.screenshot({path:join(artifacts,'pages.png'),fullPage:true});
 const image=await page.locator('#proof img').evaluate(async img=>{const response=await fetch(img.src);return [...new Uint8Array(await response.arrayBuffer())];});assert.deepEqual(image.slice(0,8),[137,80,78,71,13,10,26,10]);
 // A valid PNG can still silently omit its embedded images in WebKit.
 const sample=await measure.evaluate(()=>{
  const paper=document.querySelector('.rssd-page'),img=paper.querySelector('img'),box=img.getBoundingClientRect(),origin=paper.getBoundingClientRect();
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  const context=canvas.getContext('2d');context.drawImage(img,0,0);
  return {x:box.left-origin.left+box.width/2,y:box.top-origin.top+box.height/2,rgba:[...context.getImageData(Math.floor(img.naturalWidth/2),Math.floor(img.naturalHeight/2),1,1).data]};
 });
 const painted=await page.locator('#proof img').evaluate((img,sample)=>{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const context=canvas.getContext('2d');context.drawImage(img,0,0);return [...context.getImageData(Math.floor(sample.x),Math.floor(sample.y),1,1).data];},sample);
 assert.equal(sample.rgba[3],255);assert.ok(sample.rgba.every((value,index)=>Math.abs(value-painted[index])<=5),'Export must paint the source image pixels, not an empty image box');
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);const path=join(artifacts,'complete.zip');await download.saveAs(path);const zipped=await readFile(path);assert.equal(zipped.readUInt16LE(zipped.length-12),details.pages);
 await page.locator('[data-mode="wechat"]').click();await page.waitForFunction(()=>!document.querySelector('#download').disabled);await page.locator('#download').click();await page.waitForFunction(()=>!document.querySelector('#download').disabled&&document.querySelector('#status').textContent.includes('已复制'));
 const clipboard=await page.evaluate(async()=>{const item=(await navigator.clipboard.read())[0];return (await item.getType('text/html')).text();});assert.match(clipboard,/THE FINAL SENTENCE/);assert.match(clipboard,/style=/);assert.match(clipboard,/<img/);
 await page.screenshot({path:join(artifacts,'wechat.png'),fullPage:false});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(artifacts,'mobile.png'),fullPage:false});
 assert.ok(requests.every(r=>r.method==='GET'));assert.ok(requests.every(r=>!r.path.startsWith('/api/')));
});
