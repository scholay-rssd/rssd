// Build the RSSD Demo: one fixture publication rendered through the real Theme
// registry and renderer once per Theme variant. Output stays under .local/demo;
// nothing reads desktop data, manuscripts or production services.
import {mkdir,rm,writeFile,readFile,cp,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve,extname,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSite} from './site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {themeForSite} from '../web/themes/registry.mjs';
import {adaptPublishedSnapshot} from '../web/engine/published-content.mjs';
import {originalLanguageSnapshot} from '../web/engine/language-pages.mjs';
import {organizeContent} from '../web/engine/site-organization.mjs';
import {byteHash} from '../web/engine/theme-homepage.mjs';
import {fillNavigationSlot} from '../web/engine/site-navigation.mjs';
import {demoSnapshot,demoOrganization,demoKnowledge} from '../web/demo/fixtures.mjs';
import {DEMO_VARIANTS,DEMO_PORT,demoSite} from '../web/demo/variants.mjs';
import {demoCatalogue} from '../web/demo/catalogue.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const DEMO_NOW=new Date('2026-10-27T00:00:00Z');

// The authored homepages of portfolio/personal belong to real sites. The Demo
// supplies its own small verified artifact so the homepage path is exercised.
async function fixtureHomepage(source,site,theme){
  const dir=join(source,'theme-homepages',theme.id),out=join(dir,'public');await mkdir(out,{recursive:true});
  const html=fillNavigationSlot(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${site.name} · ${theme.name}自带首页</title><link rel="stylesheet" href="/site-theme.css"></head><body data-theme="${theme.id}" data-blog><header class="site-header"><a class="brand" href="/"><span class="brand-monogram" aria-hidden="true">演</span><span>${site.name}</span><small>${theme.name}</small></a><nav aria-label="主导航"><!-- site-navigation:start --><!-- site-navigation:end --></nav></header><main id="main"><section class="hero"><p class="eyebrow">AUTHORED HOMEPAGE</p><h1>${theme.name}自带首页</h1><p class="blog-slogan">这个主题的首页由站点自行编写，引擎按校验清单原样复制；文章、栏目与模块页面仍由共享渲染器生成。</p><div class="hero-links"><a href="/archive/">全部文章 ↗</a><a href="/showcase/">橱窗 →</a></div></section></main></body></html>`,site);
  await writeFile(join(out,'index.html'),html);
  await writeFile(join(dir,'manifest.json'),JSON.stringify({version:1,siteId:site.id,origin:site.origin,themeId:theme.id,files:{'index.html':byteHash(Buffer.from(html))}}));
}

export async function buildDemoVariant(variant,{output=join(root,'.local/demo'),now=DEMO_NOW}={}){
  const site=validateSite(demoSite(variant)),theme=themeForSite(site),snapshot=demoSnapshot(site);
  const source=join(output,'.source',site.id),target=join(output,site.id);
  await rm(source,{recursive:true,force:true});await rm(target,{recursive:true,force:true});
  for(const dir of ['sites/organization','sites/knowledge','web/themes'])await mkdir(join(source,dir),{recursive:true});
  await cp(join(root,'sites/site-theme.css'),join(source,'sites/site-theme.css'));
  await cp(join(root,'web/themes/content.css'),join(source,'web/themes/content.css'));
  if(theme.publicDirectory)await cp(join(root,theme.publicDirectory),join(source,theme.publicDirectory),{recursive:true});
  const organization=demoOrganization(site);
  await writeFile(join(source,'sites/organization',site.id+'.json'),JSON.stringify(organization));
  const content=organizeContent(adaptPublishedSnapshot(originalLanguageSnapshot(snapshot),site),organization);
  await writeFile(join(source,'sites/knowledge',site.id+'.json'),JSON.stringify(demoKnowledge(content)));
  if(theme.homepage)await fixtureHomepage(source,site,theme);
  const manifest=await buildSiteRelease({job:{id:'demo-'+site.id,snapshot,snapshot_hash:'demo-fixture'},target,site,source,now});
  await rm(source,{recursive:true,force:true});
  const routes=Object.fromEntries(JSON.parse(await readFile(join(target,'published-content.json'),'utf8')).records.map(r=>[r.id,r.route]));
  const pages=new Set(Object.keys(manifest.hashes).filter(f=>f.endsWith('index.html')).map(f=>'/'+f.replace(/index\.html$/,'')));
  return {variant,site,theme,target,manifest,routes,pages};
}

export async function buildDemo({output=join(root,'.local/demo'),only=[]}={}){
  const selected=DEMO_VARIANTS.filter(v=>!only.length||only.includes(v.id));
  if(only.length&&selected.length!==only.length)throw Error('Unknown Demo variant: '+only.filter(id=>!DEMO_VARIANTS.some(v=>v.id===id)).join(', '));
  await mkdir(output,{recursive:true});const builds=[];
  for(const variant of selected)builds.push(await buildDemoVariant(variant,{output}));
  await writeFile(join(output,'index.html'),demoCatalogue(builds));
  return builds;
}

const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.xml':'application/xml','.txt':'text/plain; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'};
// Each variant uses root-relative URLs, so it gets its own loopback port.
function serve(directory,port){
  return createServer(async(req,res)=>{
    let path=normalize(decodeURIComponent(new URL(req.url,'http://x').pathname)).replace(/^(\.\.[/\\])+/,'');
    let file=join(directory,path);
    try{if((await stat(file)).isDirectory())file=join(file,'index.html');const bytes=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(bytes);}
    catch{res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Not found');}
  }).listen(port,'127.0.0.1');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),only=args.filter(a=>!a.startsWith('--'));
  const output=join(root,'.local/demo'),builds=await buildDemo({output,only});
  for(const b of builds)console.log(`${b.variant.id.padEnd(18)} ${b.theme.id.padEnd(12)} ${String(Object.keys(b.manifest.hashes).length).padStart(4)} files  ${b.variant.preview}/`);
  console.log('Demo catalogue: '+join(output,'index.html'));
  if(args.includes('--serve')){
    serve(output,DEMO_PORT);for(const b of builds)serve(b.target,b.variant.port);
    console.log(`Serving the catalogue at http://127.0.0.1:${DEMO_PORT}/ (Ctrl-C to stop)`);
  }
}
