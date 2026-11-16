import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {exportTemplate} from '../web/themes/export/registry.mjs';

// The page engine with a host stylesheet (the Obsidian plug-in's AI card styles). Needs a Chromium:
// RSSD_BROWSER_EXECUTABLE, as for rssd-browser-export.test.mjs.
test('an extra stylesheet is measured and drawn with the pages, and nothing is lost',{skip:!process.env.RSSD_BROWSER_EXECUTABLE,timeout:30000},async t=>{
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
 const extra='.rssd-page .rssd-body p{font-size:44px;line-height:1.7}';
 const result=await page.evaluate(async({template,extra})=>{
  const {paginate}=await import('./pagination.mjs');
  const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:1200px;height:1600px';document.body.append(frame);
  const model={version:1,site:{id:'metho',name:'Metho',origin:'https://example.test'},sectionName:'统计',title:'样式',locale:'zh-CN',url:'https://example.test/a',
   date:'',author:'',html:Array.from({length:6},(_,i)=>'<p>段落 '+(i+1)+'：'+'完整保留每一个字。'.repeat(12)+'</p>').join(''),templates:{pages:template}};
  const plain=await paginate(frame,model,{pause:()=>Promise.resolve()});
  const plainCount=plain.pages.length,plainSize=getComputedStyle(plain.pages[0].querySelector('.rssd-body p')).fontSize;
  const styled=await paginate(frame,model,{pause:()=>Promise.resolve(),extraStyle:extra});
  return {plainCount,plainSize,count:styled.pages.length,size:getComputedStyle(styled.pages[0].querySelector('.rssd-body p')).fontSize,style:styled.style,text:styled.pages.map(p=>p.querySelector('.rssd-body').textContent).join('')};
 },{template,extra});
 assert.equal(result.size,'44px','the extra stylesheet applies while measuring');assert.notEqual(result.plainSize,'44px');
 assert.ok(result.count>result.plainCount,'larger type gives more pages, not clipped ones: '+result.plainCount+' → '+result.count);
 assert.ok(result.style.endsWith('\n'+extra),'the drawn style carries the extra stylesheet after the template\'s own');
 for(let i=1;i<=6;i++)assert.match(result.text,new RegExp('段落 '+i+'：'));
});
