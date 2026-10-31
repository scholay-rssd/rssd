#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const yearKeys=[
 'id','title','category','tags','start','end','dateBasis','summary',
 'body','bodyTruncated','sourceName','sourceUrl','provenance','reviewedAt'
];
const isoDate=/^\d{4}-\d{2}-\d{2}$/;
const safeUrl=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:null}catch{return null}};

export const readYearCategories=source=>{
 const match=String(source).match(/const yearCategories=\[((?:'[^']*',?)*)\]/);
 if(!match)throw new Error('Could not read yearCategories from app.js');
 return [...match[1].matchAll(/'([^']+)'/g)].map(item=>item[1]);
};

export const validateItem=(item,yearCategories)=>{
 if(!item||typeof item!=='object'||Array.isArray(item))return 'item must be an object';
 const keys=Object.keys(item);
 if(keys.length!==yearKeys.length||yearKeys.some(key=>!Object.hasOwn(item,key))){
  return 'item must have the 14 year fields';
 }
 if(!yearCategories.includes(item.category))return 'category is not a yearCategories value';
 if(!isoDate.test(item.start)||item.end!==null&&!isoDate.test(item.end))return 'start/end must be YYYY-MM-DD';
 if(!safeUrl(item.sourceUrl))return 'sourceUrl must be http or https';
 return null;
};

export const mergeEditorial=(year,items,yearCategories)=>{
 const next=year.slice();
 const indexById=new Map(next.map((item,index)=>[item.id,index]));
 let added=0,updated=0,skipped=0;
 const messages=[];
 for(const item of items){
  const error=validateItem(item,yearCategories);
  if(error){
   skipped++;
   messages.push('invalid '+(item&&item.id||'(missing id)')+': '+error);
   continue;
  }
  const existing=indexById.get(item.id);
  if(existing!==undefined){
   next[existing]=item;
   updated++;
   continue;
  }
  const duplicate=next.find(row=>row.sourceUrl===item.sourceUrl&&row.start===item.start);
  if(duplicate){
   skipped++;
   messages.push('skip '+item.id+': same sourceUrl and start as '+duplicate.id);
   continue;
  }
  indexById.set(item.id,next.length);
  next.push(item);
  added++;
 }
 return {year:next,added,updated,skipped,messages};
};

export const applyEditorial=(data,items,yearCategories)=>{
 const result=mergeEditorial(data.year,items,yearCategories);
 return {
  data:{
   ...data,
   year:result.year,
   counts:{
    ...data.counts,
    year:result.year.length,
    official:result.year.filter(item=>item.provenance==='已核验官网').length
   }
  },
  added:result.added,
  updated:result.updated,
  skipped:result.skipped,
  messages:result.messages
 };
};

const writeAtomic=(file,text)=>{
 const tmp=file+'.'+process.pid+'.tmp';
 fs.writeFileSync(tmp,text);
 fs.renameSync(tmp,file);
};

const run=()=>{
 const dataPath=path.resolve('data.json');
 const editorialPath=path.resolve('content/editorial-items.json');
 const yearCategories=readYearCategories(fs.readFileSync(path.resolve('web/themes/academic/public/app.js'),'utf8'));
 const data=JSON.parse(fs.readFileSync(dataPath,'utf8'));
 const editorial=JSON.parse(fs.readFileSync(editorialPath,'utf8'));
 const result=applyEditorial(data,editorial.items||[],yearCategories);
 writeAtomic(dataPath,JSON.stringify(result.data));
 console.log('Merged editorial batch '+(editorial.batch||'')+': added '+result.added+', updated '+result.updated+', skipped '+result.skipped+'; year '+result.data.counts.year+' ('+result.data.counts.official+' official)');
 for(const message of result.messages)console.log(message);
};

const isMain=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain)run();
