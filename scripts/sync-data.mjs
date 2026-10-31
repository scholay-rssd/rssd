#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const source=path.resolve(process.argv[2] || path.join(import.meta.dirname,'../desktop/src/calendar'));
const project=path.resolve(source,'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(source,name),'utf8'));
const officialNames=[
 'yearOfficialSeeds.json','yearOfficialNationalSeeds.json','yearOfficialTalentSeeds.json',
 'yearOfficialHumanitiesSeeds.json','yearOfficialMoeSeeds.json','yearOfficialPostdocHistorySeeds.json',
 'yearOfficialEducationPlanningSeeds.json','yearOfficialInternationalTalentSeeds.json',
 'yearOfficialArtsSeeds.json','yearOfficialRecurringSeeds.json','yearOfficialArtsFundSeeds.json',
 'yearOfficialYouthFundSeeds.json','yearOfficialNsfcGrowthSeeds.json',
 'yearOfficialConferenceBodySeeds.json','yearOfficialCastTalentSeeds.json',
 'yearOfficialCscTalentSeeds.json','yearOfficialCampusSeeds.json'
];
const legacyNames=[
 'yearProgramSeeds.json','yearWindowSeeds.json','yearTalentSeeds.json',
 'yearLocalSeeds.json','yearSocialSeeds.json','yearSeeds.json'
];
const cache=read('yearOfficialBodyCache.json');
const canonical=value=>{try{const url=new URL(value);url.hash='';return url.href}catch{return null}};
const bodies=new Map(cache.entries.map(x=>[x.articleId+'\0'+canonical(x.sourceUrl),x]));
const attach=seed=>{
 const key=seed.article.id+'\0'+canonical(seed.article.url);
 const entry=bodies.get(key);
 return entry&&!seed.article.body?{...seed,article:{...seed.article,body:entry.body,bodyTruncated:Boolean(entry.truncated)}}:seed;
};
const seeds=[...officialNames.flatMap(read),...legacyNames.flatMap(read)].map(attach);

// Reuse the desktop application's date parsing, categorization and deduplication.
const pnpm=path.join(project,'node_modules/.pnpm');
const esbuildDir=fs.readdirSync(pnpm).find(name=>/^esbuild@/.test(name));
if(!esbuildDir)throw new Error('RSSD dependencies are not installed; esbuild is required for the manual export.');
const esbuild=path.join(pnpm,esbuildDir,'node_modules/esbuild/bin/esbuild');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'scholay-today-export-'));
let growYearEvents,pickGrowQueries,nationalHolidays;
try{
 const yearModule=path.join(temp,'year.mjs');
 const holidayModule=path.join(temp,'holidays.mjs');
 execFileSync(esbuild,[path.join(source,'yearGrow.ts'),'--bundle','--platform=node','--format=esm','--outfile='+yearModule],{stdio:'ignore'});
 execFileSync(esbuild,[path.join(source,'nationalHolidays.ts'),'--bundle','--platform=node','--format=esm','--outfile='+holidayModule],{stdio:'ignore'});
 ({growYearEvents,pickGrowQueries}=await import('file://'+yearModule));
 ({nationalHolidays}=await import('file://'+holidayModule));
}finally{fs.rmSync(temp,{recursive:true,force:true})}
const nowYear=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric'}).format(new Date()));
const dbPath=process.env.SCHOLAY_TODAY_DB || path.join(os.homedir(),'Library/Application Support/com.thomas.papr/papr.db');
const sql=query=>JSON.parse(execFileSync('sqlite3',['-json',dbPath,query],{encoding:'utf8',maxBuffer:20*1024*1024})||'[]');
let dynamic=[];
if(fs.existsSync(dbPath)){
 const folders=sql('select id,name from folders');
 const feeds=sql('select id,title,folder_id as folderId from feeds');
 for(const item of pickGrowQueries(folders,feeds)){
  const field=item.query.kind==='folder'?'f.folder_id':'f.id';
  const rows=sql('select a.id,f.title as feedTitle,a.title,substr(a.body_text,1,280) as snippet,a.url,a.published_at as publishedAt from articles a join feeds f on f.id=a.feed_id where '+field+'='+Number(item.query.value)+' order by datetime(coalesce(a.published_at,a.fetched_at)) desc,a.id desc limit 400');
  dynamic.push(...rows.map(article=>({article,lane:item.lane,provenance:{origin:'rss',verification:'unverified'}})));
 }
}
const events=[...nationalHolidays(nowYear),...growYearEvents([...seeds,...dynamic])];
const safeUrl=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:null}catch{return null}};
const iso=part=>part.year+'-'+String(part.month).padStart(2,'0')+'-'+String(part.day||1).padStart(2,'0');
const year=events.map(event=>{
 const p=event.payload||{};
 const status=event.id.startsWith('holiday:')||p.provenance?.verification==='verified'&&p.provenance?.sourceTier==='official'?'已核验官网':
   p.provenance?.verification==='needs_review'?'待核验':'来源待核验';
 const basis=p.meta==='发布'||p.meta==='官方发布'?'发布日期（事件日期未核实）':p.meta||'日期依据待核实';
 const body=(p.body||'').trim();
 return {
  id:event.id+':'+iso(event.start),title:event.title.replace(/^\[[^\]]+\]\s*/,''),category:event.tags.includes('节假日')?'节假日':event.tags[0]||'其他',tags:event.tags,
  start:iso(event.start),end:event.end?iso(event.end):null,dateBasis:basis,
  summary:p.summary||p.body?.slice(0,180)||'',body:body.slice(0,16000),
  bodyTruncated:body.length>16000||Boolean(p.bodyTruncated),
  sourceName:p.sourceName||'',sourceUrl:safeUrl(p.sourceUrl),
  provenance:status,reviewedAt:p.provenance?.reviewedAt||null
 };
});
const history=read('historyEvents.json').map((item,index)=>({
 id:crypto.createHash('sha1').update(item.dateKey+':'+item.year+':'+item.title+':'+index).digest('hex').slice(0,14),
 ...item,sources:(item.sources||[]).filter(s=>safeUrl(s.url))
}));
history.sort((a,b)=>a.dateKey.localeCompare(b.dateKey)||a.year-b.year);
if(new Set(year.map(item=>item.id)).size!==year.length || new Set(history.map(item=>item.id)).size!==history.length){
 throw new Error('Export produced duplicate article IDs');
}
const output={
 version:1,exportedAt:new Date().toISOString(),source:'scholay-today/src/calendar',
 localFeedSnapshot:dynamic.length>0,
 counts:{year:year.length,official:year.filter(x=>x.provenance==='已核验官网').length,history:history.length},
 year,history
};
fs.writeFileSync(path.resolve('data.json'),JSON.stringify(output));
console.log('Wrote data.json: '+output.counts.year+' year events ('+output.counts.official+' reviewed), '+output.counts.history+' history events; '+dynamic.length+' local RSS candidates');
