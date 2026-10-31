const filter=document.querySelector('#graph-filter');
if(filter){
  document.querySelector('#graph-filter-label').hidden=false;
  filter.addEventListener('change',()=>{
    const id=filter.value,neighbors=new Set(id?[id]:[]);let count=0;
    for(const card of document.querySelectorAll('.graph-relation')){
      const selected=!id||card.dataset.from===id||card.dataset.to===id;
      card.hidden=!selected;
      if(selected){count++;neighbors.add(card.dataset.from);neighbors.add(card.dataset.to);}
    }
    for(const node of document.querySelectorAll('.graph-node'))node.classList.toggle('is-dim',Boolean(id&&!neighbors.has(node.dataset.node)));
    for(const edge of document.querySelectorAll('.graph-edge')){
      const selected=!id||edge.dataset.from===id||edge.dataset.to===id;
      edge.classList.toggle('is-dim',!selected);edge.setAttribute('tabindex',selected?'0':'-1');edge.style.pointerEvents=selected?'':'none';
    }
    document.querySelector('#graph-count').textContent=(id?filter.selectedOptions[0].textContent:'全部实体')+' · '+count+' 条有据关系';
  });
  for(const link of document.querySelectorAll('.graph-edge'))link.addEventListener('click',()=>{
    const card=document.getElementById('graph-'+link.dataset.relation);if(card){card.querySelector('details').open=true;card.setAttribute('tabindex','-1');card.focus({preventScroll:true});}
  });
  for(const link of document.querySelectorAll('.graph-node'))link.addEventListener('click',()=>{
    document.querySelector('.graph-entities').open=true;
    const card=document.getElementById('graph-'+link.dataset.node);card.setAttribute('tabindex','-1');card.focus({preventScroll:true});
  });
}
