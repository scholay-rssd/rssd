// Isolated public site previews. Never reads private manuscripts or databases.
import {readFile,writeFile,mkdir,cp,rm,access} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {profiles} from './site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {buildThemeHome} from './build-theme-home.mjs';
import {markdownImages} from './article-format.mjs';
import {createHash} from 'node:crypto';
const root=resolve('.local/organization-preview'),source=join(root,'input');
await mkdir(source,{recursive:true});
await cp('sites',join(source,'sites'),{recursive:true});
await cp('web/themes/academic/public',join(source,'web/themes/academic/public'),{recursive:true});
await cp('web/themes/content.css',join(source,'web/themes/content.css'));
await buildThemeHome('piggytuck',join(source,'theme-homepages'));
if(!process.argv.includes('--reuse-personal'))await buildThemeHome('personal',join(source,'theme-homepages'));
else await cp('.local/theme-builds/personal',join(source,'theme-homepages/personal'),{recursive:true});
await mkdir(join(root,'snapshots'),{recursive:true});
const fetchPublic=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Public read failed: '+url);return r;};
const fetchJson=async url=>(await fetchPublic(url)).json();
const children=[],receipt=[];
for(const [index,site] of profiles.entries()){
  const file=join(root,'snapshots',site.id+'.json');
  const emptySeed=site.legacy?false:(JSON.parse(await readFile(new URL('../sites/seeds/'+site.id+'.json',import.meta.url),'utf8')).length===0);
  if(emptySeed){try{await access(file);}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(file,JSON.stringify({news:[],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}}));}}
  if(process.argv.includes('--refresh-public')){
    const publicContent=await fetchJson(site.origin+'/published-content.json');
    if(publicContent.siteId!==site.id)throw Error('Wrong public site');
    let snapshot;
    if(site.legacy){
      snapshot={data:await fetchJson(site.origin+'/data.json'),openSource:await fetchJson(site.origin+'/open-source.json'),news:publicContent.records.filter(r=>r.legacy.kind==='news').map(r=>({id:r.id.slice(5),title:r.title,summary:r.summary,markdown:r.bodyMarkdown,date:r.publication.date,author:r.publication.author,category:publicContent.collections.find(c=>c.id===r.collectionId).name,...Object.fromEntries(['sectionId','tags','related','course'].filter(key=>r[key]!==undefined).map(key=>[key,r[key]]))})),permalinks:Object.fromEntries(publicContent.records.map(r=>[r.id,r.route]))};
    }else{
      const legacy=await fetchJson(site.origin+'/site-content.json'),records=legacy.records;
      const full=r=>{const id=r.kind+':'+(r.kind==='openSource'?r.url:r.id),record=publicContent.records.find(p=>p.id===id);return {...r,...(record?{markdown:record.bodyMarkdown}:{})};};
      snapshot={data:{year:records.filter(r=>r.kind==='year').map(full),history:records.filter(r=>r.kind==='history').map(full)},openSource:{items:records.filter(r=>r.kind==='openSource').map(full)},news:records.filter(r=>r.kind==='news').map(full),permalinks:Object.fromEntries(publicContent.records.map(r=>[r.id,r.route]))};
    }
    const cache=new Map();
    for(const item of [...snapshot.news,...snapshot.data.year,...snapshot.data.history,...snapshot.openSource.items]){
      const paths=[...new Set(markdownImages([item.markdown,item.body,item.value,item.historicalSignificance].filter(Boolean).join('\n')).filter(p=>/^\/article-media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(p)))];
      if(paths.length)item.assets=await Promise.all(paths.map(async path=>{
        if(!cache.has(path))cache.set(path,fetchPublic(site.origin+path).then(r=>r.arrayBuffer()).then(data=>{const bytes=Buffer.from(data);if(!path.includes(createHash('sha256').update(bytes).digest('hex')))throw Error('Public image hash mismatch');return {path,data:bytes.toString('base64')};}));
        return cache.get(path);
      }));
    }
    await writeFile(file,JSON.stringify(snapshot));
    await writeFile(join(root,'snapshots',site.id+'.public.json'),JSON.stringify(publicContent));
  }
  const snapshot=JSON.parse(await readFile(file,'utf8')),before=JSON.stringify(snapshot),target=join(root,site.id);
  const childPath=relative(root,target);if(!childPath||childPath.startsWith('..')||isAbsolute(childPath))throw Error('Preview target must stay inside preview directory');
  await rm(target,{recursive:true,force:true});
  const manifest=await buildSiteRelease({source,target,site,job:{id:'local-organization-'+site.id,snapshot,snapshot_hash:'local-preview-only'}});
  if(JSON.stringify(snapshot)!==before)throw Error('Snapshot mutated');
  const port=4290+index;
  receipt.push({siteId:site.id,localOnly:true,publicRecords:manifest.counts,url:'http://127.0.0.1:'+port+'/',snapshotUnchanged:true});
  if(!process.argv.includes('--build-only'))children.push(spawn(process.platform==='win32'?'python':'python3',['-m','http.server','--bind','127.0.0.1','--directory',target,String(port)],{stdio:'ignore',windowsHide:true}));
}
await writeFile(join(root,'acceptance.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>children.forEach(c=>c.kill(signal)));
