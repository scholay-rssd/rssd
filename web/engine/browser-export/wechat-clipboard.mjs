// The public editor keeps inline pixel widths and drops max-width, so a
// measured desktop article overflows a phone. Remote WebP is also dropped.
// Clipboard HTML is one phone-scale article: category colour and heading
// marks stay, container widths do not, and each picture travels as JPEG/PNG.
const SANS='-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif';
const SERIF='"Songti SC","STSong","Noto Serif CJK SC",Georgia,"Times New Roman",serif';
const MONO='Menlo,Consolas,"Courier New",monospace';
const hex=(value,fallback)=>/^#[0-9a-fA-F]{6}$/.test(value||'')?value:fallback;

function palette(template={}){
 const ink=hex(template.ink,'#23352f'),accent=hex(template.accent,'#35695f'),muted=hex(template.muted,'#637169'),paper=hex(template.paper,'#fcfdfb');
 const title=template.titleFamily==='serif'||template.family==='serif'?SERIF:SANS,body=template.family==='serif'?SERIF:SANS;
 return {ink,accent,muted,paper,title,body,heading:template.heading||'underline'};
}
function mark(accent,heading){
 return {underline:`padding-bottom:6px;border-bottom:1px solid ${accent};`,rule:`padding-top:8px;border-top:2px solid ${accent};`,rail:`padding-left:10px;border-left:3px solid ${accent};`,seal:`padding-left:10px;border-left:2px solid ${accent};`,double:`padding-bottom:6px;border-bottom:1px solid ${accent};`}[heading]||'';
}
export function wechatTagStyle(tag,template={}){
 const {ink,accent,muted,paper,title,body,heading}=palette(template);
 const styles={
  section:`font-family:${body};font-size:16px;line-height:1.75;color:${ink};letter-spacing:.2px;word-break:break-word;text-align:left;`,
  h1:`margin:4px 0 14px;font-family:${title};font-size:22px;line-height:1.45;font-weight:700;color:${ink};`,
  h2:`margin:28px 0 12px;font-family:${title};font-size:18px;line-height:1.55;font-weight:700;color:${ink};${mark(accent,heading)}`,
  h3:`margin:22px 0 10px;font-size:16px;line-height:1.6;font-weight:700;color:${ink};`,
  p:'margin:0 0 16px;line-height:1.75;word-break:break-word;',
  strong:`font-weight:700;color:${ink};`,em:'font-style:italic;',
  a:`color:${accent};word-break:break-all;text-decoration:underline;`,
  img:'display:block;width:100%;height:auto;margin:16px 0;',
  blockquote:`margin:16px 0;padding:10px 12px;border-left:3px solid ${accent};color:${muted};font-size:15px;line-height:1.75;`,
  ul:'margin:12px 0 16px;padding-left:1.3em;',ol:'margin:12px 0 16px;padding-left:1.3em;',
  li:'margin:6px 0;line-height:1.75;word-break:break-word;',
  pre:`margin:16px 0;padding:12px;background:${paper};color:${ink};font-family:${MONO};font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-all;`,
  code:`font-family:${MONO};font-size:13px;color:${accent};`,
  table:'width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;margin:16px 0;',
  th:`padding:8px 6px;border:1px solid ${accent};word-break:break-all;text-align:left;font-weight:700;color:${ink};`,
  td:`padding:8px 6px;border:1px solid ${accent};word-break:break-all;text-align:left;vertical-align:top;`,
  figure:'margin:16px 0;',
  figcaption:`margin:0 0 16px;font-size:12px;line-height:1.6;color:${muted};text-align:center;`,
  hr:`border:0;border-top:1px solid ${accent};margin:22px 0;`,
  sup:'font-size:12px;line-height:0;vertical-align:super;',
  kicker:`margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.6;letter-spacing:1px;color:${accent};`,
  byline:`margin:0 0 18px;font-family:${SANS};font-size:12px;line-height:1.6;color:${muted};word-break:break-all;`,
  codeInPre:`font-family:${MONO};font-size:13px;line-height:1.6;color:${ink};background:none;`
 };
 return styles[tag]||'';
}

