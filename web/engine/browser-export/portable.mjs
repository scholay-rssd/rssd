import {fullArticle,embedImages} from './pagination.mjs';
import {articleStyles} from './article-style.mjs';
import {clipboardHtml} from './raster.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function measureFrame(){
 const frame=document.createElement('iframe');frame.className='rssd-export-measure';frame.title='';frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;document.body.append(frame);return frame;
}
export async function portableArticle(model,{embed=false,signal}={}){
 const frame=measureFrame();
 try{
  const doc=frame.contentDocument;doc.open();doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');doc.close();
  const style=doc.createElement('style');style.textContent=articleStyles(model.templates.wechat);doc.head.append(style);
  const article=doc.createElement('article');article.className='rssd-article';article.append(fullArticle(doc,model));doc.body.append(article);
  if(embed)await embedImages(article,{signal});
  await doc.fonts.ready;signal?.throwIfAborted();
  const plain=article.innerText,html=clipboardHtml(article,{originalImages:!embed});
  return {plain,html,document:`<!doctype html><html lang="${esc(model.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(model.title)}</title><style>html{color-scheme:light}body{margin:0;padding:24px 18px;background:${esc(model.templates.wechat.paper)}}body>article{margin:0 auto!important;max-width:680px!important}img{max-width:100%;height:auto}a{overflow-wrap:anywhere}</style></head><body>${html}</body></html>`};
 }finally{frame.remove();}
}

// Same rich HTML / plain text pairing and selection fallback as the installed
// desktop's copyRichHtml. Promise-backed ClipboardItem preserves Safari's
// user activation while the public article is being loaded.
export async function copyArticle(prepared){
 if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){
  try{
   await navigator.clipboard.write([new ClipboardItem({'text/html':prepared.then(x=>new Blob([x.html],{type:'text/html'})),'text/plain':prepared.then(x=>new Blob([x.plain],{type:'text/plain'}))})]);return;
  }catch{/* Keep the native selection fallback used by the desktop client. */}
 }
 const {html}=await prepared,selection=window.getSelection(),ranges=selection?Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange()):[],focused=document.activeElement;
 const node=document.createElement('div');node.contentEditable='true';node.style.cssText='position:fixed;left:-10000px;top:0;width:600px';node.innerHTML=html;document.body.append(node);
 try{const range=document.createRange();range.selectNodeContents(node);selection?.removeAllRanges();selection?.addRange(range);if(!document.execCommand('copy'))throw Error('系统剪贴板没有接受图文内容，请重试');}
 finally{node.remove();selection?.removeAllRanges();ranges.forEach(r=>selection?.addRange(r));focused?.focus();}
}
