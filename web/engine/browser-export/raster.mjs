export async function rasterPage(page,css,{scale=1.5,signal}={}){
 signal?.throwIfAborted();const clone=page.cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/1999/xhtml');
 // WebKit can decode the outer SVG before images inside foreignObject are
 // painted. Keep their layout, then draw the already decoded source images
 // directly onto the final canvas, consistently in every browser.
 const pictures=[...page.querySelectorAll('img')],copies=[...clone.querySelectorAll('img')];
 await Promise.all(pictures.map(image=>image.decode()));
 copies.forEach(image=>{image.style.visibility='hidden';});
 const style=page.ownerDocument.createElement('style');style.textContent=css;clone.prepend(style);
 const xml=new XMLSerializer().serializeToString(clone);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960"><foreignObject x="0" y="0" width="720" height="960">${xml}</foreignObject></svg>`;
 const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();signal?.throwIfAborted();
 const canvas=document.createElement('canvas');canvas.width=Math.round(720*scale);canvas.height=Math.round(960*scale);
 const context=canvas.getContext('2d');if(!context)throw Error('浏览器无法创建图片画布');context.scale(scale,scale);context.drawImage(img,0,0);
 const paper=page.getBoundingClientRect();
 for(const picture of pictures){
  signal?.throwIfAborted();const box=picture.getBoundingClientRect();
  // Export templates use object-fit:contain with centered, borderless images.
  const fit=Math.min(box.width/picture.naturalWidth,box.height/picture.naturalHeight);
  const width=picture.naturalWidth*fit,height=picture.naturalHeight*fit;
  context.drawImage(picture,box.left-paper.left+(box.width-width)/2,box.top-paper.top+(box.height-height)/2,width,height);
 }
 const blob=await new Promise((resolve,reject)=>{try{canvas.toBlob(value=>value?resolve(value):reject(Error('浏览器未能生成图片')),'image/png');}catch(error){reject(error);}});
 canvas.width=1;canvas.height=1;return blob;
}
const properties=['color','background-color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-decoration','white-space','word-break','overflow-wrap','display','margin-top','margin-bottom','margin-left','margin-right','padding-top','padding-bottom','padding-left','padding-right','border-top','border-right','border-bottom','border-left','border-collapse','list-style-type','list-style-position','vertical-align','max-width','width','height','max-height'];
export function clipboardHtml(element){
 const clone=element.cloneNode(true),sources=[element,...element.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
 sources.forEach((source,index)=>{
  const target=copies[index],computed=source.ownerDocument.defaultView.getComputedStyle(source);
  for(const property of properties)target.style.setProperty(property,computed.getPropertyValue(property));
  target.removeAttribute('class');target.removeAttribute('id');
  if(target.nodeName==='IMG'){if(target.dataset.originalSrc)target.src=target.dataset.originalSrc;target.style.maxWidth='100%';target.style.height='auto';target.removeAttribute('width');target.removeAttribute('height');}
  for(const attr of [...target.attributes])if(attr.name.startsWith('data-'))target.removeAttribute(attr.name);
 });
 clone.style.width='100%';clone.style.maxWidth='100%';clone.style.padding='0';return clone.outerHTML;
}
