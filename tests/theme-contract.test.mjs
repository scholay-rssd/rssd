import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptPublishedSnapshot} from '../web/engine/published-content.mjs';
import {resolveTheme} from '../web/themes/registry.mjs';
import {validatePublishedContent} from '../contracts/published-content.mjs';
import {profiles} from '../scripts/site-config.mjs';
const site=profiles.find(s=>s.id==='xsime');
const snapshot={news:[{id:'human-note',title:'人工整理',category:site.columns[1],markdown:'# 人工整理\n\n正文',date:'2026-10-13'}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{}};
test('themes consume the same read-only publication model without modifying sources or identity',()=>{
 const before=JSON.stringify(snapshot),content=adaptPublishedSnapshot(snapshot,site);
 assert.equal(content.records[0].type,'article');assert.equal(content.records[0].bodyMarkdown,snapshot.news[0].markdown);
 const route=content.records[0].route,id=content.records[0].id;
 assert.equal(resolveTheme(site,content).id,'docs');assert.equal(resolveTheme({...site,themeId:'encyclopedia'},content).id,'encyclopedia');
 assert.equal(content.records[0].route,route);assert.equal(content.records[0].id,id);assert.equal(JSON.stringify(snapshot),before);
 assert.throws(()=>resolveTheme({...site,id:'pets'},content),/another site/);
 assert.throws(()=>resolveTheme({...site,themeId:'missing'},content),/Unsupported/);
});
test('invalid routes and duplicate content IDs stop rendering',()=>{
 const content=adaptPublishedSnapshot(snapshot,site);
 assert.throws(()=>validatePublishedContent({...content,records:[...content.records,...content.records]}),/duplicate/);
 assert.throws(()=>validatePublishedContent({...content,records:[{...content.records[0],route:'//evil.example/'}]}),/route/);
});
