// Local-only derivatives. This entrypoint never opens the publishing client or credentials.
import {readFile,writeFile,mkdir,realpath,stat,rename,rm,access} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {layoutNoteCards} from './note-cards/layout.mjs';
import {prepareNoteMath} from './note-cards/math-runtime.mjs';
const require=createRequire(import.meta.url);
function dependency(name){try{return require(name);}catch{return createRequire(new URL('../runtime/package.json',import.meta.url))(name);}}
const hash=value=>createHash('sha256').update(value).digest('hex');
const dataUrl=(bytes,type='png')=>`data:image/${type};base64,${bytes.toString('base64')}`;
const version=1;
export async function browserPath(){
  const paths=process.platform==='win32'?[
    join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles||'C:/Program Files','Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA||'C:/','Google/Chrome/Application/chrome.exe'),
  ]:process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']:['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/microsoft-edge'];
  paths.push(dependency('playwright-core').chromium.executablePath());
  for(const path of paths)try{await access(path);return path;}catch{}
  throw Error('生成图文笔记需要本机安装 Microsoft Edge 或 Google Chrome。安装后重新预览即可。');
}
function cacheRoot(){if(!process.env.SCHOLAY_APP_DATA)throw Error('缺少当前空间的本地缓存位置');return join(process.env.SCHOLAY_APP_DATA,'note-cards');}
function renderPath(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('预览标识无效');return join(cacheRoot(),id);}
function site(){try{return JSON.parse(process.env.SCHOLAY_SITE_JSON||'{}');}catch{return {};}}
export function approvedMedia(value,origin){try{const url=new URL(value);return url.origin===origin&&url.protocol==='https:'&&/^\/article-media\/[a-f0-9]{64}\.(webp|png|jpg)$/.test(url.pathname)&&!url.search&&!url.username&&!url.password;}catch{return false;}}
export async function renderCards(params){
  if(typeof params.html!=='string'||Buffer.byteLength(params.html)>24*1024*1024)throw Error('正文过大，暂不能生成图文笔记');
  const breaks={};for(const [id,value] of Object.entries(params.breaks||{})){if(!/^b\d+(?:-\d+)?$/.test(id)||!['page','flow'].includes(value))throw Error('分页设置无效');breaks[id]=value;}
  const identity=site(),origin=typeof identity.origin==='string'?new URL(identity.origin).origin:'';
  const id=randomUUID(),folder=renderPath(id),temporary=folder+'.partial';
  const browser=await dependency('playwright-core').chromium.launch({executablePath:await browserPath(),headless:true,timeout:20000});
  // Close the browser ourselves before the native process timeout can expire.
  const timer=setTimeout(()=>void browser.close(),100000);timer.unref();
  try{
    const context=await browser.newContext({viewport:{width:1080,height:1440},deviceScaleFactor:1,serviceWorkers:'block',locale:'zh-CN'});
    await context.route('**/*',route=>route.request().method()==='GET'&&route.request().resourceType()==='image'&&approvedMedia(route.request().url(),origin)?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(15000);
    await page.setContent('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: https:; font-src data:"></head><body></body></html>');
    await prepareNoteMath(page);
    const result=await page.evaluate(layoutNoteCards,{html:params.html,breaks,brand:String(identity.name||'today'),allowedOrigin:origin});
    await mkdir(temporary,{recursive:true});
    const pages=[];const sharp=dependency('sharp');
    for(const [index,description] of result.pages.entries()){
      const file=String(index+1).padStart(2,'0')+'.png';
      const bytes=await page.locator('.card').nth(index).screenshot({type:'png',animations:'disabled',timeout:15000});
      const thumbnail=await sharp(bytes).resize({width:216}).webp({quality:78}).toBuffer();
      await writeFile(join(temporary,file),bytes,{flag:'wx'});
      pages.push({...description,file,sha256:hash(bytes),thumbnail:dataUrl(thumbnail,'webp')});
    }
    const manifest={version,id,sourceHash:hash(params.html),createdAt:new Date().toISOString(),articleId:String(params.articleId||'').slice(0,160),width:1080,height:1440,breaks,pages,blocks:result.blocks,warnings:result.warnings,formulaCount:result.formulaCount};
    await writeFile(join(temporary,'manifest.json'),JSON.stringify(manifest),{flag:'wx'});await rename(temporary,folder);
    return manifest;
  }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
  finally{clearTimeout(timer);await browser.close();}
}
async function manifest(id){const result=JSON.parse(await readFile(join(renderPath(id),'manifest.json'),'utf8'));if(result.id!==id||result.version!==version)throw Error('预览已失效，请重新生成');return result;}
async function pageBytes(id,index,info){const item=info.pages[index];if(!Number.isInteger(index)||!item||!/^\d{2}\.png$/.test(item.file))throw Error('页码无效');const bytes=await readFile(join(renderPath(id),item.file));if(hash(bytes)!==item.sha256)throw Error('本地预览文件已变化，请重新生成');return bytes;}
export async function readPage({id,index}){return {image:dataUrl(await pageBytes(id,index,await manifest(id))) };}
function inside(base,child){const diff=relative(base,child);return !diff||!diff.startsWith('..')&&!isAbsolute(diff);}
export async function exportCards({id,sourceHash,format,platform,directory,manuscriptRoot}){
  if(!['png','jpeg'].includes(format)||!['xiaohongshu','douyin'].includes(platform))throw Error('导出设置无效');
  const info=await manifest(id);if(info.sourceHash!==sourceHash)throw Error('正文已变化，请先重新生成预览');
  const base=await realpath(directory);if(!(await stat(base)).isDirectory())throw Error('导出位置不是文件夹');
  if(manuscriptRoot){const root=await realpath(manuscriptRoot);if(inside(root,base))throw Error('请选择稿件工作目录之外的位置，避免在原稿中写入导出文件');}
  const target=join(base,`图文笔记-${platform==='douyin'?'抖音':'小红书'}-${new Date().toISOString().replace(/[:.]/g,'-')}-${id.slice(0,8)}`);
  await mkdir(target);const sharp=dependency('sharp'),files=[];
  try{
    for(let index=0;index<info.pages.length;index++){
      const original=await pageBytes(id,index,info),bytes=format==='png'?original:await sharp(original).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
      const file=String(index+1).padStart(2,'0')+(format==='png'?'.png':'.jpg');await writeFile(join(target,file),bytes,{flag:'wx'});files.push({file,sha256:hash(bytes)});
    }
    await writeFile(join(target,'导出信息.json'),JSON.stringify({version,sourceHash,articleId:info.articleId,width:1080,height:1440,platform,format,breaks:info.breaks,warnings:info.warnings,files},null,2),{flag:'wx'});
    return {directory:target,count:files.length};
  }catch(error){await rm(target,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>26*1024*1024)throw Error('请求过大');}
    const {method,params}=JSON.parse(input),operations={render:renderCards,page:readPage,export:exportCards};
    if(!Object.hasOwn(operations,method))throw Error('Unknown note-card operation');
    process.stdout.write(JSON.stringify(await operations[method](params)));
  }catch(error){process.stderr.write(error.message||String(error));process.exitCode=1;}
}
