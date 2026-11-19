const root=document.querySelector('.rssd-share');
if(root){
 const panel=root.querySelector('.rssd-share-panel'),toggle=root.querySelector('.rssd-share-toggle'),status=root.querySelector('[role=status]');
 const say=(zh,en)=>root.dataset.locale==='en'?en:zh;
 const message=(value,error=false)=>{status.textContent=value;status.dataset.error=String(error);};
 const show=value=>{panel.hidden=!value;toggle.setAttribute('aria-expanded',String(value));if(value)panel.querySelector('[data-action=copy-link]').focus();else toggle.focus();};
 toggle.addEventListener('click',()=>show(panel.hidden));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)show(false);});
 document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!root.contains(e.target)){panel.hidden=true;toggle.setAttribute('aria-expanded','false');}});
 if(location.hash==='#share')show(true);
 const url=root.dataset.url,title=root.dataset.title;
 const channels={weibo:['https://service.weibo.com/share/share.php',{url,title}],qq:['https://connect.qq.com/widget/shareqq/index.html',{url,title}],qzone:['https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey',{url,title}]};
 for(const a of root.querySelectorAll('[data-channel]')){const [base,args]=channels[a.dataset.channel];a.href=base+'?'+new URLSearchParams(args);}
 root.querySelector('[data-action=native]').hidden=!navigator.share;
 root.addEventListener('click',async event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
  if(action==='close'){show(false);return;}
  if(action==='native'){try{await navigator.share({title,url});}catch(error){if(error.name!=='AbortError')message(error.message,true);}return;}
  if(action==='copy-link'){try{await navigator.clipboard.writeText(url);message(say('链接已复制','Link copied'));}catch{message(say('无法复制，请复制浏览器地址栏中的链接','Copy the address from your address bar.'),true);}}
 });
}
