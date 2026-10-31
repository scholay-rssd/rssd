import {readFile} from 'node:fs/promises';

function splitDirs(value){return String(value||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean);}

export function parseMountSpec(spec){
 if(!spec||typeof spec!=='string')throw Error('挂载说明无效');
 const trimmed=spec.trim();
 const kind=trimmed.includes(':')?trimmed.slice(0,trimmed.indexOf(':')):trimmed;
 const rest=trimmed.includes(':')?trimmed.slice(trimmed.indexOf(':')+1):'';
 if(kind==='rss'){
  const params=Object.fromEntries(rest.split(',').filter(Boolean).map(part=>{const i=part.indexOf('=');return i<0?[part,'true']:[part.slice(0,i),part.slice(i+1)];}));
  return {kind:'rss',articleId:params.article||params.articleId,group:params.group,folderId:params.folder||params.folderId,feedId:params.feed||params.feedId,starred:params.starred==='true'||params.collection==='starred',range:params.range||params.days,query:params.query,role:params.role};
 }
 if(kind==='file'){
  const [pathPart,...flags]=rest.split(',');
  const params=Object.fromEntries(flags.filter(Boolean).map(part=>{const i=part.indexOf('=');return i<0?[part,'true']:[part.slice(0,i),part.slice(i+1)];}));
  return {kind:'file',path:pathPart,chapters:params.chapters,chapterIds:params.chapterIds?splitDirs(params.chapterIds):undefined,pages:params.pages,pageFrom:params.pageFrom,pageTo:params.pageTo,whole:params.whole==='true'||params.mode==='whole',role:params.role};
 }
 if(kind==='github'){
  const head=rest.split(',')[0];
  const at=head.lastIndexOf('@');
  const repo=at>0?head.slice(0,at):head;
  const ref=at>0?head.slice(at+1):undefined;
  const params=Object.fromEntries(rest.split(',').slice(1).filter(Boolean).map(part=>{const i=part.indexOf('=');return i<0?[part,'true']:[part.slice(0,i),part.slice(i+1)];}));
  return {kind:'github',repo,ref:params.ref||ref,dirs:splitDirs(params.dirs||params.directories),role:params.role};
 }
 if(kind==='url')return {kind:'web',url:rest,role:'evidence'};
 if(kind==='search'||kind==='web'){
  if(rest.startsWith('http'))return {kind:'web',url:rest};
  const params=Object.fromEntries(rest.split(',').filter(f=>f.includes('=')).map(part=>{const i=part.indexOf('=');return [part.slice(0,i),part.slice(i+1)];}));
  return {kind:'web',query:params.query||rest.split(',')[0],site:params.site,role:'lead'};
 }
 if(kind==='signals'||kind==='hot'){
  const params=Object.fromEntries(rest.split(',').filter(Boolean).map(part=>{const i=part.indexOf('=');return i<0?[part,'true']:[part.slice(0,i),part.slice(i+1)];}));
  return {kind:'signals',query:params.query||(rest&&!rest.includes('=')?rest:undefined),platformId:params.platform,role:'lead'};
 }
 if(kind==='existing'){
  const params=Object.fromEntries(rest.split(',').filter(Boolean).map(part=>{const i=part.indexOf('=');return i<0?[part,'true']:[part.slice(0,i),part.slice(i+1)];}));
  const mode=['works','calendar','history'].includes(rest)?rest:params.mode||params.collection;
  return {kind:'existing',id:params.id,mode,query:params.query,role:'background'};
 }
 throw Error('未知挂载来源：'+kind);
}

export function parseProduceMounts(argv){
 const mounts=[];
 let allowNetwork=false;
 const rest=[];
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--allow-network'){allowNetwork=true;continue;}
  if(arg==='--mount'){const spec=argv[++i];if(!spec||spec.startsWith('--'))throw Error('--mount requires a spec');mounts.push(parseMountSpec(spec));continue;}
  if(arg.startsWith('--mount=')){mounts.push(parseMountSpec(arg.slice(8)));continue;}
  if(arg==='--mounts'){const file=argv[++i];if(!file||file.startsWith('--'))throw Error('--mounts requires a JSON file');mounts.push({kind:'_file',file});continue;}
  rest.push(arg);
 }
 return {argv:rest,mounts,allowNetwork};
}

export async function loadMountList(items){
 const out=[];
 for(const item of items){
  if(item.kind==='_file'){
   const data=JSON.parse(await readFile(item.file,'utf8'));
   const list=Array.isArray(data)?data:data.mounts||[];
   for(const entry of list)out.push(typeof entry==='string'?parseMountSpec(entry):entry);
  }else out.push(item);
 }
 return out;
}

/** Optional brief frontmatter: mount / allow-network lines between --- fences. */
export function parseBriefMounts(text){
 const source=String(text??'');
 if(!/^---\r?\n/.test(source))return {text:source,mounts:[],allowNetwork:false};
 const match=source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
 if(!match)return {text:source,mounts:[],allowNetwork:false};
 const mounts=[];
 let allowNetwork=false;
 for(const raw of match[1].split(/\r?\n/)){
  const line=raw.trim();
  if(!line||line.startsWith('#'))continue;
  const i=line.indexOf(':');
  if(i<0)continue;
  const key=line.slice(0,i).trim();
  const value=line.slice(i+1).trim();
  if(key==='allow-network'||key==='allowNetwork'){allowNetwork=['true','1','yes'].includes(value.toLowerCase());continue;}
  if(key!=='mount'&&key!=='mounts')continue;
  if(value.startsWith('[')||value.startsWith('{')){
   const parsed=JSON.parse(value);
   const list=Array.isArray(parsed)?parsed:parsed.mounts||[parsed];
   for(const item of list)mounts.push(typeof item==='string'?parseMountSpec(item):item);
  }else if(value)mounts.push(parseMountSpec(value));
 }
 return {text:source.slice(match[0].length),mounts,allowNetwork};
}
