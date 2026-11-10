import {articleHeading} from './article-style.mjs';
import {templateStyles} from './styles.mjs';
const tick=()=>new Promise(resolve=>requestAnimationFrame(resolve));
export function fullArticle(doc,model){
 const host=doc.createElement('div');host.className='rssd-body';
 host.innerHTML=articleHeading(model);
 const body=doc.createElement('div');body.innerHTML=model.html;
 // The build emits HTML from the Markdown renderer with raw HTML disabled.
 // Drop active elements defensively even if a public JSON file is replaced.
 for(const el of body.querySelectorAll('script,style,iframe,object,embed,form,input,button,link,meta,base'))el.remove();
 for(const el of body.querySelectorAll('*'))for(const attr of [...el.attributes]){
  if(/^on/i.test(attr.name)||attr.name==='style'||attr.name==='srcdoc')el.removeAttribute(attr.name);
  if(['href','src'].includes(attr.name)){
   try{const url=new URL(attr.value,model.url);if(!['https:','http:'].includes(url.protocol))el.removeAttribute(attr.name);else el.setAttribute(attr.name,url.href);}catch{el.removeAttribute(attr.name);}
  }
 }
 host.append(...body.childNodes);
 const origin=doc.createElement('p');origin.className='rssd-byline';origin.textContent=model.url;host.append(origin);return host;
}
async function imageData(url,signal){
 const response=await fetch(url,{mode:'cors',credentials:'omit',redirect:'error',signal});if(!response.ok)throw Error('配图无法读取：'+url);
 const blob=await response.blob();if(!blob.type.startsWith('image/')||blob.size>30*1024*1024)throw Error('配图格式或尺寸暂不支持：'+url);
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('配图读取失败'));reader.readAsDataURL(blob);});
}
export async function embedImages(host,{signal}={}){
 const cached=new Map();for(const img of host.querySelectorAll('img')){
  signal?.throwIfAborted();const original=img.getAttribute('src');if(!original)throw Error('配图缺少可读取的地址');
  img.dataset.originalSrc=original;if(!cached.has(original))cached.set(original,await imageData(original,signal));img.src=cached.get(original);img.removeAttribute('srcset');img.loading='eager';
  await img.decode();if(!img.naturalWidth||img.naturalWidth*img.naturalHeight>48e6)throw Error('配图像素尺寸过大：'+original);
  img.width=img.naturalWidth;img.height=img.naturalHeight;
 }
}
function textNodes(node){const walker=node.ownerDocument.createTreeWalker(node,NodeFilter.SHOW_TEXT);const nodes=[];let text;while(text=walker.nextNode())nodes.push(text);return nodes;}
function splitAt(node,position){
 const doc=node.ownerDocument,container=doc.createElement('div');container.append(node.cloneNode(true));const root=container.firstChild;
 let remaining=position,point;
 for(const text of textNodes(root)){if(remaining<=text.length){point={text,offset:remaining};break;}remaining-=text.length;}
 if(!point)return null;
 const prefix=doc.createRange();prefix.setStartBefore(root);prefix.setEnd(point.text,point.offset);
 const suffix=doc.createRange();suffix.setStart(point.text,point.offset);suffix.setEndAfter(root);
 const a=doc.createElement('div'),b=doc.createElement('div');a.append(prefix.cloneContents());b.append(suffix.cloneContents());
 // Keep an ordered list's displayed item numbers across page boundaries.
 for(const list of b.querySelectorAll('ol')){
  const original=root.nodeName==='OL'?root:root.querySelector('ol');
  const pointItem=point.text.parentElement?.closest('li');
  if(original&&pointItem&&pointItem.parentElement===original)list.start=(Number(original.getAttribute('start'))||1)+[...original.children].indexOf(pointItem);
 }
 return [a.firstChild,b.firstChild];
}
function boundaries(node){
 if(node.nodeName==='TABLE'){
  const rows=[...node.querySelectorAll('tr')],out=[];
  for(const row of rows){const range=node.ownerDocument.createRange();range.setStart(node,0);range.setEndAfter(row);out.push(range.toString().length);}return out;
 }
 const text=node.textContent||'',out=[];let offset=0;
 // Code points avoid splitting surrogate pairs. Prefer word/grapheme boundaries
 // near the measured page end, without deleting the intervening whitespace.
 for(const char of text){offset+=char.length;out.push(offset);}return out;
}
function fits(body){return body.scrollHeight<=body.clientHeight+1&&body.scrollWidth<=body.clientWidth+1;}
function fragment(node,body){
 const cuts=boundaries(node);let low=0,high=cuts.length-2,best=null;
 while(low<=high){const middle=(low+high)>>>1,split=splitAt(node,cuts[middle]);if(!split?.[0]){high=middle-1;continue;}
  body.append(split[0]);const fit=fits(body);split[0].remove();if(fit){best={index:middle,split};low=middle+1;}else high=middle-1;
 }
 if(!best||!(best.split[0].textContent||'').trim())return null;
 // Avoid an English word break when a nearby whitespace boundary fits.
 const text=node.textContent||'';for(let i=best.index;i>Math.max(0,best.index-40);i--)if(/\s/.test(text[cuts[i]-1])){const split=splitAt(node,cuts[i]);body.append(split[0]);const fit=fits(body);split[0].remove();if(fit){best.split=split;break;}}
 return best.split;
}
export async function paginate(frame,model,{signal,onProgress=()=>{}}={}){
 const doc=frame.contentDocument,t=model.templates.pages;doc.open();doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');doc.close();
 const style=doc.createElement('style');style.textContent=templateStyles(t);doc.head.append(style);
 const original=fullArticle(doc,model);original.style.height='auto';original.style.width='624px';doc.body.append(original);
 await embedImages(original,{signal});await doc.fonts.ready;
 for(const node of [...original.childNodes])if(node.nodeType===3&&!node.textContent.trim())node.remove();
 const expected=original.textContent||'',expectedImages=[...original.querySelectorAll('img')].map(x=>x.dataset.originalSrc).sort();
 const queue=[...original.childNodes].map(n=>n.cloneNode(true));original.remove();
 const pages=[];let page,body;
 function next(){
  if(pages.length>=500)throw Error('文章超过 500 页，请缩小单次导出范围');
  page=doc.createElement('article');page.className='rssd-page';page.dataset.layout=t.layout;
  const header=doc.createElement('header');header.className='rssd-page-header';const brand=doc.createElement('span'),section=doc.createElement('span');brand.textContent=model.site.name;section.textContent=model.sectionName;header.append(brand,section);
  body=doc.createElement('div');body.className='rssd-body';const footer=doc.createElement('footer');footer.className='rssd-page-footer';const source=doc.createElement('span'),number=doc.createElement('span');source.textContent=new URL(model.url).host;number.className='rssd-page-number';footer.append(source,number);page.append(header,body,footer);doc.body.append(page);pages.push(page);
 }
 next();
 while(queue.length){
  signal?.throwIfAborted();const node=queue.shift();body.append(node);
  if(fits(body))continue;node.remove();
  const heading=/^H[1-6]$/.test(node.nodeName);
  if(!heading){const split=fragment(node,body);if(split){body.append(split[0]);queue.unshift(split[1]);next();onProgress(pages.length);await tick();continue;}}
  if(body.childNodes.length){queue.unshift(node);next();onProgress(pages.length);await tick();continue;}
  // An indivisible figure or formula may be larger than the paper. Scale that
  // whole atom; text-bearing paragraphs must have been split above.
  body.append(node);const width=node.scrollWidth||node.getBoundingClientRect?.().width||624,height=node.scrollHeight||node.getBoundingClientRect?.().height||1;
  const scale=Math.min(1,body.clientHeight/height,body.clientWidth/width);
  if(scale<.35)throw Error('存在无法完整排入页面的超大内容块');
  if(node.nodeType!==1)throw Error('内容分页失败');
  const holder=doc.createElement('div');holder.style.position='relative';holder.style.height=Math.ceil(height*scale)+'px';node.replaceWith(holder);holder.append(node);
  node.style.position='absolute';node.style.left='0';node.style.top='0';node.style.margin='0';node.style.transformOrigin='top left';node.style.transform=`scale(${scale})`;node.style.width=width+'px';node.style.maxHeight='none';
  if(queue.length)next();
 }
 if(pages.length>1&&!body.childNodes.length){pages.pop().remove();}
 const actual=pages.map(p=>p.querySelector('.rssd-body').textContent||'').join(''),actualImages=pages.flatMap(p=>[...p.querySelectorAll('.rssd-body img')].map(x=>x.dataset.originalSrc)).sort();
 if(actual!==expected||JSON.stringify(actualImages)!==JSON.stringify(expectedImages))throw Error('完整性检查未通过，未生成缺页成品');
 pages.forEach((p,i)=>p.querySelector('.rssd-page-number').textContent=`${String(i+1).padStart(2,'0')} / ${String(pages.length).padStart(2,'0')}`);
 return {pages,style:style.textContent,expectedText:expected,imageCount:expectedImages.length};
}
