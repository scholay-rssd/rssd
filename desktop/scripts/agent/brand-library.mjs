import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {profiles} from '../../../scripts/site-config.mjs';
import {optionalJson,atomicJson} from '../../../scripts/editorial-sync.mjs';
import {withFileLock} from '../../../scripts/editorial-lock.mjs';
import {brandEndnoteText,refreshBrandIdentity} from '../../../contracts/brand-endnotes.mjs';

export function brandSeeds(){
 const brand=(id,name,url,text,description='',slogan='')=>({id,version:1,name,slogan,description:[description,`品牌链接：${url}`].filter(Boolean).join('\n'),voice:'使用固定尾注文案，保留品牌名称、完整链接及 slogan。',endnotes:[{id:id+':footer',label:'官网入口',text:brandEndnoteText({id,name,slogan,description,endnotes:[]},{text})}]});
 return [
  brand('scholay-platform','Scholay 学术一站式平台','https://www.scholay.com/t/M4ZZW8KRE5','信息由 [Scholay 学术一站式平台](https://www.scholay.com/t/M4ZZW8KRE5) 整理并发表，如有侵权请反馈下架。'),
  brand('enterscholar','恩特学术','https://enterscholar.com','信息同步发表于[恩特学术](https://enterscholar.com)，智能时代的学者社区','智能时代的学者社区。','智能时代的学者社区'),
  ...profiles.map(s=>brand('site:'+s.id,s.name,s.origin,`[${s.name}](${s.origin})`,s.description,s.slogan)),
 ];
}
// Pets carries only its own brand. scholay-today's own brand is Scholay, so it
// is not listed twice. Other sites mount own brand + Scholay + 恩特学术.
const OWN_BRAND_ONLY=new Set(['pets']);
export function siteBrandIds(siteId){
 if(typeof siteId!=='string'||!/^[a-z][a-z0-9-]{1,48}$/.test(siteId))throw Error('站点编号无效');
 if(OWN_BRAND_ONLY.has(siteId))return ['site:'+siteId];
 if(siteId==='scholay-today')return ['scholay-platform','enterscholar'];
 return ['site:'+siteId,'scholay-platform','enterscholar'];
}
export function siteBrandMounts(siteId,brands=brandSeeds()){
 const seeds=brandSeeds();
 return siteBrandIds(siteId).map(id=>{
  const seed=seeds.find(b=>b.id===id);
  const direct=brands.find(b=>b.id===id);
  const matches=direct?[direct]:seed?brands.filter(b=>hasSeed(b,seed)):[];
  if(matches.length!==1)throw Error('品牌库缺少或品牌身份不唯一：'+id);
  return matches[0]; // Preserve imported IDs, selected text and versions.
 });
}
export function validateBrand(b){
 if(!b||typeof b!=='object'||Array.isArray(b))throw Error('品牌格式无效');
 for(const [key,max,required] of [['id',100,true],['name',100,true],['description',8000,false],['voice',8000,false]]){
  if(typeof b[key]!=='string'||b[key].length>max||(required&&!b[key].trim()))throw Error('品牌字段无效：'+key);
 }
 if(!Number.isSafeInteger(b.version)||b.version<1||!Array.isArray(b.endnotes)||b.endnotes.length>100)throw Error('品牌版本或尾注格式无效');
 if(b.slogan!==undefined&&(typeof b.slogan!=='string'||b.slogan.length>200))throw Error('品牌 slogan 无效');
 for(const e of b.endnotes)for(const [key,max] of [['id',100],['label',200],['text',16000]])if(typeof e?.[key]!=='string'||!e[key].trim()||e[key].length>max)throw Error('品牌尾注字段无效：'+key);
 if(new Set(b.endnotes.map(e=>e.id)).size!==b.endnotes.length)throw Error('尾注编号重复');
 return structuredClone(b);
}
function legacyBrands(data,sites){
 const brands=[];
 for(const site of sites){
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(site.spaceId))throw Error('空间编号无效');
  const dbPath=join(data,...(site.legacy?[]:['spaces',site.spaceId]),'papr.db');
  if(!existsSync(dbPath))continue;
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
   const row=db.prepare('SELECT value FROM settings WHERE key = ?').get('writing.brands.v1.'+site.spaceId);
   if(!row)continue;
   const values=JSON.parse(row.value);if(!Array.isArray(values))throw Error('原品牌库格式无效');
   for(const value of values){const b=validateBrand(value),old=brands.find(x=>x.id===b.id);if(old&&JSON.stringify(old)!==JSON.stringify(b))throw Error('不同空间的品牌编号冲突，请先整理原品牌');if(!old)brands.push(b);}
  }finally{db.close();}
 }
 return brands;
}
function hasSeed(brand,seed){
 const link=seed.description.split('品牌链接：').at(-1).trim();
 const urls=(brand.description+'\n'+brand.endnotes.map(e=>e.text).join('\n')).match(/https?:\/\/[^\s)\]<>]+/g)||[];
 return brand.id===seed.id||urls.some(url=>url.replace(/\/$/,'')===link.replace(/\/$/,''));
}
// Only brand settings are imported. Existing per-space settings and manuscript
// snapshots remain intact; all later edits address this one shared library.
export async function brandLibrary({data=process.env.SCHOLAY_GLOBAL_APP_DATA,brand,expectedVersion}={}){
 if(!data)throw Error('共用品牌库目录未初始化，请更新并重新打开 Today');
 const file=join(resolve(data),'writing-brands.json');
 return withFileLock(file+'.lock',async()=>{
  let value=await optionalJson(file);
  if(!value){
   const registry=await optionalJson(join(data,'spaces.json'));
   const brands=legacyBrands(data,registry?.sites||[]);
   for(const seed of brandSeeds())if(!brands.some(b=>hasSeed(b,seed)))brands.push(seed);
   value={version:1,brands};
   await atomicJson(file,value);
  }
  if(value.version!==1||!Array.isArray(value.brands))throw Error('共用品牌库格式无效');
  value.brands.forEach(validateBrand);
  if(new Set(value.brands.map(b=>b.id)).size!==value.brands.length)throw Error('品牌编号重复');
  let migrated=false;
  value.brands=value.brands.map(b=>{const next=refreshBrandIdentity(b);if(JSON.stringify(next)===JSON.stringify(b))return b;migrated=true;return {...next,version:b.version+1};});
  if(migrated)await atomicJson(file,value);
  if(brand){
   const next=validateBrand(brand),old=value.brands.find(b=>b.id===next.id);
   if(expectedVersion!==(old?.version||0))throw Error('品牌已有新版本，请重新打开品牌信息后编辑；输入内容已保留');
   next.version=(old?.version||0)+1;
   value.brands=[next,...value.brands.filter(b=>b.id!==next.id)];
   await atomicJson(file,value);
  }
  return structuredClone(value.brands);
 });
}
