import {readFileSync,existsSync} from 'node:fs';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateSectionCatalog} from '../contracts/site-sections.mjs';
import {withFileLock} from './editorial-lock.mjs';

export const sectionCatalogPath=root=>join(root,'.local','site-section-catalog.json');
export function cachedSectionCatalog(root,site){
 const file=sectionCatalogPath(root);
 if(!existsSync(file))return null;
 try{const value=JSON.parse(readFileSync(file,'utf8'));if(value.siteId!==site.id||value.origin!==site.origin)return null;return {...validateSectionCatalog(value),siteId:site.id,origin:site.origin,syncedAt:value.syncedAt};}catch{return null;}
}
export function siteWithCachedSections(root,site,{required=false}={}){
 const catalog=cachedSectionCatalog(root,site);
 return catalog?{...site,sectionCatalog:{...catalog,status:'cached'}}:required?{...site,sectionCatalog:{version:1,revision:'unavailable',sections:[],status:'unavailable'}}:site;
}
export async function syncSectionCatalog(root,site,{fetcher=fetch,force=false,now=Date.now()}={}){
 const file=sectionCatalogPath(root);
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 return withFileLock(file+'.lock',async()=>{
  const previous=cachedSectionCatalog(root,site);
  if(!force&&previous&&now-Date.parse(previous.syncedAt)<120000)return {...previous,status:'cached'};
  try{
   const response=await fetcher(site.origin+'/manage/api/site',{redirect:'error',signal:AbortSignal.timeout(4000)});
   if(!response.ok)throw Error('栏目目录读取失败');
   const text=await response.text();if(text.length>256000)throw Error('栏目目录过大');
   const descriptor=JSON.parse(text);
   if(descriptor.protocol!=='scholay-content'||descriptor.version!==1||descriptor.siteId!==site.id||descriptor.origin!==site.origin)throw Error('栏目目录的站点身份不匹配');
   const catalog=validateSectionCatalog(descriptor.sectionCatalog);
   // Removed IDs remain readable; no old manuscript is reassigned by position
   // or by a name that happens to match a different new section.
   const known=new Set(catalog.sections.map(s=>s.id));
   for(const old of previous?.sections||[])if(!known.has(old.id))catalog.sections.push({...old,enabled:false,writable:false});
   const next={...catalog,siteId:site.id,origin:site.origin,syncedAt:new Date(now).toISOString()};
   const temp=file+'.'+randomUUID()+'.tmp';
   try{await writeFile(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}
   return {...next,status:'ready'};
  }catch(error){return {...(previous||{version:1,revision:'unavailable',sections:[]}),status:previous?'offline':'unavailable',error:String(error.message||error)};}
 },{timeout:5000});
}
