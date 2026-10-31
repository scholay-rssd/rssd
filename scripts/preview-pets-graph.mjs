// An explicitly selected LOCAL draft is copied into an isolated preview, never
// into the editorial index, publishing queue, production DB or repository data.
import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {profiles} from './site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {bodyHash,bindKnowledgeGraph} from '../web/engine/knowledge-graph.mjs';
import {adaptPublishedSnapshot} from '../web/engine/published-content.mjs';
const args=process.argv.slice(2),arg=key=>args[args.indexOf(key)+1];
for(const key of ['--article','--knowledge','--record-id'])if(!args.includes(key)||!arg(key)||arg(key).startsWith('--'))throw Error('Required: --article <local markdown> --knowledge <curated JSON> --record-id <stable article id>');
const article=resolve(arg('--article')),id=arg('--record-id');
if(!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))throw Error('Invalid article ID');
const markdown=await readFile(article,'utf8'),before=bodyHash(markdown),input=JSON.parse(await readFile(resolve(arg('--knowledge')),'utf8'));
const root=resolve('.local/pets-graph-preview'),source=join(root,'input'),target=join(root,'public');
const site={...profiles.find(s=>s.id==='pets'),display:{version:1,modules:{calendar:{enabled:true},graph:{enabled:true}}}};
const title=markdown.match(/^# (.+)$/m)?.[1];if(!title)throw Error('Draft title required');
const snapshot={news:[{id,title,summary:'本地未发布稿件的隔离关系图验收。',markdown,date:'2026-10-14',author:site.author,category:site.columns[1],assets:[]}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{['news:'+id]:'/news/'+id+'/'}};
const check=bindKnowledgeGraph(adaptPublishedSnapshot(snapshot,site),input);
if(check.omitted.nodes||check.omitted.relations||!check.graph.relations.length)throw Error('Preview evidence does not match the selected draft');
await mkdir(join(source,'web/themes'),{recursive:true});await cp('sites',join(source,'sites'),{recursive:true});
await cp('web/themes/content.css',join(source,'web/themes/content.css'));
await writeFile(join(source,'sites/knowledge/pets.json'),JSON.stringify(input));
await rm(target,{recursive:true,force:true});
await buildSiteRelease({source,target,site,job:{id:'local-pets-graph-preview',snapshot,snapshot_hash:'local-preview-only'}});
const manifestPath=join(target,'release.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
// The preview is clearly labelled, including the evidence article itself.
for(const file of ['graph/index.html','index.html','journal/index.html','news/'+id+'/index.html']){
  const path=join(target,file),html=await readFile(path,'utf8');
  const marked=html.replace('<main id="main">','<main id="main"><p style="padding:12px 16px;border:1px solid #c9c6b1;background:#efeee3;font-size:13px">本地验收 · 本稿尚未发布；这里只演示已核对的来源表述，不代表独立实证结论。</p>');
  await writeFile(path,marked);manifest.hashes[file]=bodyHash(marked);
}
await writeFile(manifestPath,JSON.stringify({...manifest,localOnly:true}));
if(bodyHash(await readFile(article,'utf8'))!==before)throw Error('Original draft changed during preview');
await writeFile(join(root,'acceptance.json'),JSON.stringify({siteId:'pets',localOnly:true,articleSha256:before,nodes:check.graph.nodes.length,relations:check.graph.relations.length,originalUnchanged:true},null,2)+'\n');
console.log('Local pets graph: http://127.0.0.1:4287/graph/');
if(!args.includes('--build-only')){
  const child=spawn('python3',['-m','http.server','--bind','127.0.0.1','--directory',target,'4287'],{stdio:'inherit'});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
  child.on('exit',code=>{process.exitCode=code||0;});
}
