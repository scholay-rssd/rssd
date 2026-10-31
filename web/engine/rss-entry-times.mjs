import {createHash} from 'node:crypto';
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
// RSS recency follows source-content changes. A theme, brand or discussion-link
// change must not rotate the first twenty old calendar/history records.
export function rssEntryTimes(previous={},pages={},now=new Date()){
 const entries={},clock=new Date(now).toISOString();
 return {
  entries,
  updated(route,item){
   if(entries[route])return entries[route].updated;
   const hash=createHash('sha256').update(JSON.stringify(stable(item))).digest('hex'),old=previous[route];
   const updated=old?.hash===hash?old.updated:old?clock:pages[route]?.lastmod||clock;
   if(!Number.isFinite(Date.parse(updated)))throw Error('Invalid RSS entry timestamp');
   entries[route]={hash,updated};return updated;
  }
 };
}
