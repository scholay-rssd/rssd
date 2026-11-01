const root=document.querySelector('.rssd-share');
if(root){
 const panel=root.querySelector('.rssd-share-panel'),toggle=root.querySelector('.rssd-share-toggle'),status=root.querySelector('[role=status]'),cancel=root.querySelector('[data-action=cancel]');
 const say=(zh,en)=>root.dataset.locale==='en'?en:zh;
 let pendingModel,busy=false,controller;
 const message=(value,error=false)=>{status.textContent=value;status.dataset.error=String(error);};
 const setBusy=value=>{busy=value;for(const button of root.querySelectorAll('[data-action^=download],[data-action=copy-article]'))button.disabled=value;};
 const show=value=>{panel.hidden=!value;toggle.setAttribute('aria-expanded',String(value));if(value)panel.querySelector('button').focus();else toggle.focus();};
 toggle.addEventListener('click',()=>show(panel.hidden));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)show(false);});
 document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!root.contains(e.target)){panel.hidden=true;toggle.setAttribute('aria-expanded','false');}});
 if(location.hash==='#share')show(true);
 const url=root.dataset.url,title=root.dataset.title;
 const channels={weibo:['https://service.weibo.com/share/share.php',{url,title}],qq:['https://connect.qq.com/widget/shareqq/index.html',{url,title}],qzone:['https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey',{url,title}]};
 for(const a of root.querySelectorAll('[data-channel]')){const [base,args]=channels[a.dataset.channel];a.href=base+'?'+new URLSearchParams(args);}
 root.querySelector('[data-action=native]').hidden=!navigator.share;
 function model(){
  if(!pendingModel)pendingModel=fetch(root.dataset.content,{credentials:'omit',redirect:'error'}).then(async response=>{
   if(!response.ok)throw Error(say('文章读取失败，请重试','Unable to load article. Please retry.'));
   const value=await response.json();if(value.version!==1||typeof value.html!=='string'||value.url!==url)throw Error('文章身份或格式不符');return value;
  }).catch(error=>{pendingModel=null;throw error;});
  return pendingModel;
 }
 function download(blob,suffix){const a=document.createElement('a'),objectUrl=URL.createObjectURL(blob);a.href=objectUrl;a.download=(title.slice(0,70).replace(/[\\/:*?"<>|]/g,'-')||'article')+suffix;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);}
 // Loading the small helper on panel open keeps the click itself available to
 // clipboard APIs. PNG rendering and pagination remain download-only.
 let helpers;const loadHelpers=()=>helpers||=(import('./portable.mjs').catch(error=>{helpers=null;throw error;}));
 toggle.addEventListener('click',()=>{if(!panel.hidden)void loadHelpers().catch(()=>{});});
 root.addEventListener('click',async event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
  if(action==='close'){show(false);return;}if(action==='cancel'){controller?.abort();return;}
  if(action==='native'){try{await navigator.share({title,url});}catch(error){if(error.name!=='AbortError')message(error.message,true);}return;}
  if(action==='copy-link'){try{await navigator.clipboard.writeText(url);message(say('链接已复制','Link copied'));}catch{message(say('无法复制，请复制浏览器地址栏中的文章链接','Copy the article URL from your address bar.'),true);}return;}
  if(busy)return;setBusy(true);controller=new AbortController();const signal=controller.signal;
  cancel.hidden=action==='copy-article';message(say('正在准备…','Preparing…'));let frame;
  try{
   if(action==='copy-article'){
    // Initiate clipboard.write before awaiting network or module loading.
    const prepared=Promise.all([loadHelpers(),model()]).then(([helper,data])=>helper.portableArticle(data,{signal}));
    if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){
     try{await navigator.clipboard.write([new ClipboardItem({'text/html':prepared.then(x=>new Blob([x.html],{type:'text/html'})),'text/plain':prepared.then(x=>new Blob([x.plain],{type:'text/plain'}))})]);}
     catch{await(await loadHelpers()).copyArticle(prepared);}
    }else await(await loadHelpers()).copyArticle(prepared);
    message(say('文章已复制，可直接粘贴到编辑器','Article copied. Paste it into your editor.'));
   }else if(action==='download-article'){
    const helper=await loadHelpers(),data=await model();const output=await helper.portableArticle(data,{embed:true,signal});signal.throwIfAborted();download(new Blob([output.document],{type:'text/html;charset=utf-8'}),'.html');message(say('文章下载已开始，可离线打开','Download started. The article can be opened offline.'));
   }else if(action==='download-pages'){
    const [{paginate},{rasterPage},{makeZip},helper,data]=await Promise.all([import('./pagination.mjs'),import('./raster.mjs'),import('./zip.mjs'),loadHelpers(),model()]);
    signal.throwIfAborted();frame=helper.measureFrame();
    const result=await paginate(frame,data,{signal,onProgress:count=>message(say(`正在分页，已排 ${count} 页…`,`Laying out page ${count}…`))});
    const entries=[];for(let i=0;i<result.pages.length;i++){
     signal.throwIfAborted();message(say(`正在生成图片 ${i+1} / ${result.pages.length}…`,`Rendering image ${i+1} / ${result.pages.length}…`));
     entries.push({name:String(i+1).padStart(4,'0')+'.png',blob:await rasterPage(result.pages[i],result.style,{signal})});await new Promise(r=>requestAnimationFrame(r));
    }
    const zip=await makeZip(entries);signal.throwIfAborted();download(zip,'.zip');message(say(`已生成 ${entries.length} 页，下载已开始`,`Created ${entries.length} pages. Download started.`));
   }
  }catch(error){message(error.name==='AbortError'?say('已取消，可重新生成','Cancelled. You can try again.'):error.message,error.name!=='AbortError');}
  finally{frame?.remove();cancel.hidden=true;setBusy(false);}
 });
}
