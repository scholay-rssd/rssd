const root=document.querySelector('.rssd-share');
if(root){
 const panel=root.querySelector('.rssd-share-panel'),toggle=root.querySelector('.rssd-share-toggle'),status=root.querySelector('[role=status]');
 const say=(zh,en)=>root.dataset.locale==='en'?en:zh;
 const poster=root.querySelector('.rssd-share-poster');let busy=false;
 const message=(value,error=false)=>{status.textContent=value;status.dataset.error=String(error);};
 const show=value=>{panel.hidden=!value;toggle.setAttribute('aria-expanded',String(value));if(value)panel.querySelector('[data-action=copy-link]').focus();else toggle.focus();};
 toggle.addEventListener('click',()=>show(panel.hidden));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)show(false);});
 document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!root.contains(e.target)){panel.hidden=true;toggle.setAttribute('aria-expanded','false');}});
 if(location.hash==='#share')show(true);
 const url=root.dataset.url,title=root.dataset.title;
 const channels={weibo:['https://service.weibo.com/share/share.php',{url,title}]};
 for(const a of root.querySelectorAll('[data-channel]')){const [base,args]=channels[a.dataset.channel];a.href=base+'?'+new URLSearchParams(args);}
 root.querySelector('[data-action=native]').hidden=!navigator.share;
 root.addEventListener('click',async event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
  if(action==='close'){show(false);return;}
  if(action==='native'){try{await navigator.share({title,url});}catch(error){if(error.name!=='AbortError')message(error.message,true);}return;}
  if(action==='copy-link'){try{await navigator.clipboard.writeText(url);message(say('链接已复制','Link copied'));}catch{message(say('无法复制，请复制浏览器地址栏中的链接','Copy the address from your address bar.'),true);}return;}
  if(action==='poster'){
   // The poster script loads only when a reader asks for one; the picture is drawn here, never uploaded.
   if(busy)return;busy=true;event.target.closest('button').disabled=true;message(say('正在生成海报…','Making the poster…'));
   try{
    const {drawPoster}=await import('./poster.mjs'),d=root.dataset;
    poster.querySelector('img').src=await drawPoster({url,title,locale:d.locale,site:d.site,section:d.section,date:d.date,author:d.author,cover:d.cover});
    poster.hidden=false;message('');poster.querySelector('[data-action=save-poster]').focus();
   }catch(error){message(say('海报生成失败，请重试','The poster could not be made. Please try again.'),true);}
   finally{busy=false;event.target.closest('button').disabled=false;}
   return;
  }
  if(action==='save-poster'){
   const a=document.createElement('a');a.href=poster.querySelector('img').src;a.download=(title.slice(0,60).replace(/[\\/:*?"<>|]/g,'-')||'poster')+'.png';
   document.body.append(a);a.click();a.remove();
  }
 });
}
