import {eventMatches} from '/display/calendar/model.js';
const response=await fetch('/display/calendar/content.json');
if(!response.ok){document.querySelector('#day-details').textContent='日历数据暂时不可用，请刷新重试。';throw Error('日历数据暂时不可用');}
const {records,timezone}=await response.json();
let year=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:timezone}).format(new Date()));
const grid=document.querySelector('#year-grid'),mode=document.querySelector('#calendar-mode'),details=document.querySelector('#day-details');
const pad=n=>String(n).padStart(2,'0');
function matches(x,key){return eventMatches(x.event,year+'-'+key,mode.value);}
function select(key,button){
 grid.querySelectorAll('[aria-pressed=true]').forEach(x=>x.setAttribute('aria-pressed','false'));button.setAttribute('aria-pressed','true');
 details.replaceChildren();const heading=document.createElement('h2');heading.textContent=key+' · '+(mode.value==='history'?'历史上的这一天':year+' 年日程');details.append(heading);
 const items=records.filter(x=>matches(x,key));
 for(const item of items){const a=document.createElement('a');a.href=item.route;a.textContent=(item.event.mode==='historical'?item.event.year+' 年 · ':item.event.mode==='annual'?'每年 · ':'')+item.title;details.append(a);const p=document.createElement('p');p.textContent=item.summary||item.factSummary||'';details.append(p);}
 if(!items.length){const p=document.createElement('p');p.textContent='这一天尚未收录内容。';details.append(p);}
}
function render(){
 document.querySelector('#calendar-year').textContent=year;grid.replaceChildren();details.replaceChildren();
 for(let m=1;m<=12;m++){const section=document.createElement('section');section.className='month';const h=document.createElement('h3');h.textContent=pad(m)+' 月';section.append(h);const days=document.createElement('div');days.className='month-grid';
 for(const name of ['一','二','三','四','五','六','日']){const el=document.createElement('span');el.textContent=name;days.append(el);}
 for(let i=0;i<(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7;i++)days.append(document.createElement('span'));
 for(let d=1;d<=new Date(Date.UTC(year,m,0)).getUTCDate();d++){const key=pad(m)+'-'+pad(d),items=records.filter(x=>matches(x,key)),b=document.createElement('button');b.className='day'+(items.length?' has-items':'');b.textContent=d;b.setAttribute('aria-label',year+' 年 '+m+' 月 '+d+' 日，'+items.length+' 条记录');b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>select(key,b));days.append(b);}
 section.append(days);grid.append(section);}
}
document.querySelector('#previous-year').onclick=()=>{if(year>2){year--;render();}};
document.querySelector('#next-year').onclick=()=>{if(year<9998){year++;render();}};
mode.onchange=render;render();
