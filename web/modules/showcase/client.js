const search=document.querySelector('[data-showcase-search]');
if(search){
  search.closest('label').hidden=false;
  const cards=[...document.querySelectorAll('[data-showcase-card]')],counter=document.querySelector('[data-showcase-count]');
  search.addEventListener('input',()=>{const terms=search.value.toLowerCase().trim().split(/\s+/);let count=0;for(const card of cards){card.hidden=!terms.every(t=>card.dataset.search.includes(t));if(!card.hidden)count++;}counter.textContent=count?'找到 '+count+' 条内容':'没有匹配的内容，试试其他关键词。';});
}
