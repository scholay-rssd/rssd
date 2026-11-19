import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {guestbookBody,guestbookShell} from '../web/engine/guestbook-page.mjs';

test('the guestbook body inside a site shell keeps every element app.js uses, without the standalone home link',async()=>{
 const body=await guestbookBody();
 for(const id of ['site','quota','form','kind','details','send','status','messages'])assert.match(body,new RegExp(`id="${id}"`));
 assert.doesNotMatch(body,/id="home"|<main>|<footer>/);
 assert.match(body,/^<article class="guestbook"><section class="hero compact">/);assert.match(body,/<p class="guestbook-footnote">/);
});

test('a shell page for the guestbook meets its policy: no inline style or script, its own assets, noindex, the accent as data',()=>{
 const shell='<!doctype html><html><head><title>留言板</title><meta name="robots" content="index,follow,max-image-preview:large"><script type="application/ld+json">{"a":1}</script><script data-site-analytics="x">track()</script><script defer src="/site-language.js"></script><style>:root{--accent:#385b49;--blog-accent:#385b49}</style></head><body data-site="xsime"><main></main></body></html>';
 const html=guestbookShell(shell);
 assert.doesNotMatch(html,/<style\b|<script(?![^>]*\bsrc=)[^>]*>/);
 assert.match(html,/<script defer src="\/site-language.js"><\/script>/);
 assert.match(html,/<link rel="stylesheet" href="\/guestbook\/style.css"><script src="\/guestbook\/app.js" defer><\/script><\/head>/);
 assert.match(html,/<meta name="robots" content="noindex,follow">/);
 assert.match(html,/<body data-accent="#385b49" data-site="xsime">/);
});

test('the component stylesheet colours the guestbook only with site tokens, and app.js leaves a shell page to its theme',async()=>{
 const css=await readFile(new URL('../web/guestbook/site.css',import.meta.url),'utf8');
 assert.doesNotMatch(css.replace(/light-dark\([^)]*\)/g,''),/#[0-9a-f]{3,6}\b/i);
 assert.doesNotMatch(css,/@import|url\(/);
 const app=await readFile(new URL('../web/guestbook/app.js',import.meta.url),'utf8');
 assert.match(app,/hasAttribute\('data-site'\)/);assert.match(app,/if\(\$\('#home'\)\)/);assert.doesNotMatch(app,/innerHTML/);
});

test('a journal site serves its guestbook inside its own shell, within the guestbook policy and out of the sitemap',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const {profiles}=await import('../scripts/site-config.mjs'),{buildSiteRelease}=await import('../web/engine/render-site.mjs');
 const root=await mkdtemp(join(tmpdir(),'guestbook-shell-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const component=await readFile(new URL('../web/guestbook/site.css',import.meta.url),'utf8');
 // Authored homepages (personal, piggytuck) need their own builds; the shell around the guestbook is the same.
 for(const profile of profiles.filter(s=>!s.legacy&&s.services?.guestbook?.enabled&&!['personal','piggytuck'].includes(s.id))){
  const site={...profile,themeId:'journal'},target=join(root,site.id);
  const snapshot={news:[{id:'note',title:'A note',category:site.columns[1],date:'2026-10-16',markdown:'# A note\n\nBody.'}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:note':'/news/note/'}};
  await buildSiteRelease({site,source:process.cwd(),target,job:{id:'guestbook-'+site.id,snapshot,snapshot_hash:'fixture'}});
  const html=await readFile(join(target,'guestbook/index.html'),'utf8');
  assert.match(html,new RegExp(`<body[^>]* data-site="${site.id}"`));assert.match(html,/<header class="site-header">/);
  assert.match(html,/<a [^>]*aria-current="page"[^>]*>留言板<\/a>/);
  assert.match(html,/<link rel="stylesheet" href="\/site-theme.css">/);assert.match(html,/<article class="guestbook">/);
  assert.doesNotMatch(html,/<style\b|<script(?![^>]*\bsrc=)[^>]*>|\sstyle="/);
  assert.match(html,/<meta name="robots" content="noindex,follow">/);
  assert.equal(await readFile(join(target,'guestbook/style.css'),'utf8'),component);
  assert.doesNotMatch(await readFile(join(target,'sitemap-content.xml'),'utf8'),/\/guestbook\//);
  assert.equal(JSON.parse(await readFile(join(target,'release.json'),'utf8')).guestbook.static,true);
 }
});
