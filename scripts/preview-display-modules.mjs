// Public-only, isolated preview. No DB reads, editorial writes or network
// publishing. Existing authored portfolio assets are the gallery's input.
import {cp,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {buildThemeHome} from './build-theme-home.mjs';
import {profiles} from './site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
const root=resolve('.local/display-module-preview'),source=join(root,'input'),target=join(root,'public');
await mkdir(source,{recursive:true});
await cp('sites',join(source,'sites'),{recursive:true});
await mkdir(join(source,'web/themes'),{recursive:true});
await cp('web/themes/content.css',join(source,'web/themes/content.css'));
await buildThemeHome('piggytuck',join(source,'theme-homepages'));
await rm(target,{recursive:true,force:true});
const site=profiles.find(s=>s.id==='piggytuck');
const snapshot={news:[],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}};
await buildSiteRelease({source,target,site,job:{id:'local-display-preview',snapshot,snapshot_hash:'local-preview-only'}});
console.log('Local gallery: http://127.0.0.1:4285/gallery/');
if(!process.argv.includes('--build-only')){
  const child=spawn('python3',['-m','http.server','--bind','127.0.0.1','--directory',target,'4285'],{stdio:'inherit'});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
  child.on('exit',code=>{process.exitCode=code||0;});
}
