// Clipboard content is self-contained: no app styles, handlers or local file URLs.
// WeChat keeps only inline styles and the reader's own fonts, so a style is spacing, colour, borders and structure.
type StyleSet=Record<string,string>;
const SANS='-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif';
const SERIF='"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC",Georgia,"Times New Roman",serif';
const MONO='"SF Mono",Menlo,Consolas,"Courier New",monospace';
const classic:StyleSet={
 section:`font-family:${SANS};font-size:15px;line-height:1.9;color:#292e2b;letter-spacing:.5px;word-break:break-word;`,
 h1:'font-size:24px;line-height:1.5;font-weight:700;color:#244536;margin:24px 0 20px;',
 h2:'font-size:19px;line-height:1.6;color:#244536;border-left:4px solid #c66745;padding-left:12px;margin:28px 0 16px;',
 h3:'font-size:17px;line-height:1.7;color:#244536;margin:22px 0 12px;',
 p:'margin:14px 0;line-height:1.9;',strong:'font-weight:700;color:#244536;',
 img:'display:block;max-width:100%;height:auto;margin:20px auto;border-radius:6px;',
 blockquote:'margin:20px 0;padding:12px 16px;border-left:3px solid #b9cbbd;background:#f2f5f1;color:#58635c;font-size:14px;',
 a:'color:#b55d3e;text-decoration:underline;word-break:break-all;',
 ul:'padding-left:24px;margin:16px 0;',ol:'padding-left:24px;margin:16px 0;',li:'margin:8px 0;line-height:1.8;',
 pre:'padding:14px;background:#f4f4f2;border:1px solid #ddddda;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-all;',code:`font-family:${MONO};font-size:13px;background:#f4f4f2;`,
 table:'width:100%;border-collapse:collapse;font-size:13px;margin:20px 0;',td:'border:1px solid #d8dfd9;padding:8px;',th:'border:1px solid #d8dfd9;padding:8px;background:#eef3ee;',hr:'border:0;border-top:1px solid #d8dfd9;margin:28px 0;',
 figcaption:'margin:-8px 0 20px;text-align:center;font-size:12px;color:#7a837d;'
};
// Journal-like: serif headings, numbered sections, ruled tables, one restrained accent.
const academic:StyleSet={
 section:`font-family:${SANS};font-size:15px;line-height:1.95;color:#2b2b2b;letter-spacing:.3px;word-break:break-word;text-align:justify;`,
 h1:`font-family:${SERIF};font-size:23px;line-height:1.5;font-weight:700;color:#1a1a1a;text-align:center;margin:28px 0 22px;padding-bottom:16px;border-bottom:3px double #1a1a1a;`,
 h2:`font-family:${SERIF};font-size:18px;line-height:1.6;font-weight:700;color:#1a1a1a;margin:34px 0 14px;padding-bottom:6px;border-bottom:1px solid #cfcfcf;`,
 h3:`font-family:${SERIF};font-size:16px;line-height:1.7;font-weight:700;color:#3a3a3a;margin:24px 0 10px;`,
 p:'margin:14px 0;line-height:1.95;',strong:'font-weight:700;color:#1a1a1a;',
 img:'display:block;max-width:100%;height:auto;margin:22px auto 10px;',
 blockquote:`font-family:${SERIF};margin:22px 0;padding:2px 0 2px 16px;border-left:2px solid #7a1f2b;color:#555;font-size:14.5px;line-height:1.9;`,
 a:'color:#7a1f2b;text-decoration:none;border-bottom:1px solid #c9a3a8;word-break:break-all;',
 ul:'padding-left:22px;margin:14px 0;',ol:'padding-left:22px;margin:14px 0;',li:'margin:6px 0;line-height:1.9;',
 pre:`padding:14px 16px;background:#f7f6f3;border-top:1px solid #1a1a1a;border-bottom:1px solid #1a1a1a;font-family:${MONO};font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-all;`,code:`font-family:${MONO};font-size:13px;color:#7a1f2b;`,
 table:'width:100%;border-collapse:collapse;font-size:13px;margin:22px 0;border-top:2px solid #1a1a1a;border-bottom:2px solid #1a1a1a;',td:'padding:8px 6px;border-bottom:1px solid #e3e3e3;',th:`font-family:${SERIF};padding:8px 6px;border-bottom:1px solid #1a1a1a;text-align:left;`,
 hr:'border:0;border-top:1px solid #1a1a1a;width:64px;margin:32px auto;',
 figcaption:`font-family:${SERIF};margin:0 0 22px;text-align:center;font-size:12.5px;color:#666;`
};
// Briefing: compact, label-style section heads, built to be scanned.
const briefing:StyleSet={
 section:`font-family:${SANS};font-size:15px;line-height:1.75;color:#1f2933;word-break:break-word;`,
 h1:'font-size:22px;line-height:1.45;font-weight:800;color:#111;margin:20px 0 18px;padding-top:14px;border-top:4px solid #1f4e8c;',
 h2:'display:inline-block;font-size:15px;line-height:1.5;font-weight:700;color:#fff;background:#1f4e8c;padding:3px 12px;border-radius:3px;margin:26px 0 10px;',
 h3:'font-size:15px;line-height:1.6;font-weight:700;color:#1f4e8c;margin:18px 0 6px;padding-bottom:5px;border-bottom:1px dashed #b8c7da;',
 p:'margin:10px 0;line-height:1.75;',strong:'font-weight:700;color:#1f4e8c;',
 img:'display:block;max-width:100%;height:auto;margin:16px auto;border-radius:4px;',
 blockquote:'margin:16px 0;padding:10px 14px;border-left:4px solid #1f4e8c;background:#f3f6fa;color:#3d4c5c;font-size:14px;',
 a:'color:#1f4e8c;text-decoration:underline;word-break:break-all;',
 ul:'padding-left:20px;margin:10px 0;',ol:'padding-left:20px;margin:10px 0;',li:'margin:4px 0;line-height:1.7;',
 pre:`padding:12px;background:#f3f6fa;border-radius:4px;font-family:${MONO};font-size:12px;white-space:pre-wrap;word-break:break-all;`,code:`font-family:${MONO};font-size:13px;background:#eef2f7;`,
 table:'width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;',td:'border:1px solid #d5dde8;padding:6px 8px;',th:'border:1px solid #1f4e8c;padding:6px 8px;background:#1f4e8c;color:#fff;',
 hr:'border:0;border-top:1px dashed #b8c7da;margin:22px 0;',
 figcaption:'margin:-6px 0 16px;text-align:center;font-size:12px;color:#6b7785;'
};
// Technical: numbered steps, dark code blocks, tip-box quotes.
const technical:StyleSet={
 section:`font-family:${SANS};font-size:15px;line-height:1.85;color:#1e293b;word-break:break-word;`,
 h1:'font-size:23px;line-height:1.45;font-weight:800;color:#0f172a;margin:24px 0 20px;',
 h2:'font-size:17px;line-height:1.6;font-weight:700;color:#0f172a;margin:32px 0 14px;padding-bottom:7px;border-bottom:2px solid #0f172a;',
 h3:`font-family:${MONO};font-size:14px;line-height:1.7;font-weight:700;color:#0d9488;margin:22px 0 8px;letter-spacing:.3px;`,
 p:'margin:13px 0;line-height:1.85;',strong:'font-weight:700;color:#0f172a;',
 img:'display:block;max-width:100%;height:auto;margin:20px auto;border:1px solid #e2e8f0;border-radius:8px;',
 blockquote:'margin:18px 0;padding:12px 16px;border:1px solid #99f6e4;border-radius:8px;background:#f0fdfa;color:#115e59;font-size:14px;',
 a:'color:#0d9488;text-decoration:underline;word-break:break-all;',
 ul:'padding-left:22px;margin:14px 0;',ol:'padding-left:22px;margin:14px 0;',li:'margin:7px 0;line-height:1.8;',
 pre:`padding:16px;background:#0f172a;color:#e2e8f0;border-radius:8px;font-family:${MONO};font-size:12.5px;line-height:1.7;white-space:pre-wrap;word-break:break-all;`,code:`font-family:${MONO};font-size:13px;background:#eef2f6;color:#0f766e;padding:1px 5px;border-radius:3px;`,
 table:'width:100%;border-collapse:collapse;font-size:13px;margin:20px 0;',td:'border:1px solid #e2e8f0;padding:8px;',th:'border:1px solid #0f172a;padding:8px;background:#0f172a;color:#f8fafc;text-align:left;',
 hr:'border:0;border-top:2px solid #e2e8f0;margin:28px 0;',
 figcaption:'margin:-8px 0 20px;text-align:center;font-size:12px;color:#64748b;'
};
const SETS={classic,academic,briefing,technical};
export type WechatStyleId=keyof typeof SETS;
export const WECHAT_STYLES:{id:WechatStyleId;label:string;hint:string}[]=[{id:'classic',label:'经典',hint:'绿色标题、陶土色章节号'},{id:'academic',label:'学术',hint:'衬线标题、圆环章节号、三线表'},{id:'briefing',label:'简报',hint:'PART 章节分隔、紧凑正文，便于扫读'},{id:'technical',label:'工具',hint:'// 步骤标记、深色代码块、提示框'}];
/** The style a column reads best in; the reader can still pick another per article. */
export function defaultWechatStyle(category?:string):WechatStyleId{
 if(category==='昔日学术'||category==='学者观察')return 'academic';
 if(category==='学界犀闻'||category==='学术情报')return 'briefing';
 if(category==='学术开源')return 'technical';
 return 'classic';
}
// Chapter dividers. A section heading is either a chapter (numbered unless it already carries a number)
// or a structural heading such as 摘要/正文, which gets a quieter label and never a number.
type Chapter={n:number;structural:boolean};
const span=(doc:Document,css:string,text?:string)=>{const el=doc.createElement('span');el.setAttribute('style',css);if(text!==undefined)el.textContent=text;return el;};
const wrap=(doc:Document,el:Element,css:string)=>{const inner=span(doc,css);inner.append(...el.childNodes);el.append(inner);return inner;};
const CHAPTER:Partial<Record<WechatStyleId,(doc:Document,el:Element,info:Chapter)=>void>>={
 // Journal: a ringed numeral over a centred serif title that carries its own rule.
 academic(doc,el,{n,structural}){
  if(structural){el.setAttribute('style',`font-family:${SERIF};font-size:15px;line-height:1.6;font-weight:700;letter-spacing:6px;color:#7a1f2b;text-align:center;margin:42px 0 16px;padding-bottom:10px;border-bottom:1px solid #e6dadc;`);return;}
  el.setAttribute('style','margin:50px 0 20px;text-align:center;font-weight:400;');
  wrap(doc,el,`display:inline-block;font-family:${SERIF};font-size:19px;line-height:1.55;font-weight:700;color:#1a1a1a;padding:0 8px 10px;border-bottom:1px solid #1a1a1a;`);
  if(n)el.prepend(span(doc,`display:block;width:28px;height:28px;line-height:28px;margin:0 auto 12px;border:1px solid #7a1f2b;border-radius:50%;font-family:${SERIF};font-size:14px;font-weight:400;color:#7a1f2b;text-align:center;`,String(n)));
 },
 // Briefing: a small "PART 01" label, a full-width accent rule, then the title — the way a product page opens a section.
 briefing(doc,el,{n,structural}){
  if(structural){el.setAttribute('style','margin:30px 0 10px;font-weight:400;');wrap(doc,el,'display:inline-block;font-size:13px;line-height:1.5;font-weight:700;letter-spacing:1px;color:#1f4e8c;background:#eaf0f8;padding:3px 13px;border-radius:999px;');return;}
  el.setAttribute('style','margin:44px 0 14px;padding:0;font-weight:400;');
  wrap(doc,el,`display:block;margin-top:${n?9:0}px;padding-top:11px;border-top:2px solid #1f4e8c;font-size:19px;line-height:1.5;font-weight:800;color:#111;`);
  if(n)el.prepend(span(doc,'display:block;font-size:12px;line-height:1;font-weight:700;letter-spacing:2px;color:#1f4e8c;','PART '+String(n).padStart(2,'0')));
 },
 // Classic: a terracotta number badge beside the green title, closed by a hairline.
 classic(doc,el,{n,structural}){
  if(structural){el.setAttribute('style','margin:32px 0 10px;font-weight:400;');wrap(doc,el,'display:inline-block;font-size:13px;line-height:1.5;font-weight:700;letter-spacing:1px;color:#244536;background:#f2f5f1;border:1px solid #c9d6cc;padding:2px 13px;border-radius:999px;');return;}
  el.setAttribute('style','margin:44px 0 16px;padding-bottom:11px;border-bottom:1px solid #dfe6e0;font-weight:400;');
  wrap(doc,el,'font-size:19px;line-height:1.6;font-weight:700;color:#244536;vertical-align:middle;');
  if(n)el.prepend(span(doc,'display:inline-block;font-size:13px;line-height:22px;font-weight:700;letter-spacing:1px;color:#fff;background:#c66745;padding:0 9px;border-radius:4px;margin-right:10px;vertical-align:middle;',String(n).padStart(2,'0')));
 },
 // Technical: a code-comment step marker over a title with a teal edge, like a section of product docs.
 technical(doc,el,{n,structural}){
  if(structural){el.setAttribute('style','margin:32px 0 10px;font-weight:400;');wrap(doc,el,`display:inline-block;font-family:${MONO};font-size:12.5px;line-height:1.5;font-weight:700;color:#0f766e;background:#f0fdfa;border:1px solid #99f6e4;padding:3px 11px;border-radius:6px;`);return;}
  el.setAttribute('style','margin:46px 0 16px;font-weight:400;');
  wrap(doc,el,`display:block;margin-top:${n?9:0}px;padding-left:12px;border-left:4px solid #0d9488;font-size:19px;line-height:1.5;font-weight:800;color:#0f172a;`);
  if(n)el.prepend(span(doc,`display:block;font-family:${MONO};font-size:12px;line-height:1;font-weight:700;letter-spacing:1.5px;color:#0d9488;`,'// '+String(n).padStart(2,'0')));
 }
};
const NUMBERED=/^\s*(?:\d+\s*[.、．):：）]|[（(]?[一二三四五六七八九十百]+[、．.)）]|第[一二三四五六七八九十百\d]+[章节部分篇])/;
/** `unnumbered` lists the headings that are structure rather than chapters; it comes from the column definition. */
export function wechatHtml(html:string,style:WechatStyleId='classic',options:{unnumbered?:string[]}={}){
 const styles=SETS[style]||classic,chapter=CHAPTER[style],structuralTitles=new Set(options.unnumbered||[]);
 const doc=new DOMParser().parseFromString(html,'text/html');
 // Markdown captions arrive as paragraphs. Keep their source/license links
 // with the image and apply the same caption treatment in every column style.
 for(const paragraph of [...doc.body.querySelectorAll('p')]){
  const caption=paragraph.nextElementSibling;
  if(paragraph.children.length!==1||paragraph.firstElementChild?.tagName!=='IMG'||paragraph.textContent?.trim()||caption?.tagName!=='P'||!/^图(?:\s*\d+|[｜|：:]|\s)/.test(caption.textContent?.trim()||''))continue;
  const figure=doc.createElement('figure'),label=doc.createElement('figcaption');
  paragraph.before(figure);figure.append(...paragraph.childNodes);label.append(...caption.childNodes);figure.append(label);paragraph.remove();caption.remove();
 }
 const allowed=new Set([...Object.keys(styles),'span','div','br','em','b','i','u','s','del','sub','sup','h4','h5','h6','thead','tbody','tfoot','tr','figure','figcaption']);
 let section2=0;
 for(const el of [...doc.body.querySelectorAll('*')]){
  const tag=el.tagName.toLowerCase();
  if(['script','style','iframe','object','embed','svg','math','form','input','button','link','meta','template'].includes(tag)){el.remove();continue;}
  if(!allowed.has(tag)){el.replaceWith(...el.childNodes);continue;}
  const href=el.getAttribute('href')||'',src=el.getAttribute('src')||'',alt=el.getAttribute('alt')||'';
  for(const attr of [...el.attributes])el.removeAttribute(attr.name);
  if(tag==='a'&&/^https?:\/\//i.test(href))el.setAttribute('href',href);
  if(tag==='img'){if(!/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(src)&&!/^https:\/\//i.test(src)){el.remove();continue;}el.setAttribute('src',src);el.setAttribute('alt',alt);}
  if(styles[tag])el.setAttribute('style',styles[tag]);
  if(tag==='figure')el.setAttribute('style','margin:20px 0;');
  // Code inside a block inherits the block's colours instead of the inline-code chip.
  if(tag==='code'&&el.closest('pre'))el.setAttribute('style',`font-family:${MONO};font-size:inherit;background:none;color:inherit;padding:0;`);
  if(tag==='h2'&&chapter){const title=(el.textContent||'').trim(),structural=structuralTitles.has(title);chapter(doc,el,{structural,n:structural||NUMBERED.test(title)?0:++section2});}
 }
 const section=doc.createElement('section');section.setAttribute('style',styles.section);section.append(...doc.body.childNodes);return section.outerHTML;
}
export async function copyRichHtml(html:string){
 const doc=new DOMParser().parseFromString(html,'text/html');
 if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){
  try{await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([doc.body.textContent||''],{type:'text/plain'})})]);return;}catch{/* WKWebView may require the synchronous selection clipboard path. */}
 }
 const selection=window.getSelection(),ranges=selection?Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange()):[];
 const focused=document.activeElement as HTMLElement|null,node=document.createElement('div');node.contentEditable='true';node.style.cssText='position:fixed;left:-10000px;top:0;width:600px;';node.innerHTML=html;document.body.append(node);
 try{const range=document.createRange();range.selectNodeContents(node);selection?.removeAllRanges();selection?.addRange(range);if(!document.execCommand('copy'))throw Error('系统剪贴板没有接受图文内容');}finally{node.remove();selection?.removeAllRanges();ranges.forEach(r=>selection?.addRange(r));focused?.focus();}
}
