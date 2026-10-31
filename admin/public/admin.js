'use strict';
const app=document.querySelector('#app'),notice=document.querySelector('#notice');
let publicSite=null;
const brand=()=>publicSite?.siteId&&publicSite.siteId!=='scholay-today'?esc(publicSite.name):'SCHOLAY <em>Today</em>';
const LANGUAGE_KEY='scholay-admin-language';
// Saved choice → browser locale → English, matching the desktop app.
function initialLanguage(){
  try{const saved=localStorage.getItem(LANGUAGE_KEY);if(Object.hasOwn(ADMIN_MESSAGES,saved||''))return saved;}catch{}
  const system=(navigator.language||'').toLowerCase();return system.startsWith('zh')?'zh':system.startsWith('ja')?'ja':'en';
}
let lang=initialLanguage(),locale='zh-CN';
const t=(key,vars={})=>String(ADMIN_MESSAGES[lang][key]??ADMIN_MESSAGES.zh[key]??key).replace(/\{(\w+)\}/g,(_,name)=>vars[name]??'');
function applyLanguage(next){
  lang=next;locale=ADMIN_LANGUAGES.find(([code])=>code===next)[2];
  document.documentElement.lang=locale;document.title=t('app.title')+' · RSSD';
}
applyLanguage(lang);
const loading=app.querySelector('.loading');if(loading)loading.textContent=t('app.loading');
// Site section names are Chinese content; other languages show the generic kind.
const names=Object.fromEntries(['year','history','openSource','news'].map(kind=>[kind,ADMIN_MESSAGES.zh['kind.'+kind]]));
const kindName=kind=>lang==='zh'?names[kind]:t('kind.'+kind);
const S={user:null,csrf:null,initialized:true,view:'review',kind:'',q:'',filter:'review',page:1,doc:null,dirty:false,options:null,save:null};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=v=>v?new Date(v).toLocaleString(locale,{hour12:false}):'—';
const stateName=state=>Object.hasOwn(ADMIN_MESSAGES.zh,'state.'+state)?t('state.'+state):state;
const badge=state=>'<span class="badge '+esc(state)+'">'+esc(stateName(state))+'</span>';
const noteText=note=>{const restore=/^恢复版本 (\d+) 为新草稿$/.exec(note||'');return restore?t('note.restore',{version:restore[1]}):Object.hasOwn(ADMIN_MESSAGES.zh,'note.'+note)?t('note.'+note):note;};
const languagePicker=()=>'<select class="language" data-action="language" aria-label="'+esc(t('language'))+'">'+ADMIN_LANGUAGES.map(([code,label])=>'<option value="'+code+'" '+(code===lang?'selected':'')+'>'+label+'</option>').join('')+'</select>';
function bindLanguagePicker(){
  const select=app.querySelector('[data-action=language]');if(!select)return;
  select.onchange=async()=>{
    if(S.dirty){try{await saveEditor(false);}catch{if(!confirm(t('confirm.leave'))){select.value=lang;return;}S.dirty=false;}}
    try{localStorage.setItem(LANGUAGE_KEY,select.value);}catch{}
    applyLanguage(select.value);
    if(!S.user)return loginPage(S.initialized);
    const doc=S.doc;S.doc=null;await renderShell();if(doc){S.doc=doc;editorPage();}
  };
}
const stateOf=d=>d.latest_revision===d.published_revision?'published':d.review_state;
const safeUrl=v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'#';}catch{return '#';}};
function notify(message){notice.textContent=message;notice.classList.add('visible');clearTimeout(notify.timer);notify.timer=setTimeout(()=>notice.classList.remove('visible'),5500);}
async function api(path,{method='GET',data}={}) {
  const response=await fetch('/manage/api'+path,{method,headers:{'Content-Type':'application/json','X-Scholay-Language':lang,...(S.csrf?{'X-CSRF-Token':S.csrf}:{})},...(data?{body:JSON.stringify(data)}:{}),credentials:'same-origin'});
  let value;try{value=await response.json();}catch{throw new Error(response.status===429?t('error.busy'):t('error.unavailable'));}
  if(!response.ok){if(response.status===401&&S.user&&path!=='/login')reauthenticate();throw new Error(value.error||t('error.failed'));}return value;
}
const post=(path,data={})=>api(path,{method:'POST',data});
function reauthenticate(){
  if(document.querySelector('#reauth'))return;
  const dialog=document.createElement('dialog');dialog.id='reauth';dialog.className='reauth';
  dialog.innerHTML='<h2>'+t('reauth.title')+'</h2><p>'+t('reauth.body')+'</p><form><label>'+t('field.username')+'<input name="username" autocomplete="username" value="'+esc(S.user.username)+'"></label><label>'+t('field.password')+'<input name="password" type="password" autocomplete="current-password" required></label><p class="form-error" role="alert"></p><button class="primary">'+t('reauth.submit')+'</button></form>';
  document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>e.preventDefault());
  dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();try{const result=await post('/login',Object.fromEntries(new FormData(e.target)));S.user=result.user;S.csrf=result.csrf;dialog.close();dialog.remove();if(S.dirty)await saveEditor(false);notify(t('reauth.done'));}catch(error){if(dialog.isConnected)dialog.querySelector('.form-error').textContent=error.message;else notify(error.message);}};
}
function theme(){const saved=localStorage.getItem('scholay-admin-theme');if(saved)document.documentElement.dataset.theme=saved;}
theme();
function themeToggle(){const isDark=document.documentElement.dataset.theme==='dark'||(!document.documentElement.dataset.theme&&matchMedia('(prefers-color-scheme: dark)').matches);localStorage.setItem('scholay-admin-theme',isDark?'light':'dark');theme();}
function loginPage(initialized=true) {
  const setup=!initialized;S.initialized=initialized;
  app.innerHTML='<main class="login"><div class="login-head"><a class="brand" href="/">'+brand()+'</a>'+languagePicker()+'</div><h1>'+t(setup?'login.setupTitle':'login.title')+'</h1><p>'+t(setup?'login.setupIntro':'login.intro')+'</p><form id="login-form">'+(setup?'<label>'+t('login.setupCode')+'<input name="token" required autocomplete="off" spellcheck="false"></label>':'')+'<label>'+t('field.username')+'<input name="username" required autocomplete="username" value="'+(setup?'scholay_owner':'')+'" maxlength="40"></label><label>'+t('field.password')+'<div class="password-wrap"><input name="password" type="password" required autocomplete="'+(setup?'new-password':'current-password')+'" '+(setup?'minlength="16"':'')+' maxlength="128"><button type="button" id="show-password">'+t('login.show')+'</button></div></label>'+(setup?'<small>'+t('login.passwordHint')+'</small>':'')+'<div class="form-error" role="alert" id="login-error"></div><button class="primary" type="submit">'+t(setup?'login.setupSubmit':'login.submit')+'</button></form></main>';
  bindLanguagePicker();
  document.querySelector('#show-password').onclick=()=>{const p=document.querySelector('[name=password]');p.type=p.type==='password'?'text':'password';document.querySelector('#show-password').textContent=t(p.type==='password'?'login.show':'login.hide');};
  document.querySelector('#login-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
    try {const result=await post(setup?'/setup':'/login',Object.fromEntries(new FormData(form)));S.user=result.user;S.csrf=result.csrf;S.options=await api('/options');await renderShell();}
    catch(error){document.querySelector('#login-error').textContent=error.message;button.disabled=false;}
  };
}
async function renderShell() {
  if(S.options?.site){publicSite=S.options.site;Object.assign(names,publicSite.kinds);}
  app.innerHTML='<header class="top"><a class="brand" href="/" target="_blank" rel="noopener">'+brand()+'</a><div class="actions"><span class="username">'+esc(S.user.username)+'</span>'+languagePicker()+'<button data-action="theme">'+t('shell.theme')+'</button><a href="/" target="_blank" rel="noopener">'+t('shell.viewSite')+'</a><button data-action="logout">'+t('shell.logout')+'</button></div></header><div class="layout"><nav class="sidebar" aria-label="'+t('shell.navigation')+'"><small>'+t('shell.workspace')+'</small>'+[['review',t('nav.review')],['all',t('nav.all')],...Object.keys(names).map(key=>[key,esc(kindName(key))]),['queue',t('nav.queue')],['audit',t('nav.audit')],['settings',t('nav.settings')]].map(([key,name])=>'<button class="nav" data-nav="'+key+'">'+name+'</button>').join('')+'<footer>'+t('shell.footer')+'</footer></nav><main id="main"></main></div>';
  bindLanguagePicker();
  app.querySelector('[data-action=theme]').onclick=themeToggle;
  app.querySelector('[data-action=logout]').onclick=async()=>{if(S.dirty&&!confirm(t('confirm.logout')))return;await post('/logout');S.user=null;S.dirty=false;loginPage();};
  for(const el of app.querySelectorAll('[data-nav]'))el.onclick=()=>navigate(el.dataset.nav);
  await showView();
}
async function navigate(view) {
  if(S.dirty){try{await saveEditor(false);}catch{if(!confirm(t('confirm.leave')))return;}}
  S.view=view;S.doc=null;S.dirty=false;S.page=1;S.q='';S.kind=names[view]?view:'';S.filter=view==='review'?'review':'';await showView();
}
async function showView() {
  for(const el of app.querySelectorAll('[data-nav]'))el.classList.toggle('active',el.dataset.nav===S.view);
  try {if(S.view==='queue')await queuePage();else if(S.view==='settings')await settingsPage();else if(S.view==='audit')await auditPage();else await listPage();}
  catch(error){notify(error.message);}
}
function heading(title,subtitle,buttons=''){return '<div class="heading"><div><h1>'+esc(title)+'</h1><p>'+esc(subtitle)+'</p></div><div class="buttons">'+buttons+'</div></div>';}
async function listPage() {
  const [result,status]=await Promise.all([api('/documents?'+new URLSearchParams({kind:S.kind,q:S.q,state:S.filter,page:S.page})),api('/status')]);
  const main=document.querySelector('#main');
  main.innerHTML=heading(names[S.view]?kindName(S.view):t(S.view==='review'?'nav.review':'nav.all'),t('list.subtitle'),'<button class="primary" id="new">'+t('list.new')+'</button>')+
  '<div class="stats">'+[['stat.total',status.stats.total],['stat.published',status.stats.published],['stat.draft',status.stats.draft],['stat.review',status.stats.review]].map(([name,n])=>'<div class="stat"><b>'+n+'</b><span>'+t(name)+'</span></div>').join('')+'</div><form class="filters" id="search"><input name="q" aria-label="'+t('list.search')+'" placeholder="'+t('list.searchPlaceholder')+'" value="'+esc(S.q)+'"><select name="state" aria-label="'+t('list.state')+'"><option value="">'+t('list.allStates')+'</option>'+['draft','review','approved','published'].map(v=>'<option value="'+v+'" '+(S.filter===v?'selected':'')+'>'+stateName(v)+'</option>').join('')+'</select><button>'+t('list.filter')+'</button></form><div class="list">'+(result.items.length?result.items.map(d=>'<div class="row"><div><h3>'+esc(d.title)+'</h3><small>'+esc(kindName(d.kind))+' · '+esc(d.category||d.domain)+' · v'+d.latest_revision+(d.published_revision&&d.published_revision!==d.latest_revision?t('list.liveVersion',{version:d.published_revision}):'')+'</small></div>'+badge(stateOf(d))+'<small class="updated">'+when(d.updated)+'</small><button class="open" data-open="'+d.id+'">'+t('list.edit')+'</button></div>').join(''):'<div class="empty"><h2>'+t(S.filter==='review'?'list.emptyReview':'list.empty')+'</h2><p>'+t(S.filter==='review'?'list.emptyReviewHint':'list.emptyHint')+'</p></div>')+'</div><div class="pagination"><span>'+t('list.pagination',{total:result.total,page:result.page,pages:result.pages})+'</span><div class="buttons"><button id="prev" '+(result.page<=1?'disabled':'')+'>'+t('list.prev')+'</button><button id="next" '+(result.page>=result.pages?'disabled':'')+'>'+t('list.next')+'</button></div></div>';
  main.querySelector('#search').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);S.q=f.get('q');S.filter=f.get('state');S.page=1;await listPage();};
  main.querySelector('#prev').onclick=()=>{S.page--;listPage();};main.querySelector('#next').onclick=()=>{S.page++;listPage();};
  for(const button of main.querySelectorAll('[data-open]'))button.onclick=()=>openEditor(button.dataset.open);
  main.querySelector('#new').onclick=()=>newEditor(S.kind||'year');
}
async function openEditor(id){S.doc=await api('/documents/'+id);S.dirty=false;editorPage();window.scrollTo(0,0);}
function newEditor(kind){
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
  const data=kind==='news'?{id:'news-'+crypto.randomUUID(),title:'',date:today,category:S.options.columns[0],author:S.options.site?.author||'Scholay 编辑部',summary:'',markdown:'',assets:[]}:kind==='year'?{title:'',category:S.options.yearCategories[0],tags:[],start:today,end:null,dateBasis:'',summary:'',body:'',sourceName:'',sourceUrl:'',provenance:'已核验'}:kind==='history'?{title:'',dateKey:today.slice(5),year:2000,domain:'',eventType:'',importance:'B',factSummary:'',historicalSignificance:'',sources:[],preciseToDay:true}:{title:'',date:today,category:S.options.sourceCategories[0],summary:'',value:'',url:'',relatedUrl:'',status:'公开收录'};
  S.doc={id:null,kind,data,latest_revision:0,published_revision:null,approved_revision:null,review_state:'draft',revisions:[]};S.dirty=false;editorPage();
}
// Options are plain values or [value,label] pairs when stored values differ from the visible text.
const field=(key,label,value,{type='text',area=false,hint='',options=null}={})=>'<label>'+label+(options?'<select name="'+key+'">'+options.map(o=>{const [v,text]=Array.isArray(o)?o:[o,o];return '<option value="'+esc(v)+'" '+(v===value?'selected':'')+'>'+esc(text)+'</option>';}).join('')+'</select>':area?'<textarea name="'+key+'" rows="'+(key==='body'?10:4)+'">'+esc(value)+'</textarea>':'<input name="'+key+'" type="'+type+'" value="'+esc(value)+'">')+(hint?'<span class="hint">'+hint+'</span>':'')+'</label>';
function editorPage() {
  const d=S.doc,x=d.data,k=d.kind;
  const fields=k==='news'?field('date',t('news.date'),x.date,{type:'date'})+field('category',t('news.category'),x.category,{options:S.options.columns})+field('author',t('news.author'),x.author)+field('summary',t('news.summary'),x.summary,{area:true})+field('markdown',t('news.markdown'),x.markdown,{area:true,hint:t('news.markdownHint')}):k==='year'?'<div class="two">'+field('category',t('year.category'),x.category,{options:S.options.yearCategories})+field('tags',t('year.tags'),x.tags.join('，'),{hint:t('year.tagsHint')})+'</div><div class="two">'+field('start',t('year.start'),x.start,{type:'date'})+field('end',t('year.end'),x.end,{type:'date'})+'</div>'+field('_repeat',t('year.repeat'),x.recurrence?'yearly':'once',{options:[['once',t('year.once')],['yearly',t('year.yearly')]]})+field('_leap',t('year.leap'),x.recurrence?.leapDay==='feb28'?'feb28':'skip',{options:[['skip',t('year.leapSkip')],['feb28',t('year.leapFeb28')]]})+field('dateBasis',t('year.dateBasis'),x.dateBasis,{hint:t('year.dateBasisHint')})+field('summary',t('year.summary'),x.summary,{area:true})+field('body',t('year.body'),x.body,{area:true})+'<div class="two">'+field('sourceName',t('year.sourceName'),x.sourceName)+field('provenance',t('year.provenance'),x.provenance,{options:['已核验','已核验官网'].map(v=>[v,t('provenance.'+v)])})+'</div>'+field('sourceUrl',t('year.sourceUrl'),x.sourceUrl,{type:'url'}):k==='history'?'<div class="two">'+field('dateKey',t('history.dateKey'),x.dateKey,{hint:t('history.dateKeyHint')})+field('year',t('history.year'),x.year,{type:'number'})+'</div><div class="two">'+field('domain',t('history.domain'),x.domain)+field('eventType',t('history.eventType'),x.eventType)+'</div>'+field('importance',t('history.importance'),x.importance,{options:['S','A','B']})+field('factSummary',t('history.factSummary'),x.factSummary,{area:true})+field('historicalSignificance',t(S.options.site?.siteId==='scholay-today'?'history.academicSignificance':'history.significance'),x.historicalSignificance,{area:true})+field('sources',t('history.sources'),x.sources.map(s=>s.label+' | '+s.url).join('\n'),{area:true,hint:t('history.sourcesHint')})+'<label class="field-check"><input type="checkbox" name="preciseToDay" '+(x.preciseToDay?'checked':'')+'>'+t('history.precise')+'</label>':'<div class="two">'+field('date',t('source.date'),x.date,{type:'date'})+field('category',t('source.category'),x.category,{options:S.options.sourceCategories})+'</div>'+field('summary',t('source.summary'),x.summary,{area:true})+field('value',t('source.value'),x.value,{area:true})+field('url',t('source.url'),x.url,{type:'url'})+field('relatedUrl',t('source.relatedUrl'),x.relatedUrl,{type:'url'})+field('status',t('source.status'),x.status);
  document.querySelector('#main').innerHTML='<a href="#" id="back" class="back">'+t('editor.back')+'</a>'+heading(t(d.id?'editor.edit':'editor.new'),kindName(k)+' · '+(d.id?'v'+d.latest_revision:t('editor.unsaved')))+'<div class="editor"><section><form id="editor-form" class="panel fields">'+(!d.id?field('_kind',t('editor.kind'),k,{options:Object.keys(names).map(v=>[v,kindName(v)])}):'')+field('title',t('editor.title'),x.title)+fields+'</form><details class="panel preview" open><summary>'+t('editor.preview')+'</summary><article id="preview"></article></details>'+(d.published?'<details class="panel preview"><summary>'+t('editor.compareLive',{version:d.published_revision})+'</summary><article>'+preview(d.published,k)+'</article></details>':'')+'</section><aside class="editor-aside"><section class="panel"><h3>'+t('editor.reviewPublish')+'</h3><div id="edit-status" class="statusline">'+badge(stateOf(d))+'</div><p id="save-status">'+t('editor.saveHint')+'</p><div class="buttons"><button id="save" class="primary">'+t('editor.save')+'</button><button id="review">'+t('editor.submitReview')+'</button><button id="approve">'+t('editor.approve')+'</button></div><label>'+t('editor.schedule')+'<input id="scheduled" type="datetime-local"><span class="hint">'+t('editor.scheduleHint')+'</span></label><div class="buttons"><button id="publish" '+(d.approved_revision!==d.latest_revision||!d.id?'disabled':'')+'>'+t('editor.queue')+'</button>'+(d.published_revision?'<button id="withdraw" class="danger">'+t('editor.withdraw')+'</button>':'')+'</div><p class="connection">'+t('editor.lock')+'</p></section><section class="panel"><h3>'+t('editor.history')+'</h3><div id="revisions">'+(d.revisions?.map(r=>'<div class="revision"><div><b>v'+r.version+'</b><small> · '+esc(r.actor)+'</small><br><small>'+esc(noteText(r.note))+'<br>'+when(r.created)+'</small></div>'+(r.version!==d.latest_revision?'<button data-restore="'+r.version+'">'+t('editor.restore')+'</button>':'')+'</div>').join('')||'<p>'+t('editor.historyEmpty')+'</p>')+'</div></section></aside></div>';
  const form=document.querySelector('#editor-form');
  if(!d.id){const select=form.elements._kind;select.onchange=()=>{if(S.dirty&&!confirm(t('confirm.switchKind'))){select.value=k;return;}newEditor(select.value);};}
  form.onsubmit=e=>e.preventDefault();
  form.oninput=()=>{S.dirty=true;document.querySelector('#publish').disabled=true;document.querySelector('#save-status').textContent=t('editor.dirty');updatePreview();clearTimeout(S.autosave);if(S.doc.id)S.autosave=setTimeout(()=>saveEditor(false).catch(e=>{document.querySelector('#save-status').textContent=t('editor.notSaved',{error:e.message});}),2500);};
  document.querySelector('#back').onclick=async e=>{e.preventDefault();if(S.dirty){try{await saveEditor(false);}catch{if(!confirm(t('confirm.leave')))return;}}S.doc=null;S.dirty=false;await listPage();};
  document.querySelector('#save').onclick=()=>saveEditor(true).catch(e=>notify(e.message));
  document.querySelector('#review').onclick=()=>review('review');document.querySelector('#approve').onclick=()=>review('approved');
  document.querySelector('#publish').onclick=()=>publish('publish');
  if(document.querySelector('#withdraw'))document.querySelector('#withdraw').onclick=()=>{if(confirm(t('confirm.withdraw')))publish('withdraw');};
  for(const b of document.querySelectorAll('[data-restore]'))b.onclick=async()=>{try{if(S.dirty)await saveEditor(false);await post('/documents/'+S.doc.id+'/restore',{version:S.doc.latest_revision,restore:Number(b.dataset.restore)});await openEditor(S.doc.id);notify(t('notice.restored'));}catch(e){notify(e.message);}};
  updatePreview();
}
function editorData(){
  const form=document.querySelector('#editor-form'),v=Object.fromEntries(new FormData(form)),k=S.doc.kind;
  delete v._kind;
  if(k==='year'){v.tags=v.tags.split(/[,，]/).map(s=>s.trim()).filter(Boolean);v.end=v.end||null;v.bodyTruncated=S.doc.data.bodyTruncated||false;if(v._repeat==='yearly')v.recurrence={frequency:'yearly',monthDay:v.start.slice(5),leapDay:v._leap==='feb28'?'feb28':'skip'};delete v._repeat;delete v._leap;}
  if(k==='history'){v.year=Number(v.year);v.preciseToDay=form.elements.preciseToDay.checked;v.sources=v.sources.split('\n').filter(s=>s.trim()).map(line=>{const split=line.indexOf('|');return split<0?{label:'原始来源',url:line.trim()}:{label:line.slice(0,split).trim(),url:line.slice(split+1).trim()};});}
  if(k==='news'){v.id=S.doc.data.id;v.assets=[];}
  return v;
}
function preview(x,k){if(k==='news')return '<h2>'+esc(x.title)+'</h2><p>'+esc(x.summary)+'</p><pre style="white-space:pre-wrap">'+esc(x.markdown)+'</pre>';const text=k==='history'?x.factSummary:x.summary,extra=k==='year'?x.body:k==='history'?x.historicalSignificance:x.value;const links=k==='history'?x.sources:[{label:x.sourceName||t('preview.projectPage'),url:x.sourceUrl||x.url}];return '<small>'+esc(k==='year'?(x.start+(x.end?' — '+x.end:'')):k==='history'?t('preview.historyDate',{year:x.year,date:x.dateKey}):x.date)+'</small><h2>'+esc(x.title||t('preview.noTitle'))+'</h2><p>'+esc(text||t('preview.noSummary'))+'</p>'+(extra?'<p>'+esc(extra)+'</p>':'')+links.filter(s=>s.url).map(s=>'<a href="'+esc(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer">'+esc(s.label||s.url)+' ↗</a>').join('');}
function updatePreview(){try{document.querySelector('#preview').innerHTML=preview(editorData(),S.doc.kind);}catch{}}
async function saveEditor(render=false){
  clearTimeout(S.autosave);if(S.save)await S.save;
  if(!S.doc||!document.querySelector('#editor-form'))return;
  if(!S.dirty&&S.doc.id){if(render)notify(t('notice.alreadySaved'));return;}
  const data=editorData(),serialized=JSON.stringify(data),doc=S.doc;
  S.save=(async()=>{
    const result=doc.id?await api('/documents/'+doc.id,{method:'PUT',data:{data,version:doc.latest_revision}}):await post('/documents',{kind:doc.kind,data});
    S.doc={...result,revisions:doc.revisions||[]};S.dirty=JSON.stringify(editorData())!==serialized;
    document.querySelector('#save-status').textContent=t('editor.saved',{version:result.latest_revision,time:new Date().toLocaleTimeString(locale)});document.querySelector('#edit-status').innerHTML=badge(stateOf(result));
    document.querySelector('#publish').disabled=true;
    if(render&&!S.dirty){await openEditor(result.id);notify(t('notice.draftSaved'));}
  })();try{await S.save;}finally{S.save=null;}
}
async function review(state){try{await saveEditor(false);if(S.dirty)await saveEditor(false);const doc=await post('/documents/'+S.doc.id+'/review',{version:S.doc.latest_revision,state});await openEditor(doc.id);notify(t(state==='approved'?'notice.approved':'notice.submitted'));}catch(e){notify(e.message);}}
async function publish(action){try{if(action==='publish'&&S.dirty)throw new Error(t('error.saveFirst'));if(action==='withdraw'&&S.dirty)await saveEditor(false);const schedule=document.querySelector('#scheduled').value;await post('/documents/'+S.doc.id+'/queue',{version:action==='withdraw'?S.doc.published_revision:S.doc.latest_revision,action,scheduled:schedule?new Date(schedule).toISOString():null});notify(t('notice.queued'));S.dirty=false;await navigate('queue');}catch(e){notify(e.message);}}
async function queuePage(){
  clearTimeout(S.queueTimer);
  const [jobs,status]=await Promise.all([api('/jobs'),api('/status')]);const online=status.worker&&Date.now()-status.worker.seen<90000;
  document.querySelector('#main').innerHTML=heading(t('queue.title'),t('queue.subtitle'),'<button id="refresh">'+t('queue.refresh')+'</button>')+'<p class="connection '+(online?'':'offline')+'">'+t(online?'queue.online':'queue.offline')+'</p><div class="list">'+(jobs.length?jobs.map(j=>'<article class="job"><div class="job-top"><h3>'+(j.itemCount>1?t('queue.batch',{count:j.itemCount}):j.document_id===null?t('queue.siteRebuild'):esc(j.title))+'</h3>'+badge(j.status)+'</div><p>'+t(j.action==='withdraw'?'queue.withdraw':'queue.publish')+' v'+j.revision+t('queue.scheduled',{time:when(j.scheduled)})+(j.finished?t('queue.finished',{time:when(j.finished)}):'')+'</p>'+(j.error?'<p class="error">'+esc(j.error)+'</p>':'')+'<div class="buttons"><button data-open="'+j.document_id+'">'+t('queue.view')+'</button>'+(j.status==='queued'?'<button data-cancel="'+j.id+'">'+t('queue.cancel')+'</button>':'')+(j.status==='failed'?'<button data-retry="'+j.id+'">'+t('queue.retry')+'</button>':'')+'</div></article>').join(''):'<div class="empty"><h2>'+t('queue.empty')+'</h2><p>'+t('queue.emptyHint')+'</p></div>')+'</div>';
  document.querySelector('#refresh').onclick=queuePage;
  for(const b of document.querySelectorAll('[data-open]'))b.onclick=()=>openEditor(b.dataset.open);
  for(const b of document.querySelectorAll('[data-cancel],[data-retry]'))b.onclick=async()=>{try{const action=b.dataset.cancel?'cancel':'retry';await post('/jobs/'+(b.dataset.cancel||b.dataset.retry)+'/'+action);await queuePage();}catch(e){notify(e.message);}};
  if(jobs.some(j=>['queued','running'].includes(j.status)))S.queueTimer=setTimeout(()=>{if(S.view==='queue'&&!S.doc&&S.user)queuePage().catch(e=>notify(e.message));},5000);
}
async function auditPage(){const rows=await api('/audit');document.querySelector('#main').innerHTML=heading(t('audit.title'),t('audit.subtitle'))+'<div class="list">'+rows.map(r=>'<div class="audit-row"><span>'+when(r.at)+'</span><span>'+esc(r.actor)+'</span><span>'+esc(Object.hasOwn(ADMIN_MESSAGES.zh,'action.'+r.action)?t('action.'+r.action):r.action)+(r.detail?' · '+esc(r.detail):'')+'</span></div>').join('')+'</div>';}
async function settingsPage(){
  const [sessions,tokens]=await Promise.all([api('/sessions'),api('/tokens')]);
  document.querySelector('#main').innerHTML=heading(t('settings.title'),t('settings.subtitle'))+'<div class="settings"><section class="panel"><h2>'+t('settings.password')+'</h2><form id="password-form">'+field('current',t('settings.current'),'',{type:'password'})+field('password',t('settings.new'),'',{type:'password',hint:t('settings.newHint')})+'<button class="primary">'+t('settings.passwordSubmit')+'</button></form></section><section class="panel"><h2>'+t('settings.devices')+'</h2>'+sessions.map(s=>'<div class="revision"><div><b>'+t(s.current?'settings.thisDevice':'settings.otherDevice')+'</b><p>'+esc(s.ip)+' · '+when(s.seen)+'<br>'+esc(s.agent)+'</p></div></div>').join('')+'<button id="revoke-sessions">'+t('settings.revokeOthers')+'</button></section><section class="panel"><h2>'+t('settings.tokens')+'</h2><p>'+t('settings.tokensIntro')+'</p><form id="token-form">'+field('name',t('settings.tokenName'),'',{hint:t('settings.tokenHint')})+'<button>'+t('settings.createToken')+'</button></form><div id="token-reveal"></div>'+tokens.map(token=>'<div class="revision"><div><b>'+esc(token.name)+'</b><br><small>'+(token.revoked?t('settings.revoked'):t('settings.lastUsed',{time:when(token.last_used)}))+'</small></div>'+(!token.revoked?'<button data-revoke="'+token.id+'">'+t('settings.revoke')+'</button>':'')+'</div>').join('')+'</section></div>';
  const pf=document.querySelector('#password-form');pf.elements.current.autocomplete='current-password';pf.elements.password.autocomplete='new-password';
  pf.onsubmit=async e=>{e.preventDefault();try{await post('/password',Object.fromEntries(new FormData(pf)));S.user=null;loginPage();notify(t('notice.passwordChanged'));}catch(error){notify(error.message);}};
  document.querySelector('#revoke-sessions').onclick=async()=>{await post('/sessions/revoke');notify(t('notice.othersSignedOut'));await settingsPage();};
  document.querySelector('#token-form').onsubmit=async e=>{e.preventDefault();try{const result=await post('/tokens',Object.fromEntries(new FormData(e.target)));await settingsPage();document.querySelector('#token-reveal').innerHTML='<div class="token-reveal"><p>'+t('settings.tokenReveal')+'</p><code>'+esc(result.token)+'</code></div>';}catch(error){notify(error.message);}};
  for(const b of document.querySelectorAll('[data-revoke]'))b.onclick=async()=>{await post('/tokens/'+b.dataset.revoke+'/revoke');await settingsPage();};
}
window.addEventListener('beforeunload',event=>{if(S.dirty){event.preventDefault();event.returnValue='';}});
(async()=>{try{publicSite=await api('/site');if(publicSite.kinds)Object.assign(names,publicSite.kinds);const result=await api('/session');if(!result.user)return loginPage(result.initialized);S.user=result.user;S.csrf=result.csrf;S.options=await api('/options');await renderShell();}catch(error){app.textContent=t('app.unavailable');notify(error.message);}})();
