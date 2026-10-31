// Runs in an isolated browser, with network disabled except approved article media.
// This function is intentionally self-contained so preview and export share pixels.
export async function layoutNoteCards({html, breaks = {}, brand = 'today', allowedOrigin = ''}) {
  const allowed = new Set('H1 H2 H3 H4 H5 H6 P STRONG EM B I U S UL OL LI BLOCKQUOTE PRE CODE TABLE THEAD TBODY TFOOT TR TD TH FIGURE FIGCAPTION BR SPAN SUP SUB A IMG HR'.split(' '));
  const source = new DOMParser().parseFromString(html, 'text/html');
  const clean = node => {
    if (node.nodeType === 3) return document.createTextNode(node.textContent);
    const fragment = document.createDocumentFragment();
    if (node.nodeType !== 1 || ['SCRIPT','STYLE','IFRAME','OBJECT','SVG','FORM'].includes(node.tagName)) return fragment;
    const tag = node.tagName;
    const element = allowed.has(tag) ? document.createElement(tag.toLowerCase()) : fragment;
    if (tag === 'IMG') {
      const src = node.getAttribute('src') || '';
      let accepted = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(src);
      if (!accepted && allowedOrigin) {
        try { const url = new URL(src, allowedOrigin); accepted = url.origin === allowedOrigin && /^\/article-media\/[a-f0-9]{64}\.(webp|png|jpg)$/.test(url.pathname) && !url.search; if (accepted) element.src = url.href; } catch {}
      }
      if (!accepted) throw Error('配图尚未载入，或不是当前站点的文章图片；请先在原稿中补齐图片。');
      if (!element.src) element.src = src;
      element.alt = node.getAttribute('alt') || '';
    }
    if (tag === 'OL' && /^\d+$/.test(node.getAttribute('start') || '')) element.start = Number(node.getAttribute('start'));
    if (['TD','TH'].includes(tag)) for (const name of ['colspan','rowspan']) {
      const n = Number(node.getAttribute(name)); if (n > 0 && n <= 20) element.setAttribute(name, String(n));
    }
    for (const child of node.childNodes) element.append(clean(child));
    return element;
  };
  const staging = document.createElement('div');
  staging.append(...[...source.body.childNodes].map(clean));
  // Container wrappers are flattened above; retain meaningful loose text too.
  for (const node of [...staging.childNodes]) if (node.nodeType === 3) {
    if (!node.textContent.trim()) node.remove();
    else { const p = document.createElement('p'); p.textContent = node.textContent; node.replaceWith(p); }
  }
  for (const element of [...staging.children]) {
    if (element.tagName === 'IMG' || element.tagName === 'P' && element.querySelector('img') && !element.textContent.trim()) {
      const next = element.nextElementSibling;
      const figure = document.createElement('figure'); element.replaceWith(figure); figure.append(element);
      if (next?.tagName === 'P' && /^(图[\d：:｜|\s]|图片|论文图|示意图|摄影|来源[：:]|AI\s*生成|插图|配图)|(?:^|[。\s])图[：:]|CC BY|AI\s*生成(?:示意)?图/i.test(next.textContent.trim())) {
        const caption = document.createElement('figcaption'); caption.append(...next.childNodes); next.remove(); figure.append(caption);
      }
    }
  }
  let formulaCount=0;
  const walker=document.createTreeWalker(staging,NodeFilter.SHOW_TEXT),textNodes=[];
  while(walker.nextNode())if(!walker.currentNode.parentElement.closest('pre,code'))textNodes.push(walker.currentNode);
  for(const node of textNodes){
    if(!globalThis.__noteMathSegments){if(/\\[a-zA-Z]+|\$\$/.test(node.textContent))throw Error('公式引擎尚未准备好');continue;}
    const parts=globalThis.__noteMathSegments(node.textContent,{legacy:true});
    if(!parts.some(part=>part.tex!==undefined))continue;
    const fragment=document.createDocumentFragment();
    for(const part of parts){
      if(part.tex===undefined){fragment.append(document.createTextNode(part.text));continue;}
      if(++formulaCount>500)throw Error('公式过多，请分篇导出。');
      const math=document.createElement('span');math.className='note-math'+(part.display?' note-math-display':'');math.dataset.source=part.text;
      math.innerHTML=await globalThis.__noteMathRender(part.tex,part.display);
      fragment.append(math);
    }
    node.replaceWith(fragment);
  }
  const contentText=(node,atomic=false)=>node.nodeType===3?node.textContent:node.classList?.contains('note-math')?(atomic?'\uFFFC':node.dataset.source):[...node.childNodes].map(child=>contentText(child,atomic)).join('');
  const units = [];
  const collectUnits=()=>{
  for (const [index, element] of [...staging.children].entries()) {
    const add = (node, suffix = '') => units.push({id: `b${index}${suffix}`, element: node, heading: /^H[1-6]$/.test(node.tagName), label: (contentText(node).trim() || node.querySelector('img')?.alt || '配图').slice(0, 90)});
    if (['UL','OL'].includes(element.tagName)) {
      [...element.children].forEach((li, i) => {const list = element.cloneNode(false); if (element.tagName === 'OL') list.start = (element.start || 1) + i; list.append(li.cloneNode(true)); add(list, `-${i}`);});
    } else add(element);
  }
  if (!units.length) throw Error('当前稿件没有可排版的内容。');
  if (units.length > 800) throw Error('内容段落过多，请分篇导出。');
  };
  const style = document.createElement('style');
  style.textContent = `*{box-sizing:border-box}html,body{margin:0;background:#e9ece8;color:#213a31}body{font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif}.card{width:1080px;height:1440px;background:#fffef9;padding:58px 70px 48px;margin:0;position:relative;overflow:hidden}.mast{height:50px;font-size:23px;letter-spacing:2px;border-bottom:2px solid #ced8ce;color:#617168;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.body{height:1212px;margin-top:28px;display:flow-root;overflow:visible}.foot{position:absolute;left:70px;right:70px;bottom:30px;display:flex;justify-content:space-between;font-size:22px;color:#69756d}.continuation{font-size:28px;line-height:1.5;margin:0 0 25px;color:#68766c;border-bottom:1px solid #dce4d9;padding-bottom:15px}h1{font-size:68px;line-height:1.35;margin:0 0 34px;letter-spacing:-1px}h2,h3,h4,h5,h6{font-size:54px;line-height:1.4;margin:0 0 30px;color:#264d3b}p,ul,ol,blockquote{font-size:44px;line-height:1.65;margin:0 0 26px;overflow-wrap:anywhere;line-break:strict}li{padding-left:5px}ul,ol{padding-left:1.35em}strong,b{font-weight:700;color:#194d37}figure{margin:0 0 28px}figure p{margin:0}img{display:block;max-width:100%;max-height:650px;width:auto;height:auto;object-fit:contain;margin:0 auto}figcaption{font-size:27px;line-height:1.55;margin-top:16px;color:#5c6b63;overflow-wrap:anywhere}blockquote{border-left:5px solid #b9caba;padding-left:26px;color:#506455}pre{font:30px/1.65 Consolas,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;padding:24px;background:#eff3ed;margin:0 0 26px}code{font-family:Consolas,Menlo,monospace}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:30px;line-height:1.5;margin:0 0 24px;overflow-wrap:anywhere}td,th{border:1px solid #b9caba;padding:12px}th{background:#edf3e9;text-align:left}hr{border:0;border-top:2px solid #cdd8cc;margin:28px 0}a{color:inherit;text-decoration:none}.measure{position:absolute;left:-20000px;width:940px}`;
  document.head.append(style);
  const mathStyle=document.createElement('style');mathStyle.textContent='.note-math{display:inline-block;white-space:nowrap;vertical-align:middle;overflow-wrap:normal;line-break:auto;letter-spacing:0}.note-math .katex{font-size:1em;text-align:initial}.note-math-display{display:block;text-align:center;margin:18px 0}.note-math-display .katex-display{margin:0}.note-math-display .katex-display>.katex{display:inline-block}.note-math .katex *{box-sizing:content-box}';document.head.append(mathStyle);
  const holder = document.createElement('div'); holder.className = 'measure'; holder.append(staging); document.body.append(holder);
  staging.getBoundingClientRect();
  await document.fonts.ready;
  if(formulaCount&&[...document.fonts].some(font=>font.family.startsWith('KaTeX')&&font.status==='error'))throw Error('公式字体载入失败，请重新生成预览。');
  for(const math of staging.querySelectorAll('.note-math')){
    const inner=math.querySelector('.katex');let parent=math.parentElement;
    while(parent!==staging&&(!parent.clientWidth||getComputedStyle(parent).display==='inline'))parent=parent.parentElement;
    const width=parent.clientWidth-parseFloat(getComputedStyle(parent).paddingLeft)-parseFloat(getComputedStyle(parent).paddingRight),actual=inner.getBoundingClientRect().width;
    if(actual>width-4){const size=parseFloat(getComputedStyle(math).fontSize)*(width-4)/actual;if(size<22)throw Error('公式过宽，无法在一页内清晰显示；请调整公式换行。');math.style.fontSize=size+'px';}
  }
  await document.fonts.ready;
  await Promise.all([...staging.querySelectorAll('img')].map(async img => {await img.decode(); if (!img.naturalWidth) throw Error('配图读取失败。');}));
  collectUnits();
  const pages = []; let current, section = '', count = 0;
  const newPage = (continued = false) => {
    if (pages.length >= 80) throw Error('本次超过 80 页，请分篇导出；原文未被截断。');
    const card = document.createElement('section'); card.className = 'card';
    const mast = document.createElement('header'); mast.className = 'mast'; mast.textContent = brand;
    const body = document.createElement('div'); body.className = 'body';
    if (continued && section) {const label = document.createElement('div'); label.className = 'continuation'; label.textContent = section + ' · 续'; body.append(label);}
    const foot = document.createElement('footer'); foot.className = 'foot';
    const name = document.createElement('span'); name.textContent = brand; foot.append(name, document.createElement('span'));
    card.append(mast, body, foot); document.body.append(card);
    current = {card, body, heading: section, blocks: [], content: []}; pages.push(current); count = 0;
  };
  // KaTeX radical paths intentionally extend beyond a clipped SVG viewport;
  // measure that viewport, not the invisible path coordinates inside it.
  const fits = () => current.body.scrollHeight <= current.body.clientHeight + 1 && [...current.body.querySelectorAll('*')].filter(e=>!(e instanceof SVGElement)||e.tagName==='svg').every(e => e.getBoundingClientRect().right <= current.body.getBoundingClientRect().right + 1);
  const put = (element, unit) => {current.body.append(element); if (fits()) {element.dataset.noteBlock=unit.id;current.blocks.push(unit.id); current.content.push(contentText(element)); count++; return true;} element.remove(); return false;};
  // Split text at measured grapheme boundaries while retaining inline markup.
  function slice(element, from, to) {
    let offset = 0;
    const trim = node => {
      if (node.nodeType === 3) {const start = offset; offset += node.length; const value = node.textContent.slice(Math.max(0,from-start),Math.max(0,to-start)); return value ? document.createTextNode(value) : null;}
      if(node.classList?.contains('note-math')){const start=offset++;return from<=start&&to>start?node.cloneNode(true):null;}
      if (node.tagName === 'BR') return offset >= from && offset < to ? node.cloneNode() : null;
      const clone = node.cloneNode(false); for (const child of node.childNodes) {const kept = trim(child); if (kept) clone.append(kept);}
      return clone.childNodes.length ? clone : null;
    };
    return trim(element) || element.cloneNode(false);
  }
  newPage();
  for (const unit of units) {
    const element = unit.element;
    if (unit.heading) section = contentText(element).trim();
    const forced = breaks[unit.id] === 'page' || (unit.heading && breaks[unit.id] !== 'flow');
    if (forced && count) newPage();
    if (unit.heading) current.heading = section;
    if (put(element.cloneNode(true), unit)) {
      // Keep a heading with at least two lines of its following paragraph.
      if (unit.heading && current.body.lastElementChild.getBoundingClientRect().bottom > current.body.getBoundingClientRect().bottom - 150 && count > 1) {
        current.body.lastElementChild.remove(); current.blocks.pop(); current.content.pop(); newPage(); if (!put(element.cloneNode(true), unit)) throw Error('标题过长，无法完整排入一页。');
      }
      continue;
    }
    if (element.tagName === 'FIGURE' || unit.heading || element.querySelector('img')) {
      if (count) newPage(true);
      if (!put(element.cloneNode(true), unit)) throw Error('图片与图注或标题超过一页，请调整原稿显示尺寸后重试。原文未被裁切。');
      continue;
    }
    if (element.tagName === 'TABLE') {
      const rows = [...element.querySelectorAll(':scope > tbody > tr, :scope > tfoot > tr, :scope > tr')];
      if (!rows.length || element.querySelector('[rowspan],table')) {if (count) newPage(true); if (!put(element.cloneNode(true), unit)) throw Error('表格无法完整分页，请拆分表格后重试。'); continue;}
      let table = element.cloneNode(false); table.dataset.noteBlock=unit.id; const head = element.querySelector('thead'); if (head) table.append(head.cloneNode(true)); let body = document.createElement('tbody'); table.append(body);
      for (const row of rows) {
        const clone = row.cloneNode(true); body.append(clone); current.body.append(table);
        if (!fits()) {clone.remove(); if (body.children.length) {current.blocks.push(unit.id); current.content.push(contentText(table)); count++;} else table.remove(); newPage(true); table = element.cloneNode(false); table.dataset.noteBlock=unit.id; if (head) table.append(head.cloneNode(true)); body = document.createElement('tbody'); body.append(clone); table.append(body); current.body.append(table); if (!fits()) throw Error('表格单行超过一页，请调整表格。');}
      }
      current.blocks.push(unit.id); current.content.push(contentText(table)); count++; continue;
    }
    const text = contentText(element,true), ends = [...new Intl.Segmenter('zh', {granularity:'grapheme'}).segment(text)].map(s => s.index + s.segment.length);
    if (!text.length) {if (count) newPage(true); if (!put(element.cloneNode(true),unit)) throw Error('内容块无法完整排版。'); continue;}
    let from = 0;
    while (from < text.length) {
      let lo = ends.findIndex(end => end > from), hi = ends.length - 1, best = from;
      while (lo <= hi) {const mid = Math.floor((lo + hi) / 2), piece = slice(element, from, ends[mid]); current.body.append(piece); const ok = fits(); piece.remove(); if (ok) {best = ends[mid]; lo = mid + 1;} else hi = mid - 1;}
      if (best === from || best - from < 25 && best < text.length && count) {if (!count) throw Error('当前内容无法完整排版：'+unit.label); newPage(true); continue;}
      if (best < text.length) {const prefix = text.slice(from, best); const boundary = Math.max(prefix.lastIndexOf('。'), prefix.lastIndexOf('；'), prefix.lastIndexOf('\n')); if (boundary > prefix.length * .75) best = from + boundary + 1;}
      if (best < text.length && count) {
        const candidate = slice(element,from,best); current.body.append(candidate); const css = getComputedStyle(candidate);
        const height = candidate.getBoundingClientRect().height - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
        const orphan = height < parseFloat(css.lineHeight) * 1.8; candidate.remove();
        if (orphan) {newPage(true); continue;}
      }
      const piece = slice(element, from, best); if (!put(piece, unit)) throw Error('分页测量发生变化，请重新生成。'); from = best;
      if (from < text.length) newPage(true);
    }
  }
  holder.remove();
  for (const [i, page] of pages.entries()) page.card.querySelector('.foot').lastElementChild.textContent = `${String(i + 1).padStart(2,'0')} / ${String(pages.length).padStart(2,'0')}`;
  // Public layout coordinates only: the desktop overlays its private notes after
  // rendering. The image renderer and exported pixels never receive those notes.
  return {pages: pages.map(p => {const card=p.card.getBoundingClientRect();return {heading:p.heading, blocks:[...new Set(p.blocks)], text:p.content.join(''),positions:[...p.body.querySelectorAll(':scope > [data-note-block]')].map(element=>{const rect=element.getBoundingClientRect();return {id:element.dataset.noteBlock,left:rect.left-card.left,top:rect.top-card.top};})};}), blocks:units.map(u => ({id:u.id,label:u.label,heading:u.heading,tag:u.element.tagName,text:contentText(u.element)})), text:units.map(u=>contentText(u.element)).join(''), warnings:[],formulaCount};
}
