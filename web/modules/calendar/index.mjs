import {escapeHtml as esc,moduleAsset} from '../shared.mjs';
export const calendarModule={
  id:'calendar',version:1,contentVersion:1,requires:['events'],route:'/calendar/',label:'日历',
  async render({host,options,now}){
    const records=host.records(options).filter(x=>x.type==='event');
    const year=new Intl.DateTimeFormat('en',{year:'numeric',timeZone:host.timezone}).format(now);
    const links=records.map(x=>`<li><a href="${esc(host.permalink(x))}">${esc(x.title)}</a></li>`).join('');
    return {title:'日历',body:`<section class="hero compact"><p class="eyebrow">一年里的每一天</p><h1>循着日期，发现故事。</h1><p>年度惯例与历史事件分开呈现。未收录的日期保持空白。</p></section><section class="calendar-panel"><div class="calendar-toolbar"><button id="previous-year" aria-label="上一年">←</button><h2 id="calendar-year">${year}</h2><button id="next-year" aria-label="下一年">→</button><label>内容 <select id="calendar-mode"><option value="year">年度惯例与日程</option><option value="history">历史上的这一天</option></select></label></div><div id="year-grid"></div><section id="day-details" aria-live="polite"><h2>选择一个日期</h2><p>查看当天收录的日程与历史事件。</p></section></section><noscript><h2>日程与历史记录</h2><ul>${links}</ul></noscript>`,
      styles:['/display/calendar/style.css'],scripts:['/site-calendar.js'],
      files:{'site-calendar.js':await moduleAsset('./calendar/client.js'),'display/calendar/model.js':await moduleAsset('./calendar/model.mjs'),'display/calendar/style.css':await moduleAsset('./calendar/style.css'),'display/calendar/content.json':JSON.stringify({timezone:host.timezone,records:records.map(x=>({id:x.id,title:x.title,route:host.permalink(x),summary:x.summary,event:x.event}))})}};
  },
};
