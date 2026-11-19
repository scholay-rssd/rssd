const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.5 6.6-4m-6.6 7 6.6 4"/>',link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>'};
const icon=name=>`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
// Sharing for readers: the page's address, to copy or send on. Copies, downloads and page images of a work
// for distribution come from the desktop app and the Obsidian plug-in, never from the public page.
export function shareShell(model){
 const en=model.locale==='en',say=(zh,english)=>en?english:zh;
 return `<aside class="rssd-share" data-title="${esc(model.title)}" data-url="${esc(model.url)}" data-locale="${esc(model.locale)}">
<button type="button" class="rssd-share-toggle" aria-expanded="false" aria-controls="rssd-share-panel">${icon('share')}<span>${say('分享','Share')}</span></button>
<section id="rssd-share-panel" class="rssd-share-panel" aria-label="${say('分享','Share')}" hidden>
<header><strong>${say('分享','Share')}</strong><button type="button" data-action="close" aria-label="${say('关闭分享','Close sharing')}">${icon('close')}</button></header>
<div class="rssd-share-actions"><button type="button" data-action="copy-link">${icon('link')}${say('复制链接','Copy link')}</button><button type="button" data-action="native" hidden>${icon('share')}${say('系统分享','Share…')}</button></div>
<nav class="rssd-share-social" aria-label="${say('分享到','Share to')}"><a data-channel="weibo" target="_blank" rel="noopener noreferrer">微博</a><a data-channel="qq" target="_blank" rel="noopener noreferrer">QQ</a><a data-channel="qzone" target="_blank" rel="noopener noreferrer">QQ 空间</a></nav>
<p class="rssd-share-status" role="status" aria-live="polite"></p>
</section></aside>`;
}