const DROP=new Set(['script','style','iframe','object','embed','form','input','button','textarea','select','link','meta','base','svg','canvas','video','audio','col','colgroup']);
const UNWRAP=new Set(['div','header','article','dl','nav','aside','span','font','center','picture','hgroup','semantics','mrow','annotation']);

function flatten(root){
 for(const el of [...root.querySelectorAll('.katex-html')])el.remove();
 let changed=true;
 while(changed){
  changed=false;
  for(const el of [...root.querySelectorAll('*')]){
   const tag=el.tagName.toLowerCase();
   if(DROP.has(tag)){el.remove();changed=true;continue;}
   if(tag==='math'){el.replaceWith(el.ownerDocument.createTextNode((el.textContent||'').replace(/\s+/g,' ').trim()));changed=true;continue;}
   if(tag==='dt'||tag==='dd'){const p=el.ownerDocument.createElement('p');p.className=tag==='dt'?'rssd-kicker':'rssd-byline';p.append(...el.childNodes);el.replaceWith(p);changed=true;continue;}
   if(UNWRAP.has(tag)){el.replaceWith(...el.childNodes);changed=true;}
  }
 }
}

export function wechatClipboardHtml(article,template={}){
 const doc=article.ownerDocument,source=article.querySelector('.rssd-body')||article,copy=source.cloneNode(true);
 flatten(copy);
 for(const el of [...copy.querySelectorAll('*')]){
  const tag=el.tagName.toLowerCase(),href=el.getAttribute('href'),src=el.getAttribute('src'),alt=el.getAttribute('alt');
  const kind=el.classList.contains('rssd-kicker')?'kicker':el.classList.contains('rssd-byline')?'byline':tag==='code'&&el.closest('pre')?'codeInPre':tag==='h4'||tag==='h5'||tag==='h6'?'h3':tag;
  const style=wechatTagStyle(kind,template);
  for(const attr of [...el.attributes])el.removeAttribute(attr.name);
  if(style)el.setAttribute('style',style);
  if(tag==='a'&&/^https?:\/\//i.test(href||''))el.setAttribute('href',href);
  if(tag==='img'&&src){el.setAttribute('src',src);if(alt)el.setAttribute('alt',alt);}
 }
 const section=doc.createElement('section');section.setAttribute('style',wechatTagStyle('section',template));section.append(...copy.childNodes);return section.outerHTML;
}

function hasAlpha(ctx,width,height){
 const data=ctx.getImageData(0,0,width,height).data;
 for(let i=3;i<data.length;i+=4)if(data[i]<250)return true;
 return false;
}
function paint(source,max,quality){
 const scale=Math.min(1,max/Math.max(source.width,source.height,1)),width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale));
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,width,height);
 const alpha=hasAlpha(ctx,width,height);
 let url;
 if(alpha&&quality>0.8)url=canvas.toDataURL('image/png');
 else{if(alpha){ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);}url=canvas.toDataURL('image/jpeg',quality);}
 canvas.width=1;canvas.height=1;return url;
}
async function clipboardImage(src,{signal}){
 if(/^data:image\/(png|jpeg);base64,/i.test(src)&&src.length<600000)return src;
 const response=await fetch(src,{mode:'cors',credentials:'omit',redirect:'error',signal});
 if(!response.ok)throw Error('image');
 const blob=await response.blob();
 if(!blob.type.startsWith('image/')||blob.size>15*1024*1024)throw Error('image');
 const bitmap=await createImageBitmap(blob);
 try{let url=paint(bitmap,1080,0.84);if(url.length>600000)url=paint(bitmap,720,0.72);return url;}
 finally{bitmap.close?.();}
}
export async function embedClipboardImages(root,{signal}={}){
 const base=root.ownerDocument.baseURI||location.href;
 for(const img of [...root.querySelectorAll('img')]){
  signal?.throwIfAborted();
  const src=img.getAttribute('src');
  if(!src){img.remove();continue;}
  try{img.setAttribute('src',await clipboardImage(src,{signal}));}
  catch{
   let href='';try{href=new URL(src,base).href;}catch{/* keep empty */}
   if(!/^https?:\/\//i.test(href)){img.remove();continue;}
   img.setAttribute('src',href);
  }
  for(const name of ['srcset','width','height','loading','decoding','crossorigin','sizes'])img.removeAttribute(name);
 }
}
