import {mkdir,rm,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {profiles} from './site-config.mjs';
import {themeForSite} from '../web/themes/registry.mjs';
import {homepageFiles,byteHash} from '../web/engine/theme-homepage.mjs';
import {addHomepageStructuredData} from '../web/engine/homepage-seo.mjs';
import {navigationForSite,fillNavigationSlot} from '../web/engine/site-navigation.mjs';
import {siteBranding} from '../sites/branding/assets.mjs';
import {addSocialMetadata} from '../web/engine/social-metadata.mjs';
import {addLanguageNavigation} from '../web/engine/language-navigation.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildThemeHome(siteId,output=join(root,'.local/theme-builds')){
 const site=profiles.find(s=>s.id===siteId),theme=site&&themeForSite(site);
 if(!theme?.homepage)throw Error('Site has no custom homepage Theme');
 const source=join(root,theme.homepage.directory),target=join(resolve(output),theme.id);
 const assetRoot=theme.homepage.builder==='next-export'?join(source,'public'):source;
 for(const [file,brandFile] of Object.entries(siteBranding(siteId)?.files||{})){
  const path=join(assetRoot,file.startsWith('site-logo.')?'brand/'+file:file);
  await mkdir(join(path,'..'),{recursive:true});await copyFile(join(root,'sites/branding',brandFile),path);
 }
 if(theme.homepage.builder==='next-export'){
  const result=spawnSync(process.platform==='win32'?'pnpm.cmd':'pnpm',['build'],{cwd:source,env:{...process.env,NEXT_PUBLIC_SITE_URL:site.origin,SCHOLAY_SITE_NAVIGATION:JSON.stringify(navigationForSite(site))},stdio:'inherit',shell:process.platform==='win32'});
  if(result.status!==0)throw Error('Homepage build failed');
 }
 const input=theme.homepage.builder==='next-export'?join(source,'out'):source;
 const files=(await homepageFiles(input)).filter(f=>!['ASSET_SOURCES.json','GIF_AUDIT.json'].includes(f)&&!f.startsWith('downloads/'));
 if(!files.includes('index.html'))throw Error('Missing homepage');
 if(theme.id==='personal')for(const required of ['en/index.html','ja/index.html','fr/index.html','es/index.html','projects/index.html','projects/rimes/input-schemes/index.html','models/split-keyboard.glb','models/split-keyboard.keys.json'])if(!files.includes(required))throw Error('Missing personal page/asset '+required);
 await rm(target,{recursive:true,force:true});await mkdir(join(target,'public'),{recursive:true});const hashes={};
 for(const file of files){
  let bytes=await readFile(join(input,file));
  // Next pages own their JSON-LD so client navigation updates it with the page.
  if(theme.homepage.builder==='static'&&file.endsWith('index.html'))bytes=Buffer.from(addHomepageStructuredData(fillNavigationSlot(bytes.toString('utf8'),site),{site,route:'/'+file.replace(/index\.html$/,'')}));
  if(file.endsWith('index.html'))bytes=Buffer.from(addSocialMetadata(bytes.toString('utf8'),{site,route:'/'+file.replace(/index\.html$/,'')}));
  if(file.endsWith('index.html'))bytes=Buffer.from(addLanguageNavigation(bytes.toString('utf8'),{site,route:'/'+file.replace(/index\.html$/,''),englishHome:theme.id==='personal'||site.languages?.includes('en')}));
  hashes[file]=byteHash(bytes);await mkdir(join(target,'public',file,'..'),{recursive:true});await writeFile(join(target,'public',file),bytes);
 }
 hashes['site-language.css']=byteHash(await readFile(new URL('../web/engine/site-language.css',import.meta.url)));await copyFile(new URL('../web/engine/site-language.css',import.meta.url),join(target,'public/site-language.css'));
 await writeFile(join(target,'manifest.json'),JSON.stringify({version:1,siteId:site.id,origin:site.origin,themeId:theme.id,files:hashes},null,2)+'\n');
 console.log(JSON.stringify({siteId,themeId:theme.id,files:files.length,artifact:target}));return target;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildThemeHome(process.argv[2],process.argv[3]);
