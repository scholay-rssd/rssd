import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWritingDefaultsCatalog,resolveWritingDefaults} from '../contracts/writing-defaults.mjs';
import contract from '../contracts/writing-defaults-v1.cjs';
const source={repository:'scholay-rssd/rssd',commit:'a'.repeat(40),files:[{path:'contracts/writing-defaults.mjs',sha256:'b'.repeat(64)}]};
export const fixtureCatalog=()=>buildWritingDefaultsCatalog({source});
test('the canonical catalog covers every active column without enabling four retired columns',()=>{
 const c=fixtureCatalog();assert.equal(c.workspaces.length,10);assert.equal(c.workspaces.reduce((n,w)=>n+w.sections.length,0),40);
 for(const w of c.workspaces)for(const s of w.sections){const d=resolveWritingDefaults(c,w.workspaceId,s.id);assert.equal(d.mode,s.mode);assert.equal(d.images.minimum,d.familyId==='animal'?3:1);assert.equal(d.delivery.captions,true);assert.equal(d.skills.length,3);assert.equal(d.references.length,1);assert.ok(d.requiredElements.length>=3);}
 assert.throws(()=>resolveWritingDefaults(c,'academic','resources'),/没有启用/);
 assert.throws(()=>resolveWritingDefaults(c,'academic'),/没有启用/);
 assert.equal(resolveWritingDefaults(c,'academic','briefings').familyId,'briefing');
 assert.equal(resolveWritingDefaults(c,'metho','methods').familyId,'scholay-walkthrough');
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
 const effective=contract.compose(d,{origin:'local',instructions:'本篇集中比较照护环境，采用四张图片。',images:{minimum:4}});
 assert.equal(effective.images.minimum,4);assert.equal(effective.baseline.images.minimum,3);
 assert.throws(()=>contract.compose(d,{origin:'local',images:{minimum:2}}),/不能静默/);assert.equal(effective.baselineHash,d.hash);assert.equal(JSON.stringify(d),original);
 assert.ok(effective.instructions.indexOf('当前工作空间')<effective.instructions.indexOf('本篇明确的本地偏好'));
 assert.throws(()=>contract.compose(d,{images:{minimum:-1}}),/调整/);
 assert.throws(()=>contract.compose(d,{origin:'local',images:{minimum:0}}),/不能静默/);
 assert.equal(contract.compose(d,{origin:'task',instructions:'本次只整理文字草稿',images:{minimum:0}}).images.minimum,0);
});
test('delivery checks distinguish missing images, captions, and a complete image-bearing draft',()=>{
 const d=resolveWritingDefaults(fixtureCatalog(),'design','icons');
 assert.equal(contract.deliveryIssues({blocks:[]},d).length,1);
 const image={id:'icon',type:'image',state:'ready',text:'https://example.org/icon.png',alt:'白底并列展示空心圆与实心圆内的对勾图标轮廓'};
 assert.equal(contract.deliveryIssues({blocks:[image]},d).length,1);
 const caption=text=>({type:'annotation',role:'caption',targetId:'icon',state:'ready',text});
 assert.deepEqual(contract.deliveryIssues({blocks:[image,caption('图：一组对勾图标。某设计者，[Example](https://example.org/icons/check)')]},d),[]);
 assert.deepEqual(contract.deliveryIssues({blocks:[image,caption('Figure: A set of check icons. A designer, [Example](https://example.org/icons/check)')]},d),[]);
 assert.match(contract.deliveryIssues({blocks:[image,caption('图：对勾图标示意。')]},d).join(),/真实对象/);
 assert.match(contract.deliveryIssues({blocks:[image,caption('图：一组对勾图标。某设计者，[Example](https://example.org/icons/check)，CC BY 4.0')]},d).join(),/只能写一句图题/);
 assert.match(contract.deliveryIssues({blocks:[image,caption('图：一组对勾图标。某设计者，[Example](https://example.org/icons/check)[1]')]},d).join(),/只能写一句图题/);
 assert.match(contract.deliveryIssues({blocks:[image,caption('图：一组对勾图标。某设计者，[本站](https://example.org/api/rssd/v1/media/abc/raw)')]},d).join(),/出处页/);
 assert.match(contract.deliveryIssues({blocks:[image,caption('图标实际样本及来源')]},d).join(),/只能写一句图题/);
});
test('an animal section needs three different pictures, and a title-only caption passes only where pictures may be drawn',()=>{
 const c=fixtureCatalog(),cat=resolveWritingDefaults(c,'pets','daily-cat'),news=resolveWritingDefaults(c,'pets','pet-news');
 assert.equal(cat.images.minimum,3);assert.equal(cat.images.sourceMode,'actual-object');assert.equal(news.images.minimum,1);
 const picture=(id,url)=>[{id,type:'image',state:'ready',text:url,alt:'一只坐着的短毛猫，体侧斑纹和大耳朵清晰可见'},{type:'annotation',role:'caption',targetId:id,state:'ready',text:'图：坐着的短毛猫。某摄影者，[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Cat_('+id+').jpg)'}];
 assert.deepEqual(contract.deliveryIssues({blocks:[...picture('a','https://example.org/a.jpg'),...picture('b','https://example.org/b.jpg'),...picture('c','https://example.org/c.jpg')]},cat),[]);
 assert.match(contract.deliveryIssues({blocks:[...picture('a','https://example.org/a.jpg'),...picture('b','https://example.org/b.jpg')]},cat).join(),/少于本栏要求的 3 张/);
 assert.match(contract.deliveryIssues({blocks:[...picture('a','https://example.org/a.jpg'),...picture('b','https://example.org/a.jpg'),...picture('c','https://example.org/c.jpg')]},cat).join(),/重复使用只算一张/);
 const drawn=[{id:'d',type:'image',state:'ready',text:'https://example.org/d.png',alt:'示意图：宠物医院就诊流程的四个步骤依次排列'},{type:'annotation',role:'caption',targetId:'d',state:'ready',text:'图：就诊流程示意。'}];
 assert.deepEqual(contract.deliveryIssues({blocks:drawn},news),[]);
});
test('a snapshot frozen under delivery version 1 keeps its earlier checks',()=>{
 const d=resolveWritingDefaults(fixtureCatalog(),'design','icons'),{hash,...body}=d;
 const old={...body,delivery:{version:1,format:'notebook-v2-flat',altLength:true}},legacy={...old,hash:contract.hash(old)};
 const image={id:'icon',type:'image',state:'ready',text:'https://example.org/icon.png',alt:'白底并列展示空心圆与实心圆内的对勾图标轮廓'};
 assert.deepEqual(contract.deliveryIssues({blocks:[image,{type:'annotation',role:'caption',targetId:'icon',state:'ready',text:'图标实际样本及来源'}]},legacy),[]);
 const broken={...old,delivery:{version:2,format:'notebook-v2-flat',altLength:true}};
 assert.throws(()=>contract.snapshot({...broken,hash:contract.hash(broken)}),/交付检查版本/);
});
test('a section that takes notes carries the note form, and compose picks it only for a note',()=>{
 const c=fixtureCatalog(),d=resolveWritingDefaults(c,'pets','daily-cat');
 assert.deepEqual(d.note.skills.map(x=>x.id),['rssd-writing-base','rssd-writing-note','rssd-writing-animal','rssd-domain-pets']);
 assert.match(d.note.requiredElements[0],/^本栏对象的一个具体看点（本栏长文的要素：一个未重复的猫品种；/);
 assert.match(d.note.instructions,/作品类型：笔记/);assert.doesNotMatch(d.instructions,/rssd-writing-note/);
 const article=contract.compose(d),explicit=contract.compose(d,{workType:'article'}),note=contract.compose(d,{workType:'note',origin:'task'});
 assert.equal(explicit.hash,article.hash);assert.equal(article.adjustment.workType,undefined);
 assert.equal(note.workType,'note');assert.equal(note.adjustment.workType,'note');assert.notEqual(note.hash,article.hash);
 assert.match(note.instructions,/\[rssd-writing-note @/);assert.doesNotMatch(article.instructions,/\[rssd-writing-note @/);
 assert.deepEqual(note.images,article.images);
 assert.equal(contract.context({...note,retrieval:{}}).hash,note.hash);
 assert.throws(()=>contract.compose(d,{workType:'event'}),/作品类型无效/);
 // Sections that take articles only keep their earlier shape and refuse a note.
 const only=resolveWritingDefaults(c,'academic','calendar');assert.equal(only.note,undefined);
 assert.throws(()=>contract.compose(only,{workType:'note'}),/本栏不收笔记/);
 // A changed note form no longer matches the snapshot's hash.
 const changed=structuredClone(d);changed.note.instructions+=' changed';assert.throws(()=>contract.snapshot(changed));
});
test('every section that takes notes has the note form, and no other section does',async()=>{
 const {sectionWorkPolicy}=await import('../contracts/work-types.mjs'),{writableSectionsForSite}=await import('../contracts/site-sections.mjs'),{readFileSync}=await import('node:fs');
 const profiles=JSON.parse(readFileSync(new URL('../sites/profiles.json',import.meta.url))),c=fixtureCatalog();
 for(const site of profiles)for(const s of writableSectionsForSite(site)){
  const entry=c.workspaces.find(w=>w.siteId===site.id).sections.find(x=>x.id===s.id);
  assert.equal(Boolean(entry.note),sectionWorkPolicy(s).workTypes.includes('note'),site.spaceId+'/'+s.id);
 }
});
test('a section may offer another writing family, and compose uses it only when a demand chooses it',()=>{
 const c=fixtureCatalog(),d=resolveWritingDefaults(c,'metho','statistics');
 assert.equal(d.familyId,'method');assert.deepEqual(d.alternates.map(a=>a.familyId),['scholay-walkthrough']);
 const alt=d.alternates[0];
 assert.deepEqual(alt.skills.map(x=>x.id),['rssd-writing-base','rssd-writing-scholay-walkthrough','rssd-domain-metho']);
 assert.deepEqual(alt.requiredElements.slice(0,3),d.requiredElements);assert.match(alt.requiredElements.at(-1),/Scholay/);
 assert.match(alt.instructions,/文体：scholay-walkthrough/);assert.match(alt.instructions,/统计之美/);assert.doesNotMatch(d.instructions,/rssd-writing-scholay-walkthrough @/);
 // Without a choice, and when the default is named, the context and its hash are what they were before.
 const plain=contract.compose(d),named=contract.compose(d,{family:'method'}),chosen=contract.compose(d,{family:'scholay-walkthrough',origin:'task'});
 assert.equal(named.hash,plain.hash);assert.equal(plain.family,undefined);assert.equal(plain.adjustment.family,undefined);
 assert.equal(chosen.family,'scholay-walkthrough');assert.equal(chosen.adjustment.family,'scholay-walkthrough');assert.notEqual(chosen.hash,plain.hash);
 assert.match(chosen.instructions,/\[rssd-writing-scholay-walkthrough @/);assert.doesNotMatch(chosen.instructions,/\[rssd-writing-method @/);
 assert.deepEqual(chosen.images,alt.images);assert.equal(contract.context({...chosen,retrieval:{}}).hash,chosen.hash);
 // Task adjustments still apply on top of the chosen family.
 const tuned=contract.compose(d,{family:'scholay-walkthrough',origin:'task',instructions:'面向初学者。',images:{minimum:3}});
 assert.equal(tuned.images.minimum,3);assert.match(tuned.instructions,/面向初学者/);
 // A family the section does not offer, a malformed name and a note are refused.
 assert.throws(()=>contract.compose(d,{family:'animal'}),/没有提供写作族/);
 assert.throws(()=>contract.compose(d,{family:'Bad Name'}),/写作族无效/);
 assert.throws(()=>contract.compose(resolveWritingDefaults(c,'pets','daily-cat'),{family:'scholay-walkthrough'}),/没有提供写作族/);
 // A changed alternate no longer matches the snapshot's hash, and an alternate repeating the default is invalid.
 const changed=structuredClone(d);changed.alternates[0].instructions+=' changed';assert.throws(()=>contract.snapshot(changed));
 const {hash:_,...body}=structuredClone(d);body.alternates[0].familyId='method';assert.throws(()=>contract.snapshot({...body,hash:contract.hash(body)}),/备用写作族/);
});
test('only the configured research-method columns offer the Scholay family, and its captions are checked as sourced pictures',()=>{
 const c=fixtureCatalog(),offered=[];
 for(const w of c.workspaces)for(const s of w.sections)if(s.alternates)offered.push(w.workspaceId+'/'+s.id+':'+s.alternates.map(a=>a.familyId).join(','));
 assert.deepEqual(offered.sort(),['metho/experiments:scholay-walkthrough','metho/frontiers:scholay-walkthrough','metho/statistics:scholay-walkthrough']);
 assert.equal(resolveWritingDefaults(c,'metho','methods').alternates,undefined);
 // An interface demonstration caption names no maker or source page; it must pass wherever the Scholay family applies.
 const draft={blocks:[{id:'p1',type:'paragraph',state:'ready',text:'正文'},{id:'i1',type:'image',state:'ready',text:'https://example.org/a.png',alt:'Scholay 科研助手界面中的提问与第一轮回答截图，显示上传的数据表'},{id:'c1',type:'annotation',role:'caption',targetId:'i1',state:'ready',text:'图：Scholay 科研助手界面演示：提问与第一轮回答。'}]};
 assert.deepEqual(contract.deliveryIssues(draft,contract.compose(resolveWritingDefaults(c,'metho','methods'))),[]);
 assert.deepEqual(contract.deliveryIssues(draft,contract.compose(resolveWritingDefaults(c,'metho','experiments'),{family:'scholay-walkthrough',origin:'task'})),[]);
});
