import {readdir,readFile,lstat,mkdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
export const byteHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const reserved=/^(?:journal|calendar|gallery|graph|showcase|roadmap|display|works|project-notes|organization|archive|news|history|open-source|article-media|manage)(?:\/|$)|^(?:release\.json|published-content\.json|site-content\.json|content-feed(?:\.xml|\.js|-index\.json)|sitemap-content\.xml|site-theme\.css|site-calendar\.js|site-logo\.)/;
export function homepagePath(path){
 if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||reserved.test(path))throw Error('Unsafe or reserved homepage path: '+path);
 return path;
}
export async function homepageFiles(directory,prefix=''){
 const files=[];
 for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})){
  if(entry.name.startsWith('.'))continue;
  const path=prefix+entry.name;
  if(entry.isSymbolicLink())throw Error('Homepage symlinks are not packaged: '+path);
  if(entry.isDirectory())files.push(...await homepageFiles(directory,path+'/'));
  else if(entry.isFile())files.push(homepagePath(path));
  else throw Error('Invalid homepage file: '+path);
 }
 return files.sort();
}
export async function copyThemeHomepage({source,target,site,theme}){
 if(!theme.homepage)return null;
 const root=join(source,'theme-homepages',theme.id),manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
 if(manifest.version!==1||manifest.themeId!==theme.id||manifest.siteId!==site.id||manifest.origin!==site.origin||!manifest.files?.['index.html'])throw Error('Homepage artifact identity mismatch');
 const hashes={};
 // Validate the whole artifact before any file is copied. A missing/changed file
 // fails the build; the current published release stays active.
 for(const [path,hash] of Object.entries(manifest.files)){
  homepagePath(path);const file=join(root,'public',path);
  let cursor=join(root,'public');for(const segment of path.split('/')){cursor=join(cursor,segment);if((await lstat(cursor)).isSymbolicLink())throw Error('Homepage symlink rejected');}
  const bytes=await readFile(file);if(byteHash(bytes)!==hash)throw Error('Homepage checksum mismatch: '+path);
  hashes[path]=hash;
 }
 for(const path of Object.keys(hashes)){await mkdir(dirname(join(target,path)),{recursive:true});await writeFile(join(target,path),await readFile(join(root,'public',path)));}
 return {version:1,themeId:theme.id,artifactHash:byteHash(JSON.stringify(manifest)),hashes};
}
