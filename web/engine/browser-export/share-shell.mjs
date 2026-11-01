const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.5 6.6-4m-6.6 7 6.6 4"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',article:'<path d="M14 2H5v20h14V7l-5-5Z M14 2v5h5M8 12h8M8 16h8"/>',pages:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>'};
const icon=name=>`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
export function shareShell(model,contentPath){
 const en=model.locale==='en',say=(zh,english)=>en?english:zh;
 return `<aside class="rssd-share" data-content="${esc(contentPath)}" data-title="${esc(model.title)}" data-url="${esc(model.url)}" data-locale="${esc(model.locale)}">
<button type="button" class="rssd-share-toggle" aria-expanded="false" aria-controls="rssd-share-panel">${icon('share')}<span>${say('分享','Share')}</span></button>
<section id="rssd-share-panel" class="rssd-share-panel" aria-label="${say('分享文章','Share article')}" hidden>
<header><strong>${say('分享文章','Share article')}</strong><button type="button" data-action="close" aria-label="${say('关闭分享','Close sharing')}">${icon('close')}</button></header>
<div class="rssd-share-group"><h2>${icon('article')}${say('文章','Article')}</h2><p>${say('保留完整正文、配图与排版','Complete text, images and formatting')}</p><div class="rssd-share-actions"><button type="button" data-action="copy-article">${icon('copy')}${say('复制文章','Copy article')}</button><button type="button" data-action="download-article">${icon('download')}${say('下载 HTML','Download HTML')}</button></div></div>
<div class="rssd-share-group"><h2>${icon('pages')}${say('图文','Page images')}</h2><p>${say('生成整篇文章的分页图片','Generate numbered images of the complete article')}</p><button type="button" data-action="download-pages">${icon('download')}${say('打包下载 ZIP','Download ZIP')}</button></div>
<nav class="rssd-share-social" aria-label="${say('其他分享方式','More sharing options')}"><button type="button" data-action="copy-link">${say('复制链接','Copy link')}</button><button type="button" data-action="native" hidden>${say('系统分享','Share…')}</button><a data-channel="weibo" target="_blank" rel="noopener noreferrer">微博</a><a data-channel="qq" target="_blank" rel="noopener noreferrer">QQ</a><a data-channel="qzone" target="_blank" rel="noopener noreferrer">QQ 空间</a></nav>
<p class="rssd-share-status" role="status" aria-live="polite"></p><button type="button" data-action="cancel" hidden>${say('取消生成','Cancel')}</button>
</section></aside>`;
}
