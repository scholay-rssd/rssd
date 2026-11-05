import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles,siteDescriptorForHost,validateSite} from '../scripts/site-config.mjs';
import {clarityScript,verificationFiles} from '../web/engine/site-services.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';

test('analytics is site-specific and does not run in previews or private forms',()=>{
  const projects=new Set();
  for(const site of profiles){
    const script=clarityScript(site);projects.add(script.match(/data-site-analytics="([^"]+)"/)[1]);
    for(const location of [{origin:'http://127.0.0.1:4290',pathname:'/'},{origin:site.origin,pathname:'/manage/'},{origin:site.origin,pathname:'/guestbook/'}]){
      vm.runInNewContext(script.replace(/^<script[^>]*>|<\/script>$/g,''),{location,window:{},document:new Proxy({},{get(){throw Error('Preview must not load analytics');}})});
    }
  }
  assert.equal(projects.size,10);
});

test('journal SEO persists real page timestamps across unchanged builds and keeps verification files',async t=>{
  const root=await mkdtemp(join(tmpdir(),'site-seo-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const site=profiles.find(s=>s.id==='metho'),snapshot={news:[],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}};
  const options={site,source:process.cwd(),job:{id:'seo',snapshot,snapshot_hash:'unchanged'}};
  await buildSiteRelease({...options,target:join(root,'a'),now:new Date('2026-10-15T00:00:00Z')});
  await buildSiteRelease({...options,target:join(root,'b'),previousRoot:join(root,'a'),now:new Date('2026-10-16T00:00:00Z')});
  const old=JSON.parse(await readFile(join(root,'a/seo-manifest.json'))),next=JSON.parse(await readFile(join(root,'b/seo-manifest.json')));
  assert.deepEqual(next,old);
  for(const [file,content]of Object.entries(verificationFiles))assert.equal(await readFile(join(root,'b',file),'utf8'),content);
  const xml=await readFile(join(root,'b/sitemap-content.xml'),'utf8');
  assert.doesNotMatch(xml,/https:\/\/metho.scholay.com\/archive\/methods\//);assert.match(xml,/<lastmod>2026-10-15T00:00:00Z<\/lastmod>/);
  assert(!xml.includes('today.scholay.com'));
  const html=await readFile(join(root,'b/index.html'),'utf8');assert.match(html,/application\/ld\+json/);assert.match(html,/og:url/);
});

test('method and portal releases index real content and consolidate empty or duplicate directories',async t=>{
  const root=await mkdtemp(join(tmpdir(),'site-indexing-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const id of ['metho','enter']){
    const site=profiles.find(s=>s.id===id),target=join(root,id);
    const snapshot={news:[{id:'kept',title:'研究者的实际操作指南',date:'2026-10-20',category:site.publicColumns[0],summary:'这篇文章提供完整的说明和可继续阅读的入口。',markdown:'# 研究者的实际操作指南\n\n这段公开正文必须保持可索引。',author:site.name}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:kept':'/news/kept/'}};
    await buildSiteRelease({site,source:process.cwd(),target,job:{id:'indexing',snapshot,snapshot_hash:'kept'}});
    const read=path=>readFile(join(target,path),'utf8');
    const home=await read('index.html'),xml=await read('sitemap-content.xml');
    assert.match(home,/<title>[^<]+｜(?:研究设计|科研软件)/);
    assert.match(home,/<p class="directory-note">面向研究者/);
    assert.match(home,/<meta name="description" content="[^">]*面向研究者/);
    assert.match(await read('news/kept/index.html'),/name="robots" content="index,follow/);
    assert.match(xml,/<loc>[^<]+\/news\/kept\/<\/loc>/);
    assert.match(await read('archive/column-4/index.html'),/name="robots" content="noindex,follow"/);
    assert.doesNotMatch(xml,/\/archive\/column-4\//);
    assert.doesNotMatch(xml,/\/calendar\//);
    const alias=await read('journal/index.html');
    assert.match(alias,new RegExp('<link rel="canonical" href="'+site.origin.replaceAll('.','\\.')+'/archive/">'));
    assert.match(alias,/property="og:url" content="[^">]+\/archive\/"/);
    assert.doesNotMatch(alias,/name="robots" content="noindex/);
    assert.doesNotMatch(xml,/\/journal\//);
    assert.equal(JSON.parse(await read('published-content.json')).records[0].bodyMarkdown,snapshot.news[0].markdown);
  }
});

test('old domain identity is returned only for an explicit exact alias',()=>{
  const site=validateSite(profiles.find(s=>s.id==='lingxi'));
  assert.equal(siteDescriptorForHost('lingx.club',site).origin,'https://lingx.club');
  for(const host of ['xsime.com','evil.test','lingx.club.evil.test','lingx.club:81',undefined])assert.equal(siteDescriptorForHost(host,site).origin,'https://xsime.com');
});
