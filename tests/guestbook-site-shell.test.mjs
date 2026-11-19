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
