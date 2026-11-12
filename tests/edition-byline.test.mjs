import test from 'node:test';
import assert from 'node:assert/strict';
import {siteByline,withEditionByline} from '../contracts/edition-byline.mjs';
import {profiles} from '../scripts/site-config.mjs';

test('the site profile gives the byline and the section display name',()=>{
  assert.deepEqual(['statistics','methods','frontiers','experiments'].map(id=>siteByline(profiles,'metho',id)),[
    {author:'研究方法',category:'统计之美'},{author:'研究方法',category:'方法百科'},
    {author:'研究方法',category:'方法前沿'},{author:'研究方法',category:'实验星球'}]);
  // Center workspaces are site space IDs, not site IDs.
  const today=profiles.find(site=>site.id==='scholay-today');
  assert.equal(siteByline(profiles,today.spaceId,'briefings').author,today.author);
  assert.equal(siteByline(profiles,'scholay-today','briefings').author,'');
  for(const site of profiles)assert.ok(siteByline(profiles,site.spaceId,'missing-section').author,site.id+' has a byline');
});

test('an unknown space or section gives no default',()=>{
  assert.deepEqual(siteByline(profiles,'unknown','methods'),{author:'',category:''});
  assert.deepEqual(siteByline(profiles,'metho','unknown'),{author:'研究方法',category:''});
  assert.deepEqual(siteByline(null,'metho','methods'),{author:'',category:''});
  assert.deepEqual(siteByline([{spaceId:'s',author:'  ',sections:[{id:'a',name:''}]}],'s','a'),{author:'',category:''});
});

test('the source edition wins, then the site; the agent never chooses',()=>{
  const site={author:'研究方法',category:'统计之美'};
  const edition={title:'T',metadata:{author:'Codex',category:'AI',platformContent:{x:1},notebook:{version:2}}};
  const fresh=withEditionByline(edition,{site});
  assert.deepEqual(fresh.metadata,{author:'研究方法',category:'统计之美',platformContent:{x:1},notebook:{version:2}});
  assert.equal(edition.metadata.author,'Codex','the input is not changed');
  const kept=withEditionByline(edition,{site,source:{payload:{metadata:{author:'特约作者',category:'方法百科'}}}});
  assert.deepEqual([kept.metadata.author,kept.metadata.category],['特约作者','方法百科']);
  const blankSource=withEditionByline(edition,{site,source:{payload:{metadata:{author:' ',category:''}}}});
  assert.deepEqual([blankSource.metadata.author,blankSource.metadata.category],['研究方法','统计之美']);
  const mixed=withEditionByline(edition,{site,source:{payload:{metadata:{author:'特约作者'}}}});
  assert.deepEqual([mixed.metadata.author,mixed.metadata.category],['特约作者','统计之美']);
});

test('with neither a source nor a site value the field is left out',()=>{
  const none=withEditionByline({title:'T',metadata:{author:'Codex',category:'AI',date:'2026-11-12'}},{site:{author:'',category:''}});
  assert.deepEqual(none.metadata,{date:'2026-11-12'});
  assert.deepEqual(withEditionByline({title:'T'},{}).metadata,{});
});
