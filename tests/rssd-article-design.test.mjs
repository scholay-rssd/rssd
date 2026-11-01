import test from 'node:test';import assert from 'node:assert/strict';
import {exportDesigns,exportTemplate} from '../web/themes/export/registry.mjs';
import {articleHeading,articleStyles} from '../web/engine/browser-export/article-style.mjs';
function luminance(hex){return hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('all authored category palettes keep reading text legible in both modes',()=>{
 const identities=new Set();let count=0;
 for(const [siteId,site] of Object.entries(exportDesigns))for(const sectionId of Object.keys(site.sections)){
  const t=exportTemplate({siteId,sectionId,format:'wechat'});identities.add(t.identity);count++;
  for(const [mode,palette] of [['light',t],['dark',t.dark]])for(const key of ['ink','muted','accent'])assert.ok(contrast(palette[key],palette.paper)>=4.5,`${siteId}/${sectionId} ${mode} ${key}: ${contrast(palette[key],palette.paper)}`);
  assert.ok(t.imageRadius>=0);assert.ok(t.titleFamily);assert.ok(t.header);
 }
 assert.equal(count,89);assert.equal(identities.size,10);
});
test('portable article uses its authored light palette and never carries page navigation',()=>{
 const t=exportTemplate({siteId:'xsiching',sectionId:'classics',format:'wechat'});
 assert.match(articleStyles(t),/color-scheme:light/);assert.doesNotMatch(articleStyles(t),/light-dark\(/);assert.match(articleStyles(t,'.rssd-article',{live:true}),/light-dark\(/);
 const heading=articleHeading({title:'<安全标题>',site:{name:'国学'},sectionName:'经典',author:'作者',date:'2026-11-01'});
 assert.match(heading,/&lt;安全标题&gt;/);assert.doesNotMatch(heading,/<a|返回|All articles/);
});
