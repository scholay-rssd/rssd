const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function shareShell(model,contentPath){
 const en=model.locale==='en',say=(zh,english)=>en?english:zh;
 return `<aside class="rssd-share" data-content="${esc(contentPath)}" data-title="${esc(model.title)}" data-url="${esc(model.url)}" data-locale="${esc(model.locale)}">
<button type="button" class="rssd-share-toggle" aria-expanded="false" aria-controls="rssd-share-panel">↗ ${say('分享','Share')}</button>
<section id="rssd-share-panel" class="rssd-share-panel" aria-label="${say('分享文章','Share article')}" hidden>
<header><strong>${say('分享','Share')}</strong><button type="button" data-action="close" aria-label="${say('关闭分享','Close sharing')}">×</button></header>
<div class="rssd-share-group"><h2>${say('文章','Article')}</h2><p>${say('保留完整正文、配图与排版','Complete text, images and formatting')}</p><div class="rssd-share-actions"><button type="button" data-action="copy-article">${say('复制文章','Copy article')}</button><button type="button" data-action="download-article">${say('下载 HTML','Download HTML')}</button></div></div>
<div class="rssd-share-group"><h2>${say('图文','Page images')}</h2><p>${say('生成整篇文章的分页图片','Generate numbered images of the complete article')}</p><button type="button" data-action="download-pages">${say('打包下载 ZIP','Download ZIP')}</button></div>
<nav class="rssd-share-social" aria-label="${say('其他分享方式','More sharing options')}"><button type="button" data-action="copy-link">${say('复制链接','Copy link')}</button><button type="button" data-action="native" hidden>${say('系统分享','Share…')}</button><a data-channel="weibo" target="_blank" rel="noopener noreferrer">微博</a><a data-channel="qq" target="_blank" rel="noopener noreferrer">QQ</a><a data-channel="qzone" target="_blank" rel="noopener noreferrer">QQ 空间</a></nav>
<p class="rssd-share-status" role="status" aria-live="polite"></p><button type="button" data-action="cancel" hidden>${say('取消生成','Cancel')}</button>
</section></aside>`;
}
