import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {guestbookConfig} from '../../contracts/guestbook.mjs';
import {digest} from '../../admin/model.mjs';
import {renderNavigation} from './site-navigation.mjs';
import {addSocialMetadata} from './social-metadata.mjs';
import {addLanguageNavigation} from './language-navigation.mjs';

export async function attachGuestbook({target,site,manifest}){
 if(!site.services?.guestbook?.enabled)return manifest;
 const config=guestbookConfig(site),directory=join(target,'guestbook');await mkdir(directory,{recursive:true});
 let html=await readFile(new URL('../guestbook/index.html',import.meta.url),'utf8');
 html=addSocialMetadata(html,{site,route:'/guestbook/',title:'留言板 · '+site.name,description:'公开留言、问题反馈与合作线索。'+site.description});
 html=addLanguageNavigation(html,{site,route:'/guestbook/',englishHome:Object.hasOwn(manifest.hashes,'en/index.html')});
 html=html.replace('<header>','<header class="guestbook-header">');
 let style=await readFile(new URL('../guestbook/style.css',import.meta.url),'utf8');
 style+='\n.guestbook-header{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px}.guestbook-header>#home{grid-column:1;grid-row:1;align-self:center}.guestbook-header>.site-language-control{grid-column:2;grid-row:1;margin:0}.guestbook-header>p,.guestbook-header>h1{grid-column:1/-1}';
 if(site.legacy){html=html.replace('<main>','<main><nav class="academic-nav" aria-label="主导航">'+renderNavigation(site,'/guestbook/')+'</nav>');style+='\n.academic-nav{display:flex;flex-wrap:wrap;gap:12px 24px;margin-bottom:32px;padding-bottom:16px;border-bottom:1px solid #d7dbd4}.academic-nav a{color:inherit;text-decoration:none}.academic-nav a[aria-current]{font-weight:700;text-decoration:underline;text-underline-offset:6px}';}
 else style+='\n'+await readFile(new URL('../guestbook/color-mode.css',import.meta.url),'utf8');
 for(const [file,bytes] of [['index.html',html],['style.css',style],['app.js',await readFile(new URL('../guestbook/app.js',import.meta.url))],['config.json',JSON.stringify(config)]]){
  await writeFile(join(directory,file),bytes);manifest.hashes['guestbook/'+file]=digest(bytes);
 }
 manifest.guestbook={version:1,static:true};return manifest;
}
