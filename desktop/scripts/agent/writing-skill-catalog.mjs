// Workspace skills are text instructions, never executable plugins. Mount a
// content snapshot so an existing manuscript does not silently change versions.
import {readdir,readFile,lstat,realpath} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {writableSectionsForSite} from '../../../contracts/site-sections.mjs';
import {siteForWorkspace} from '../../../scripts/site-config.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
export async function writingCatalog(root,{templateRoot=process.env.SCHOLAY_TEMPLATE_ROOT||fileURLToPath(new URL('../../resources/workspace-template/',import.meta.url))}={}){
 const site=siteForWorkspace(root),skills=[];
 // A space may contain only its own guide. Fill the catalog from the shipped
 // library without copying files into the author's workspace or replacing it.
 for(const base of [...new Set([join(root,'.agents/skills'),join(templateRoot,'.agents/skills')])]){
 const entries=await readdir(base,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
  if(!entry.isDirectory()||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.name))continue;
  if(skills.some(skill=>skill.id===entry.name))continue;
  const file=join(base,entry.name,'SKILL.md');
  try{
   if((await lstat(file)).isSymbolicLink()||!(await realpath(file)).startsWith(await realpath(base)+sep))continue;
   const content=await readFile(file,'utf8');if(Buffer.byteLength(content)>60000)continue;
   const front=content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]||'';
   const field=key=>{
    const lines=front.split(/\r?\n/),index=lines.findIndex(line=>new RegExp('^'+(key==='version'?' *':'')+key+':').test(line));
    if(index<0)return '';
    const value=lines[index].slice(lines[index].indexOf(':')+1).trim();
    if(value==='|'||value==='>'){const rest=[];for(const line of lines.slice(index+1)){if(!/^\s+/.test(line))break;rest.push(line.trim());}return rest.join(' ');}
    return value.replace(/^['"]|['"]$/g,'');
   };
   const contentHash=hash(content);
   skills.push({id:entry.name,name:field('name')||entry.name,description:field('description')||'',version:field('version')||contentHash.slice(0,12),contentHash,content});
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 }
 return {siteId:site.id,sections:writableSectionsForSite(site),skills};
}
export async function resolveSkillMounts(root,mounts=[],previous=[]){
 const catalog=(await writingCatalog(root)).skills;
 return mounts.map(m=>{
  const old=previous.find(x=>x.id===m.id&&x.contentHash===m.contentHash);
  if(old&&JSON.stringify(old)===JSON.stringify(m))return old;
  const current=catalog.find(x=>x.id===m.id&&x.contentHash===m.contentHash);
  if(!current)throw Error('写作技能已变化，请刷新技能卡片后重新挂载：'+m.id);
  return current;
 });
}
