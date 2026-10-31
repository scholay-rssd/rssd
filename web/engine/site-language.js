/* Published language navigation only; never translates or changes article URLs. */
(()=>{
 const key='scholay-language';
 for(const link of document.querySelectorAll('[data-language-switch]'))link.addEventListener('click',()=>{try{localStorage.setItem(key,link.dataset.languageSwitch);}catch{}});
})();
