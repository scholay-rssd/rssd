const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function annualDate(item,year){
  if(item.recurrence?.frequency!=='yearly')return item.start;
  const day=item.recurrence.monthDay,date=year+'-'+day;
  if(validDate(date))return date;
  return day==='02-29'&&item.recurrence.leapDay==='feb28'?year+'-02-28':null;
}
export function eventMatches(event,iso,mode){
  if(!validDate(iso))return false;
  if(mode==='history')return event?.mode==='historical'&&event.monthDay===iso.slice(5);
  if(event?.mode==='annual')return annualDate(event,Number(iso.slice(0,4)))===iso;
  if(event?.mode!=='scheduled'||!validDate(event.start))return false;
  const end=String(event.dateBasis||'').includes('发布日期')?event.start:event.end||event.start;
  return iso>=event.start&&iso<=end;
}
