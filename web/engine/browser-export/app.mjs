import {paginate,fullArticle,embedImages} from './pagination.mjs';
import {templateStyles} from './styles.mjs';
import {rasterPage,clipboardHtml} from './raster.mjs';
import {makeZip} from './zip.mjs';
const $=id=>document.getElementById(id),button=$('download'),status=$('status'),proof=$('proof');
let model,result,index=0,mode='pages',wechat=null,busy=false,controller,previewUrl;
const frame=document.createElement('iframe');frame.className='export-measure';frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;document.body.append(frame);
const en=()=>model?.locale==='en',say=(zh,english)=>en()?english:zh;
function fitWechat(){const iframe=proof.querySelector('iframe');if(!iframe?.dataset.height)return;const scale=Math.min(1,proof.clientWidth/600);iframe.style.transform=`scale(${scale})`;proof.style.height=(Number(iframe.dataset.height)*scale)+'px';}
new ResizeObserver(fitWechat).observe(proof);
function message(text,error=false){status.textContent=text;status.dataset.error=String(error);}
function actions(){
 button.disabled=busy||!result;button.textContent=mode==='pages'?say('下载分页 ZIP','Download page ZIP'):say('复制公众号排版','Copy WeChat layout');
 $('previous').disabled=busy||mode!=='pages'||index===0;$('next').disabled=busy||mode!=='pages'||!result||index===result.pages.length-1;
 $('page-number').textContent=mode==='pages'&&result?`${index+1} / ${result.pages.length}`:say('完整正文','Complete article');
 $('description').textContent=mode==='pages'?say('完整正文与配图，按页编号。','The complete article, in numbered pages.'):say('保留正文、配图和来源，可粘贴至公众号编辑器。','Complete text, images and sources, ready for the WeChat editor.');
 for(const tab of document.querySelectorAll('[data-mode]')){tab.disabled=busy;tab.setAttribute('aria-pressed',String(tab.dataset.mode===mode));}
}
async function preview(){
 if(!result)return;busy=true;actions();
 try{
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}proof.replaceChildren();
  if(mode==='pages'){
   const blob=await rasterPage(result.pages[index],result.style,{scale:1});previewUrl=URL.createObjectURL(blob);const image=new Image();image.alt=say(`第 ${index+1} 页预览`,`Page ${index+1} preview`);image.src=previewUrl;await image.decode();proof.append(image);
  }else{
   if(!wechat){const doc=frame.contentDocument;wechat=doc.createElement('section');wechat.className='rssd-wechat';wechat.append(fullArticle(doc,model));doc.body.append(wechat);await embedImages(wechat);}
   const iframe=document.createElement('iframe');iframe.title=say('公众号完整排版','Full WeChat layout');iframe.sandbox='allow-same-origin';proof.append(iframe);
   const doc=iframe.contentDocument;doc.open();doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');doc.close();const style=doc.createElement('style');style.textContent=templateStyles(model.templates.wechat);doc.head.append(style);doc.body.append(doc.importNode(wechat,true));
   const height=Math.ceil(wechat.getBoundingClientRect().height);iframe.style.width='600px';iframe.style.height=height+'px';iframe.dataset.height=String(height);fitWechat();
  }
 }catch(error){message(error.message,true);}finally{if(mode==='pages')proof.style.height='auto';busy=false;actions();}
}
function download(blob,name){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function copy(){
 const html=clipboardHtml(wechat),plain=wechat.innerText;
 if(navigator.clipboard?.write&&globalThis.ClipboardItem){try{await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);return;}catch{/* The selected rich-text fallback remains available. */}}
 const selected=document.createElement('div');selected.className='export-clipboard-fallback';selected.contentEditable='true';selected.innerHTML=html;document.body.append(selected);
 const selection=getSelection(),range=document.createRange();range.selectNodeContents(selected);selection.removeAllRanges();selection.addRange(range);
 try{if(!document.execCommand('copy'))throw Error(say('请在预览中选中正文并复制。','Select and copy the complete preview.'));}finally{selection.removeAllRanges();selected.remove();}
}
button.addEventListener('click',async()=>{
 if(busy||!result)return;busy=true;controller=new AbortController();$('cancel').hidden=mode!=='pages';actions();
 try{
  if(mode==='wechat'){await copy();message(say('已复制，可粘贴到公众号编辑器。','Copied. Paste into the WeChat editor.'));}
  else{
   const entries=[];for(let i=0;i<result.pages.length;i++){
    controller.signal.throwIfAborted();message(say(`正在生成第 ${i+1} / ${result.pages.length} 页…`,`Rendering page ${i+1} / ${result.pages.length}…`));
    entries.push({name:String(i+1).padStart(4,'0')+'.png',blob:await rasterPage(result.pages[i],result.style,{signal:controller.signal})});await new Promise(r=>requestAnimationFrame(r));
   }
   controller.signal.throwIfAborted();const zip=await makeZip(entries);controller.signal.throwIfAborted();download(zip,(model.title.slice(0,70).replace(/[\\/:*?"<>|]/g,'-')||'rssd')+'.zip');message(say(`已生成 ${entries.length} 页，下载已开始。`,`Created ${entries.length} pages. Download started.`));
  }
 }catch(error){message(error.name==='AbortError'?say('已取消，可重新生成。','Cancelled. You can start again.'):error.message,error.name!=='AbortError');}
 finally{busy=false;$('cancel').hidden=true;actions();}
});
$('cancel').addEventListener('click',()=>controller?.abort());
$('previous').addEventListener('click',()=>{if(index>0&&!busy){index--;void preview();}});
$('next').addEventListener('click',()=>{if(index<result.pages.length-1&&!busy){index++;void preview();}});
for(const tab of document.querySelectorAll('[data-mode]'))tab.addEventListener('click',()=>{if(busy)return;mode=tab.dataset.mode;message('');void preview();});
try{
 const response=await fetch(new URL('content.json',location.href),{credentials:'omit',redirect:'error'});if(!response.ok)throw Error('文章读取失败');model=await response.json();if(model.version!==1||typeof model.html!=='string')throw Error('文章格式不受支持');
 result=await paginate(frame,model,{onProgress:pages=>message(say(`正在排版，第 ${pages} 页…`,`Laying out page ${pages}…`))});
 message(say(`正文与 ${result.imageCount} 张配图已核对，共 ${result.pages.length} 页。`,`Complete text and ${result.imageCount} images verified across ${result.pages.length} pages.`));await preview();
 document.documentElement.dataset.exportReady='true';
}catch(error){message(error.message,true);button.disabled=true;button.textContent=say('暂时无法生成','Unable to export');document.documentElement.dataset.exportError='true';}
