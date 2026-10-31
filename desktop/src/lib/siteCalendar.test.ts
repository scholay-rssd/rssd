import {expect,it} from 'vitest';
import {siteCalendarEvents} from '../calendar/siteCalendar';
const annual={kind:'year',id:'annual',title:'有来源的闰日惯例',category:'纪念日',start:'2024-02-29',recurrence:{frequency:'yearly',monthDay:'02-29',leapDay:'skip'}};
it('keeps explicit annual recurrence separate from one-off dated records',()=>{
 const event={...annual,id:'one-off',recurrence:undefined,start:'2024-04-23'};
 expect(siteCalendarEvents([annual,event],2025).map(x=>x.id)).toEqual(['one-off']);
 expect(siteCalendarEvents([annual],2028)[0].start).toEqual({year:2028,month:2,day:29});
 expect(siteCalendarEvents([{...annual,recurrence:{...annual.recurrence,leapDay:'feb28'}}],2025)[0].start).toEqual({year:2025,month:2,day:28});
 expect(siteCalendarEvents([event],2025)[0].start.year).toBe(2024);
});
