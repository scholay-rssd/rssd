import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {guestbookConfig} from '../../contracts/guestbook.mjs';
import {digest} from '../../admin/model.mjs';
import {renderNavigation} from './site-navigation.mjs';
import {addSocialMetadata} from './social-metadata.mjs';
import {addLanguageNavigation} from './language-navigation.mjs';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const GUESTBOOK_ROUTE='/guestbook/';
export const GUESTBOOK_TITLE='留言板';
export const guestbookDescription=site=>'公开留言、问题反馈与合作线索。'+(site.description||'');

// The form and the message wall for a page inside the site's own shell (header, navigation, footer and
// stylesheets). The markup comes from the standalone template, so app.js finds the same elements.
export async function guestbookBody(){
 const template=await readFile(new URL('../guestbook/index.html',import.meta.url),'utf8');
 const part=pattern=>{const match=template.match(pattern);if(!match)throw Error('Guestbook template changed');return match[1];};
 const header=part(/<header>([\s\S]*?)<\/header>/).replace(/<a id="home"[^>]*>[\s\S]*?<\/a>/,'');
 return `<article class="guestbook"><section class="hero compact">${header}</section><div class="columns">${part(/<div class="columns">([\s\S]*?)<\/div><footer>/)}</div><p class="guestbook-footnote">${part(/<footer>([\s\S]*?)<\/footer>/)}</p></article>`;
}
// The guestbook is served under a policy that allows only the site's own scripts and stylesheets, so the
// shell's inline style and scripts (structured data, analytics) are left out. The theme's accent, which the
// shell sets inline, travels as data-accent and app.js applies it. The page stays out of search indexes.
export function guestbookShell(html){
 let accent='';
 html=html.replace(/<style>:root\{--accent:([^;}]+);--blog-accent:[^}]*\}<\/style>/,(_,value)=>{accent=value;return '';})
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'').replace(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g,'')
  .replace(/<meta name="robots" content="[^"]*">/,'<meta name="robots" content="noindex,follow">')
  .replace('</head>','<link rel="stylesheet" href="/guestbook/style.css"><script src="/guestbook/app.js" defer></script></head>');
 return accent?html.replace(/<body\b/,`<body data-accent="${accent.replace(/[^#a-zA-Z0-9(),. %-]/g,'')}"`):html;
}

export async function attachGuestbook({target,site,manifest}){
 if(!site.services?.guestbook?.enabled)return manifest;
 const config=guestbookConfig(site),directory=join(target,'guestbook');await mkdir(directory,{recursive:true});
 // A theme that renders the guestbook inside its own shell has written the page already; it takes the
 // component stylesheet, which uses the site's colour tokens.
 if(Object.hasOwn(manifest.hashes,'guestbook/index.html')){
  for(const [file,bytes] of [['style.css',await readFile(new URL('../guestbook/site.css',import.meta.url))],['app.js',await readFile(new URL('../guestbook/app.js',import.meta.url))],['config.json',JSON.stringify(config)]]){
   await writeFile(join(directory,file),bytes);manifest.hashes['guestbook/'+file]=digest(bytes);
  }
  manifest.guestbook={version:1,static:true};return manifest;
 }
 let html=await readFile(new URL('../guestbook/index.html',import.meta.url),'utf8');
 const title=GUESTBOOK_TITLE+' · '+site.name,description=guestbookDescription(site);
 html=addSocialMetadata(html,{site,route:'/guestbook/',title,description});
 // Every site serves this same template and its messages load by script, so
 // search engines saw ten near-identical pages with no canonical. Keep it out
 // of the index (links still followed) and give each copy its own title.
 html=html.replace(/<title>[^<]*<\/title>/,()=>`<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="noindex,follow">`);
 html=addLanguageNavigation(html,{site,route:'/guestbook/',englishHome:Object.hasOwn(manifest.hashes,'en/index.html')});
 html=html.replace('<header>','<header class="guestbook-header">');
 let style=await readFile(new URL('../guestbook/style.css',import.meta.url),'utf8');
 style+='\n.guestbook-header{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px}.guestbook-header>#home{grid-column:1;grid-row:1;align-self:center}.guestbook-header>.site-language-control{grid-column:2;grid-row:1;margin:0}.guestbook-header>p,.guestbook-header>h1{grid-column:1/-1}';
 if(site.legacy){html=html.replace('<main>','<main><nav class="academic-nav" aria-label="主导航">'+renderNavigation(site,'/guestbook/')+'</nav>');style+='\n.academic-nav{display:flex;flex-wrap:wrap;gap:12px 24px;margin-bottom:32px;padding-bottom:16px;border-bottom:1px solid #d7dbd4}.academic-nav a{color:inherit;text-decoration:none}.academic-nav a[aria-current]{font-weight:700;text-decoration:underline;text-underline-offset:6px}.academic-nav a:focus-visible{outline:2px solid currentColor;outline-offset:4px}';}
 else style+='\n'+await readFile(new URL('../guestbook/color-mode.css',import.meta.url),'utf8');
 for(const [file,bytes] of [['index.html',html],['style.css',style],['app.js',await readFile(new URL('../guestbook/app.js',import.meta.url))],['config.json',JSON.stringify(config)]]){
  await writeFile(join(directory,file),bytes);manifest.hashes['guestbook/'+file]=digest(bytes);
 }
 manifest.guestbook={version:1,static:true};return manifest;
}
