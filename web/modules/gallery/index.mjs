import {escapeHtml as esc,moduleAsset} from '../shared.mjs';
export const galleryModule={
  id:'gallery',version:1,contentVersion:1,requires:['media'],route:'/gallery/',label:'图片栅格',
  async render({host,options}){
    const images=host.media(options),groups=[...new Set(images.map(x=>x.group||'文章配图'))];
    const cards=images.map(x=>`<figure class="gallery-item" data-group="${esc(x.group||'文章配图')}"><a class="gallery-art" href="${esc(x.src)}" aria-label="查看${esc(x.alt)}大图"><img src="${esc(x.src)}" alt="${esc(x.alt)}"${x.width?` width="${x.width}" height="${x.height}"`:''} loading="lazy" decoding="async"></a><figcaption><small>${esc(x.group||'文章配图')}</small><h2>${esc(x.alt)}</h2>${x.href?`<a href="${esc(x.href)}">${x.recordId?'阅读原文':'查看原作品集'} ↗</a>`:''}</figcaption></figure>`).join('');
    return {title:'图片栅格',body:`<section class="hero compact"><p class="eyebrow">VISUAL COLLECTION / 图片栅格</p><h1>从图像开始，<br>发现创作。</h1><p>作品与文章里的图像，汇集在这里。</p></section><section class="gallery" aria-label="图片作品"><div class="gallery-toolbar"><p id="gallery-count" aria-live="polite">${images.length} 张图片</p>${groups.length?`<label hidden id="gallery-filter-label">系列 <select id="gallery-filter"><option value="">全部系列</option>${groups.map(g=>`<option>${esc(g)}</option>`).join('')}</select></label>`:''}</div><div class="gallery-grid" style="--gallery-columns:${options.columns||4}">${cards||'<p class="empty">还没有可展示的公开图片。</p>'}</div></section>`,styles:['/display/gallery/style.css'],scripts:['/display/gallery/client.js'],files:{'display/gallery/style.css':await moduleAsset('./gallery/style.css'),'display/gallery/client.js':await moduleAsset('./gallery/client.js')}};
  },
};
