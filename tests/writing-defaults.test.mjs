import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWritingDefaultsCatalog,resolveWritingDefaults} from '../contracts/writing-defaults.mjs';
import contract from '../contracts/writing-defaults-v1.cjs';
const source={repository:'scholay-rssd/rssd',commit:'a'.repeat(40),files:[{path:'contracts/writing-defaults.mjs',sha256:'b'.repeat(64)}]};
export const fixtureCatalog=()=>buildWritingDefaultsCatalog({source});
test('the canonical catalog covers every active column without enabling four retired columns',()=>{
 const c=fixtureCatalog();assert.equal(c.workspaces.length,10);assert.equal(c.workspaces.reduce((n,w)=>n+w.sections.length,0),40);
 for(const w of c.workspaces)for(const s of w.sections){const d=resolveWritingDefaults(c,w.workspaceId,s.id);assert.equal(d.mode,s.mode);assert.equal(d.images.minimum,1);assert.equal(d.skills.length,3);assert.equal(d.references.length,1);assert.ok(d.requiredElements.length>=3);}
 assert.throws(()=>resolveWritingDefaults(c,'academic','resources'),/没有启用/);
 assert.throws(()=>resolveWritingDefaults(c,'academic'),/没有启用/);
 assert.equal(resolveWritingDefaults(c,'academic','briefings').familyId,'briefing');
 assert.equal(resolveWritingDefaults(c,'metho','methods').familyId,'method');
 assert.equal(resolveWritingDefaults(c,'design','icons').images.sourceMode,'actual-object');
 assert.equal(resolveWritingDefaults(c,'enter','courses').familyId,resolveWritingDefaults(c,'xsiching','courses').familyId);
});
test('online snapshots reject wrong scope, changed policy, altered data and missing provenance',()=>{
 const d=resolveWritingDefaults(fixtureCatalog(),'pets','daily-cat');assert.equal(contract.snapshot(d,{workspaceId:'pets',sectionId:'daily-cat'}).hash,d.hash);
 assert.throws(()=>contract.snapshot(d,{workspaceId:'metho'}),/不匹配/);
 for(const mutate of [v=>v.instructions+=' changed',v=>v.images.minimum=0,v=>v.source.commit='main',v=>v.writingPolicy.instructions+=' changed']){const v=structuredClone(d);mutate(v);assert.throws(()=>contract.snapshot(v));}
});
test('a local scale is applied after and separately from the unchanged online baseline',()=>{
 const d=resolveWritingDefaults(fixtureCatalog(),'pets','daily-cat'),original=JSON.stringify(d);
 const effective=contract.compose(d,{origin:'local',instructions:'本篇集中比较照护环境，采用两张图片。',images:{minimum:2}});
 assert.equal(effective.images.minimum,2);assert.equal(effective.baseline.images.minimum,1);assert.equal(effective.baselineHash,d.hash);assert.equal(JSON.stringify(d),original);
 assert.ok(effective.instructions.indexOf('当前工作空间')<effective.instructions.indexOf('本篇明确的本地偏好'));
 assert.throws(()=>contract.compose(d,{images:{minimum:-1}}),/调整/);
 assert.throws(()=>contract.compose(d,{origin:'local',images:{minimum:0}}),/不能静默/);
 assert.equal(contract.compose(d,{origin:'task',instructions:'本次只整理文字草稿',images:{minimum:0}}).images.minimum,0);
});
test('delivery checks distinguish missing images, captions, and a complete image-bearing draft',()=>{
 const d=resolveWritingDefaults(fixtureCatalog(),'design','icons');
 assert.equal(contract.deliveryIssues({blocks:[]},d).length,1);
 const image={id:'icon',type:'image',state:'ready',text:'https://example.org/icon.png',alt:'实际图标的轮廓与转角'};
 assert.equal(contract.deliveryIssues({blocks:[image]},d).length,1);
 assert.deepEqual(contract.deliveryIssues({blocks:[image,{type:'annotation',role:'caption',targetId:'icon',state:'ready',text:'图标实际样本及来源'}]},d),[]);
});
