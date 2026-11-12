// One-time migration of desktop spaces whose site/space ID was retired
// (contracts/site-renames.mjs). Runs before the registry is read and is safe
// to run again: once nothing carries the old ID it does nothing.
//
// The old space folder is copied to spaces/.<old>-before-rename-<time> before
// anything changes, so the user can recover it by hand.
import {existsSync,readFileSync,writeFileSync,renameSync,readdirSync,lstatSync,cpSync,rmSync,rmdirSync} from 'node:fs';
import {join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SITE_RENAMES} from '../contracts/site-renames.mjs';
import {profiles} from './site-config.mjs';

// The retired product name in the site's own brand text (not the 心有灵犀 idiom in slogans).
const TEXT_RENAMES=[['灵犀输入法','犀术输入法'],['Lingxi IME','XSIME']];
const renameText=value=>typeof value==='string'?TEXT_RENAMES.reduce((t,[a,b])=>t.split(a).join(b),value):Array.isArray(value)?value.map(renameText):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,renameText(v)])):value;
const ID_KEYS=new Set(['siteId','spaceId','workspaceId','activeSpaceId']);
const BRAND_FIELDS=['name','domain','description','author','slogan','origin','aliases'];
const read=file=>JSON.parse(readFileSync(file,'utf8'));
function write(file,value){
  const raw=readFileSync(file,'utf8'),tmp=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(tmp,JSON.stringify(value,null,2)+(raw.endsWith('\n')?'\n':''),{mode:0o600,flag:'wx'});renameSync(tmp,file);}finally{rmSync(tmp,{force:true});}
}
// Replace retired IDs only where a value is an identifier, and paths that name
// the old space folder. Free text (titles, notes, batch names) is left alone.
function rewrite(value,from,to,key=''){
  if(typeof value==='string'){
    if(value===from&&(ID_KEYS.has(key)||key==='id'))return to;
    return value.split(`${sep}spaces${sep}${from}${sep}`).join(`${sep}spaces${sep}${to}${sep}`).split(`/.local/sites/${from}/`).join(`/.local/sites/${to}/`);
  }
  if(Array.isArray(value))return value.map(item=>rewrite(item,from,to,key==='workspaceIds'||key==='siteIds'?'siteId':''));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,from,to,k)]));
  return value;
}
function rewriteJsonTree(dir,from,to){
  if(!existsSync(dir))return 0;let changed=0;
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);if(entry.isSymbolicLink())continue;
    if(entry.isDirectory()){changed+=rewriteJsonTree(path,from,to);continue;}
    if(!entry.name.endsWith('.json'))continue;
    let value;try{value=read(path);}catch{continue;}
    const next=rewrite(value,from,to);if(JSON.stringify(next)!==JSON.stringify(value)){write(path,next);changed++;}
  }
  return changed;
}
function renameSite(site,to){
  const canonical=profiles.find(p=>p.id===to);
  const next={...site,id:to,spaceId:to};
  if(canonical)for(const key of BRAND_FIELDS){if(canonical[key]!==undefined)next[key]=structuredClone(canonical[key]);else delete next[key];}
  return next;
}

export function migrateRenamedSpaces(data,{now=()=>new Date()}={}){
  const file=join(data,'spaces.json');if(!existsSync(file))return [];
  const report=[];
  for(const [from,to] of Object.entries(SITE_RENAMES)){
    const registry=read(file);
    const index=registry.sites?.findIndex(s=>s.id===from||s.spaceId===from)??-1;
    if(index<0)continue;
    if(registry.sites.some(s=>s.id===to||s.spaceId===to))throw Error(`空间 ${from} 需要改名为 ${to}，但 ${to} 已存在；原空间保持不变`);
    const spaces=join(data,'spaces'),oldDir=join(spaces,from),newDir=join(spaces,to);
    if(existsSync(newDir)&&(lstatSync(newDir).isSymbolicLink()||readdirSync(newDir).length))throw Error(`空间目录 ${to} 已有数据；原空间保持不变`);
    let backup=null;
    if(existsSync(oldDir)){
      backup=join(spaces,`.${from}-before-rename-${now().toISOString().replace(/[:.]/g,'-')}`);
      // Sockets (agent.sock) belong to a running process and cannot be copied.
      cpSync(oldDir,backup,{recursive:true,errorOnExist:true,force:false,preserveTimestamps:true,verbatimSymlinks:true,filter:src=>!lstatSync(src).isSocket()});
      if(existsSync(newDir))rmdirSync(newDir);
      renameSync(oldDir,newDir);
    }
    // The editorial workspace may live inside the space folder or elsewhere.
    const preference=join(newDir,'editorial-workspace.json');let workspace=null;
    if(existsSync(preference)){const pref=rewrite(read(preference),from,to);write(preference,pref);workspace=pref.path;}
    let files=existsSync(newDir)?rewriteJsonTree(newDir,from,to):0;
    if(workspace&&!workspace.startsWith(newDir+sep)&&existsSync(workspace))files+=rewriteJsonTree(workspace,from,to);
    if(workspace){
      const oldCache=join(workspace,'.local','sites',from),newCache=join(workspace,'.local','sites',to);
      if(existsSync(oldCache)&&!existsSync(newCache))renameSync(oldCache,newCache);
      const binding=join(workspace,'.site.json');if(existsSync(binding))write(binding,renameSite(read(binding),to));
    }
    registry.sites[index]=renameSite(registry.sites[index],to);
    if(registry.activeSpaceId===from)registry.activeSpaceId=to;
    write(file,registry);
    const brands=join(data,'writing-brands.json');
    if(existsSync(brands)){
      const library=read(brands),list=library.brands||[];
      if(!list.some(b=>b.id==='site:'+to)){let moved=false;for(const [i,b] of list.entries())if(b.id==='site:'+from){list[i]=renameText({...b,id:'site:'+to});moved=true;}if(moved)write(brands,library);}
    }
    report.push({from,to,backup,files});
  }
  return report;
}
