import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {digest,sourceKey} from '../../admin/model.mjs';
import {asEditorialRecord} from '../../scripts/editorial-record.mjs';
import {articleLocale,sourceContentSha256} from '../../contracts/language-editions.mjs';
import {sourceHasher} from './source-hash-v1.mjs';
import {renderArticleParts,mathStyles} from './article-math.mjs';
import {renderRssFeed} from './rss-feed.mjs';
import {createSeoState,sitemapXml} from '../../scripts/seo-state.mjs';
import {byteHash} from './theme-homepage.mjs';
import {addSocialMetadata} from './social-metadata.mjs';
import {familyFooter} from './site-family.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const englishBrands=Object.freeze({
 'scholay-today':{name:'Scholay Today',slogan:'Make steady progress, one step a day.'},
 metho:{name:'Metho · Research Methods',slogan:'Rituals can be copied. Understanding cannot be faked.'},
 enter:{name:'Academic Gateway',slogan:"A scholar’s guide to life in the intelligent age."},
 legis:{name:'Xishu Legal',slogan:'Law is the art of the rules of the game.'},
 xsiching:{name:'Xishu Chinese Classics',slogan:'Insight in mind, craft in words.'},
 study:{name:'Intelligent Academy',slogan:'Your own academy for the intelligent age.'},
});
export function originalLanguageSnapshot(snapshot){
 const editions=new Set((snapshot.news||[]).filter(x=>articleLocale(x)!=='zh-CN').map(x=>'news:'+x.id));
 return {...snapshot,news:(snapshot.news||[]).filter(x=>articleLocale(x)==='zh-CN'),permalinks:Object.fromEntries(Object.entries(snapshot.permalinks||{}).filter(([id,route])=>!editions.has(id)&&!route.startsWith('/en/')))};
}
function alternates(site,zh,en){return [['zh-CN',zh],['en',en],['x-default',zh]].map(([lang,route])=>`<link rel="alternate" hreflang="${lang}" href="${esc(site.origin+route)}">`).join('');}
function languageSwitch(zh,en,locale){return `<nav class="language-switch" aria-label="${locale==='en'?'Article language':'文章语言'}"><a data-language-switch="zh-CN" href="${esc(zh)}"${locale==='zh-CN'?' aria-current="page"':''}>中文</a> · <a data-language-switch="en" href="${esc(en)}"${locale==='en'?' aria-current="page"':''}>English</a></nav>`;}
function addLanguageUi(html,{site,zh,en,locale}){
 html=html.replace(/<link\b[^>]*\bhreflang=["'][^"']+["'][^>]*>/g,'');
 if(!zh)return html.replace('</head>',`<link rel="alternate" hreflang="en" href="${esc(site.origin+en)}"></head>`);
 html=html.replace('</head>',alternates(site,zh,en)+'</head>');
 html=html.replace('</header>',languageSwitch(zh,en,locale)+'</header>');
 return html.replace('</body>','<script defer src="/site-language.js"></script></body>');
}
function EnglishShell(template,{site,title,summary,route,body,sourceRoute,index=false,directory="/en/"}){
 const brand=englishBrands[site.id]||{name:site.name,slogan:site.slogan||''};
 const url=site.origin+route,academic=/class="seo-main"|class="[^"]*\bapp-bar\b/.test(template);
 const themeButton=academic?(template.match(/<button\b[^>]*\bid="theme-toggle"[^>]*>[\s\S]*?<\/button>/)?.[0]||''):'';
 const siteLinks=academic?(template.match(/<div\b[^>]*\bclass="site-links"[^>]*>[\s\S]*?<\/div>/)?.[0]||''):'';
 if(academic&&index)body=body.replace('class="hero compact"','class="collection-hero"').replace('class="entries"','class="record-grid"').replace(/class="entry"/g,'class="record-card"').replace(/class="entry-meta"/g,'class="eyebrow"').replace(/class="read"/g,'class="read-more"');
 const brandLink=academic?`<a class="app-bar-brand" href="/en/"><span>${esc(brand.name)}</span></a>`:`<a class="brand" href="/en/" aria-label="${esc(brand.name)} · Home" title="Home"><span class="brand-monogram" aria-hidden="true">${esc(brand.name[0])}</span><span>${esc(brand.name)}</span></a>`;
 let html=template.replace(/<html\b[^>]*>/,'<html lang="en">')
  .replace(/<title>[\s\S]*?<\/title>/,`<title>${esc(title)} · ${esc(brand.name)}</title>`)
  .replace(/<meta\b[^>]*name=["']description["'][^>]*>/,`<meta name="description" content="${esc(summary)}">`)
  .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/,`<link rel="canonical" href="${esc(url)}">`)
  .replace(/<meta\b[^>]*(?:name|property)=["'](?:og:title|og:description|og:url|og:type|article:modified_time|twitter:title|twitter:description)["'][^>]*>/g,'')
  .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/g,'')
  .replace(/<script\b[^>]*src=["']\/(?:app|archive|calendar-data|calendar-model|content-feed)\.js[^"']*["'][^>]*>[\s\S]*?<\/script>/g,'')
  .replace(/<script\b[^>]*src=["']\/community\/discussion-links\.v1\.js["'][^>]*>[\s\S]*?<\/script>/g,'')
  .replace(/<meta\b[^>]*name=["']robots["'][^>]*>/,`<meta name="robots" content="index,follow,max-image-preview:large">`);
 const main=/<main\b[^>]*>[\s\S]*?<\/main>/;
 if(!main.test(html))throw Error('Theme has no recognized content slot for language edition');
 html=html.replace(main,`<main id="main"${academic?' class="seo-main"':''}>${body}</main>`);
 // Keep each Theme's authored shell and assets. Only the language view's own
 // header/footer slots are localized; translated prose is never string-replaced.
 html=html.replace(/<header\b([^>]*)>[\s\S]*?<\/header>/,(_,attrs)=>`<header${attrs}>${academic?'<div class="app-bar-inner">':''}${brandLink}<nav${academic?' class="main-nav"':''} aria-label="Main navigation">${academic?'<div class="section-nav">':''}<a href="${esc(directory)}">Articles</a><a href="/">Chinese site</a>${academic?'</div>':''}</nav>${themeButton}${siteLinks}${academic?'</div>':''}</header>`)
  .replace(/<footer\b([^>]*)>[\s\S]*?<\/footer>/,(_,attrs)=>`<footer${attrs}><span>${esc(brand.name)} · ${esc(brand.slogan)}</span><span class="footer-links"><a href="/en/content-feed.xml">RSS</a><a href="/">中文</a></span>${familyFooter(site.id)}</footer>`)
  .replace(/<a\b[^>]*class=["']skip["'][^>]*>[\s\S]*?<\/a>/g,'<a class="skip" href="#main">Skip to content</a>');
 const schema={'@context':'https://schema.org','@type':index?'CollectionPage':'Article','@id':url,url,inLanguage:'en',name:title,...(!index?{headline:title,mainEntityOfPage:url}:{}),description:summary,isPartOf:{'@type':'WebSite','@id':site.origin+'/#website',url:site.origin+'/',name:brand.name}};
 const head=`<meta property="og:type" content="${index?'website':'article'}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(summary)}"><meta property="og:url" content="${esc(url)}"><link rel="alternate" type="application/rss+xml" title="${esc(brand.name)} RSS" href="/en/content-feed.xml"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>${mathStyles(body)}`;
 if(academic&&!/href=["']\/seo\.css(?:[?"'])/.test(html))html=html.replace('</head>','<link rel="stylesheet" href="/seo.css"></head>');
 html=html.replace(/<link\b[^>]*type=["']application\/rss\+xml["'][^>]*>/g,'').replace('</head>',head+'</head>');
 if(!index)html=html.replace('</body>','<script defer src="/language-discussion.js"></script></body>');
 return addLanguageUi(addSocialMetadata(html,{site:{...site,name:brand.name},route,title,description:summary}),{site,zh:sourceRoute,en:route,locale:'en'});
}

export async function renderLanguagePages({job,target,previousRoot,site,now,manifest}){
 const all=job.snapshot.news||[],structuredByKey=new Map(['year','history','openSource'].flatMap(kind=>((kind==='openSource'?job.snapshot.openSource?.items:job.snapshot.data?.[kind])||[]).map(data=>[sourceKey(kind,data),data])));
 const structured=(job.snapshot.editorialRecords||[]).map(row=>{const data=structuredByKey.get(row.key);return data?{...asEditorialRecord({id:row.documentId,kind:row.kind,updated:row.updated},data),sourceRoute:job.snapshot.permalinks?.[row.key]}:null;}).filter(x=>x?.sourceRoute);
 const sources=new Map([...all.filter(x=>articleLocale(x)==='zh-CN'),...structured].map(x=>[x.id,x]));
 const editions=all.filter(x=>x.locale==='en'&&site.languages?.includes('en'));
 if(site.languages?.includes('en')){
  const identities=JSON.stringify({version:1,siteId:site.id,articles:Object.fromEntries([...all,...structured].map(data=>[data.id,{sha256:sourceContentSha256(data),route:data.sourceRoute||job.snapshot.permalinks?.['news:'+data.id]||'/news/'+data.id+'/',locale:articleLocale(data),...(data.translationOf?{translationOf:data.translationOf}:{})}]))});
  await writeFile(join(target,'publishing-identities.json'),identities);manifest.hashes['publishing-identities.json']=digest(identities);
 }
 if(!site.languages?.includes('en'))return manifest;
 // Custom homepages keep their compiled HTML and hydration data. The shared
 // English article directory has its own static route next to that homepage.
 const custom=Boolean(manifest.homepage);
 let nativeEnglishHome=false;
 if(custom)try{await readFile(join(target,'en/index.html'));nativeEnglishHome=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 const directory=nativeEnglishHome?'/en/journal/':'/en/';
 let prior={};if(previousRoot)try{prior=JSON.parse(await readFile(join(previousRoot,'language-seo.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const seo=createSeoState(prior,now),paths=new Map(),write=async(path,bytes)=>{
  await mkdir(dirname(join(target,path)),{recursive:true});await writeFile(join(target,path),bytes);
  manifest.hashes[path]=digest(bytes);
  if(Object.hasOwn(manifest.byteHashes||{},path))manifest.byteHashes[path]=byteHash(bytes);
 };
 const records=[];
 for(const data of editions){
  const original=sources.get(data.translationOf?.articleId||(data.translationSourceStatus==='unknown'?data.translationCandidateArticleId:null)),sourceRoute=original?(original.sourceRoute||job.snapshot.permalinks?.['news:'+original.id]||'/news/'+original.id+'/'):null;
  const route=job.snapshot.permalinks?.['news:'+data.id]||'/en/news/'+(original?.id||data.id)+'/';
  if(!/^\/en\/(?:[A-Za-z0-9_\-\u0080-\uFFFF]+\/)+$/.test(route))throw Error('Invalid English article permalink');
  const file=sourceRoute?sourceRoute.slice(1)+'index.html':custom?'journal/index.html':'index.html',template=await readFile(join(target,file),'utf8');
  const rendered=renderArticleParts(data.markdown.replace(/^# [^\n]+\n+/,''),{site});
  const hashSource=data.translationSourceStatus==='verified'?sourceHasher(data.translationSourceHashVersion,sourceContentSha256,{requiresVersion:true}):sourceContentSha256;
  const stale=Boolean(original&&data.translationOf&&hashSource(original)!==data.translationOf.sha256);
  const unknown=data.translationSourceStatus==='unknown',sourceMissing=data.translationSourceStatus==='verified'&&!original;
  const body=`<article class="${/class="seo-main"/.test(template)?'record-page news-article':'reading'}"${sourceRoute?` data-community-source-route="${esc(sourceRoute)}"`:''}><a class="back" href="/en/">← All articles</a><div class="entry-meta">${esc(data.date)} · ${esc(data.author)}</div>${unknown?'<p class="muted">This English edition has an unverified source revision.</p>':sourceMissing?'<p class="muted">This English edition’s source is currently unavailable.</p>':stale?'<p class="muted">This English edition reflects an earlier revision of the Chinese source.</p>':''}<div class="prose"><h1>${esc(data.title)}</h1><p class="lead">${esc(data.summary)}</p><div class="article-body">${rendered.body}</div>${rendered.endnotes?`<div class="article-body article-endnotes">${rendered.endnotes}</div>`:''}</div></article>`;
  const english=EnglishShell(template,{site,title:data.title,summary:data.summary,route,body,sourceRoute,directory}).replace(/href="\/en\/">(Articles|← All articles)/g,`href="${directory}">$1`);
  await write(route.slice(1)+'index.html',english);paths.set(route,seo.page(route,english).lastmod);
  if(sourceRoute){const chinese=addLanguageUi(template,{site,zh:sourceRoute,en:route,locale:'zh-CN'});await write(file,chinese);paths.set(sourceRoute,seo.page(sourceRoute,chinese).lastmod);}
  records.push({id:data.id,...(original?{sourceArticleId:original.id,sourceUrl:site.origin+sourceRoute}:{}),route,url:site.origin+route,locale:'en',title:data.title,summary:data.summary,date:data.date,category:data.category,bodyMarkdown:data.markdown,translationOf:data.translationOf,contentSha256:sourceContentSha256(data),stale:unknown||sourceMissing||data.translationSourceStatus==='independent'?null:stale,...(data.translationSourceStatus==='verified'?{sourceHashVersion:data.translationSourceHashVersion}:{}),sourceVersionState:unknown?'unknown':sourceMissing?'source_unavailable':data.translationSourceStatus==='independent'?'independent':data.translationSourceStatus==='verified'?(stale?'stale':'current'):'legacy'});
 }
 const home=await readFile(join(target,custom?'journal/index.html':'index.html'),'utf8'),brand=englishBrands[site.id]||{name:site.name,slogan:site.slogan||''};
 const cards=records.slice().sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).map(r=>`<article class="entry"><div class="entry-meta">${esc(r.date)}</div><h2><a href="${esc(r.route)}">${esc(r.title)}</a></h2><p>${esc(r.summary)}</p><a class="read" href="${esc(r.route)}">Read article ↗</a></article>`).join('');
 const englishHome=EnglishShell(home,{site,title:brand.name,summary:brand.slogan,route:directory,sourceRoute:custom?'/journal/':'/',index:true,directory,body:`<section class="hero compact"><h1>${esc(brand.name)}</h1><p>${esc(brand.slogan)}</p></section><section class="entries">${cards||'<p>No English articles have been published yet.</p>'}</section>`});
 await write(directory.slice(1)+'index.html',englishHome);paths.set(directory,seo.page(directory,englishHome).lastmod);
 if(nativeEnglishHome){
  const groups=new Map();for(const record of records){const category=record.category||'Articles';groups.set(category,[...(groups.get(category)||[]),record]);}
  const archiveBody='<h1>Categories</h1>'+([...groups].map(([category,items])=>`<section class="entries"><h2>${esc(category)}</h2>${items.map(r=>`<article class="entry"><h3><a href="${esc(r.route)}">${esc(r.title)}</a></h3><p>${esc(r.summary)}</p></article>`).join('')}</section>`).join('')||'<p>No English articles have been published yet.</p>');
  const archive=EnglishShell(home,{site,title:'Categories',summary:brand.slogan,route:'/en/archive/',sourceRoute:'/archive/',index:true,directory,body:archiveBody});
  await write('en/archive/index.html',archive);paths.set('/en/archive/',seo.page('/en/archive/',archive).lastmod);
 }
 if(!custom){const chineseHome=addLanguageUi(home,{site,zh:'/',en:'/en/',locale:'zh-CN'});await write('index.html',chineseHome);paths.set('/',seo.page('/',chineseHome).lastmod);}
 await write('site-language.js',await readFile(new URL('./site-language.js',import.meta.url),'utf8'));
 await write('language-discussion.js',await readFile(new URL('../modules/discussion/discussion-links.v1.js',import.meta.url),'utf8'));
 await write('en/published-content.json',JSON.stringify({version:1,siteId:site.id,locale:'en',records}));
 await write('language-editions.json',JSON.stringify({version:1,siteId:site.id,languages:['zh-CN','en'],editions:records.map(({bodyMarkdown,...r})=>r)}));
 const feed=records.map(r=>({...r,category:'Research articles',markdown:r.bodyMarkdown}));
 await write('en/content-feed.xml',renderRssFeed({...site,name:brand.name,description:brand.slogan},feed,{feedPath:'/en/content-feed.xml',language:'en'}));
 // Add a normal sitemap, not an index nested inside another sitemap index.
 const englishEntries=[...paths].filter(([p])=>p.startsWith('/en/')).map(([route,lastmod])=>({loc:site.origin+route,lastmod}));
 await write('sitemap-en.xml',sitemapXml(englishEntries));
 const sitemapFile=join(target,'sitemap.xml');let sitemap=await readFile(sitemapFile,'utf8');
 if(!sitemap.includes('</sitemapindex>'))throw Error('Expected the Theme sitemap index');
 const latestEnglish=englishEntries.map(e=>e.lastmod).sort().at(-1);
 sitemap=sitemap.replace('</sitemapindex>',`<sitemap><loc>${esc(site.origin)}/sitemap-en.xml</loc><lastmod>${latestEnglish}</lastmod></sitemap></sitemapindex>`);await write('sitemap.xml',sitemap);
 for(const path of Object.keys(manifest.hashes).filter(p=>/^sitemap[^/]*\.xml$/.test(p)&&!['sitemap.xml','sitemap-en.xml'].includes(p))){
  const xml=await readFile(join(target,path),'utf8');
  const next=xml.replace(/<url>[\s\S]*?<\/url>/g,entry=>{
   const loc=entry.match(/<loc>([^<]+)<\/loc>/)?.[1];if(!loc?.startsWith(site.origin+'/'))return entry;
   const modified=paths.get(loc.slice(site.origin.length));return modified?entry.replace(/<lastmod>[^<]+<\/lastmod>/,`<lastmod>${modified}</lastmod>`):entry;
  });if(next!==xml)await write(path,next);
 }
 const seoFile=join(target,'seo-manifest.json');const baseSeo=JSON.parse(await readFile(seoFile,'utf8'));
 baseSeo.languageBasePages=Object.fromEntries([...paths.keys()].filter(route=>!route.startsWith('/en/')&&baseSeo.pages[route]).map(route=>[route,baseSeo.pages[route]]));
 Object.assign(baseSeo.pages,seo.pages);await write('seo-manifest.json',JSON.stringify(baseSeo));
 await write('language-seo.json',JSON.stringify({version:2,pages:seo.pages,files:seo.files}));
 manifest.languages=['zh-CN','en'];manifest.counts={...manifest.counts,languageEditions:editions.length};
 await writeFile(join(target,'release.json'),JSON.stringify(manifest));return manifest;
}
