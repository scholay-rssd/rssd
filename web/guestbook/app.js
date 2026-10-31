const $=s=>document.querySelector(s);let state,key=crypto.randomUUID(),busy=false;
const form=$('#form');
async function api(url,options){const r=await fetch(url,options);const b=await r.json();if(!r.ok)throw Error(b.error||'请求失败');return b;}
function quota(){ $('#quota').textContent=`今天还可留言 ${state.remaining} 条 · ${state.config.timezone}`;$('#send').disabled=busy||state.remaining===0; }
function fields(){const selected=state.config.forms.find(f=>f.id===$('#kind').value);$('#details').replaceChildren();for(const f of selected.fields){const label=document.createElement('label');label.textContent=f.label+(f.required?' *':'');const control=document.createElement(f.max>500?'textarea':'input');control.name='detail:'+f.key;control.required=f.required;control.maxLength=f.max;label.append(control);$('#details').append(label);}}
async function wall(){const {messages}=await api('/guestbook/api/messages');const box=$('#messages');box.replaceChildren();if(!messages.length){const p=document.createElement('p');p.className='empty';p.textContent='还没有公开留言，欢迎留下第一条。';box.append(p);return;}for(const m of messages){const article=document.createElement('article');article.className='note';const title=document.createElement('h3');title.textContent=m.name;const kind=document.createElement('span');kind.className='pill';kind.textContent=state.config.forms.find(f=>f.id===m.kind)?.label||'留言';title.append(kind);const text=document.createElement('p');text.textContent=m.message;const date=document.createElement('small');date.textContent=new Date(m.created).toLocaleDateString('zh-CN',{timeZone:state.config.timezone});article.append(title,text,date);box.append(article);}}
function configure(config){document.title=config.name+' · 留言板';$('#site').textContent=config.name+' / 留言板';$('#home').href=config.home;document.documentElement.style.setProperty('--accent',config.accent);$('#kind').replaceChildren();for(const f of config.forms){const opt=document.createElement('option');opt.value=f.id;opt.textContent=f.label;$('#kind').append(opt);}fields();}
async function start(){
 // Static configuration and approved messages remain readable while the center
 // is offline. Only a valid live session enables a visitor to submit a message.
 const publicConfig=await api('/guestbook/config.json').catch(()=>null);
 if(publicConfig){state={config:publicConfig,remaining:0};configure(publicConfig);await wall().catch(e=>{$('#messages').textContent=e.message;});}
 try{state=await api('/guestbook/api/session');configure(state.config);$('#kind').disabled=false;fields();quota();if(!publicConfig)await wall();}
 catch(e){$('#status').textContent=e.message;$('#quota').textContent='暂时无法提交留言，请稍后重试';}
}
$('#kind').addEventListener('change',fields);
form.addEventListener('submit',async e=>{e.preventDefault();if(busy||!state)return;busy=true;quota();const values=new FormData(form);const payload={kind:values.get('kind'),name:values.get('name'),message:values.get('message'),contact:values.get('contact'),details:Object.fromEntries([...values].filter(([k])=>k.startsWith('detail:')).map(([k,v])=>[k.slice(7),v])),requestKey:key};try{const result=await api('/guestbook/api/messages',{method:'POST',headers:{'content-type':'application/json','x-guestbook-csrf':state.csrf},body:JSON.stringify(payload)});state.remaining=result.remaining;key=crypto.randomUUID();form.reset();fields();$('#status').textContent='已收到，审核后会出现在留言墙。补充信息仅站长可见。';}catch(e){$('#status').textContent=e.message;}finally{busy=false;quota();}});
start();
