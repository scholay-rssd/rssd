import test from 'node:test';
import assert from 'node:assert/strict';
import {profiles} from '../scripts/site-config.mjs';
import {activeSectionsForSite,validateSectionId} from '../contracts/site-sections.mjs';
import {columnWritingInstructions} from '../contracts/editorial-column-policy.mjs';
test('40 writable columns have current rules; retired IDs remain readable but cannot produce',()=>{
 let count=0;
 for(const site of profiles)for(const section of activeSectionsForSite(site)){
  const rule=columnWritingInstructions(site,section.id);assert.match(rule,/已读取/);assert.match(rule,/肩标/);count++;
 }
 assert.equal(count,40);
 for(const id of ['resources','open-source','collaboration','courses']){
  assert.equal(validateSectionId(id,{id:'scholay-today'}),id);
  assert.throws(()=>columnWritingInstructions('scholay-today',id),/停用/);
 }
 assert.match(columnWritingInstructions('personal','reflections'),/真实笔记/);
});
