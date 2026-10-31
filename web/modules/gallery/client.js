const select=document.querySelector('#gallery-filter');
if(select){
  document.querySelector('#gallery-filter-label').hidden=false;
  select.addEventListener('change',()=>{
    let count=0;
    for(const item of document.querySelectorAll('.gallery-item')){item.hidden=Boolean(select.value&&item.dataset.group!==select.value);if(!item.hidden)count++;}
    document.querySelector('#gallery-count').textContent=count+' 张图片';
  });
}
