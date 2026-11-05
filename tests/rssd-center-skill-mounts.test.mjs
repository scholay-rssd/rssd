import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import {centerWritingScope,centerSkillIds,centerSkillSnapshot,validateCenterSkillSnapshot} from '../desktop/scripts/agent/center-skill-mounts.mjs';
import protocol from '../contracts/rssd-v1.cjs';
import {centerWritingPrompt} from '../desktop/scripts/agent/center-producer.mjs';

const policy={version:'policy-v2',instructions:'Authority: public and private notes are separate.'};
async function fixture(t,{sectionId='statistics',skills=['site-writing','statistics-explainer']}={}){
 const data=await mkdtemp(join(tmpdir(),'rssd-center-skills-'));t.after(()=>rm(data,{recursive:true,force:true}));const home=join(data,'center'),dir=join(home,'jobs','one'),workspace=join(data,'workspace');await mkdir(dir,{recursive:true});await mkdir(join(workspace,'_ops/inventory'),{recursive:true});await writeFile(join(workspace,'_ops/inventory/article-index.json'),'{}');await writeFile(join(workspace,'.site.json'),JSON.stringify({id:'metho',spaceId:'metho'}));await mkdir(join(data,'spaces/metho'),{recursive:true});await writeFile(join(data,'spaces/metho/editorial-workspace.json'),JSON.stringify({path:workspace}));for(const id of skills){await mkdir(join(workspace,'.agents/skills',id),{recursive:true});await writeFile(join(workspace,'.agents/skills',id,'SKILL.md'),`---\nname: ${id}\nmetadata:\n  version: 2026.10.16-r2\n---\n# ${id}\nReal article guidance for ${id}.\n`);}
 return {data,home,dir,workspace,claim:{id:'demand-one',generation:1,workspaceId:'metho',sectionId,title:'Fixture',payload:{brief:'topic requirements',policy:{}}},env:{SCHOLAY_GLOBAL_APP_DATA:data}};
}

test('all ten canonical sites and sections select only explicit existing domain rules',()=>{
 for(const profile of profiles){for(const section of sectionsForSite(profile)){const scope=centerWritingScope({workspaceId:profile.spaceId,sectionId:section.id});const ids=centerSkillIds(scope);assert.equal(scope.siteId,profile.id);assert(ids.includes('site-writing'));assert(!ids.includes('humanizer'));assert(!ids.includes('copy-editing'));}}
 assert.deepEqual(centerSkillIds(centerWritingScope({workspaceId:'metho',sectionId:'statistics'})),['site-writing','statistics-explainer']);
 assert.deepEqual(centerSkillIds(centerWritingScope({workspaceId:'metho',sectionId:'experiments'})),['site-writing','experiment-design','statistics-explainer']);
 assert.throws(()=>centerWritingScope({workspaceId:'metho',sectionId:'methods'},{siteId:'pets',workspaceId:'metho',sectionId:'methods',mode:'encyclopedia'}),/不匹配/);
});

test('real skill content is private, versioned, frozen for restart and explicitly scoped to policy',async t=>{
 const f=await fixture(t),args={claim:f.claim,directory:f.dir,writingPolicy:policy,env:f.env},first=await centerSkillSnapshot(args);assert.deepEqual(first.skills.map(s=>s.id),['site-writing','statistics-explainer']);assert.match(first.skills[1].content,/Real article guidance/);assert.equal(first.skills[1].version,'2026.10.16-r2');
 const file=join(f.dir,'writing-skills.json'),mode=(await import('node:fs/promises')).stat;assert.equal((await mode(file)).mode&0o777,0o600);await writeFile(join(f.workspace,'.agents/skills/statistics-explainer/SKILL.md'),'changed');const replay=await centerSkillSnapshot(args);assert.deepEqual(replay,first);
 const prompt=centerWritingPrompt({claim:f.claim,locale:'zh-CN',writingPolicy:policy,writingSkills:first});assert(prompt.includes(first.skills[1].content));assert(prompt.includes(first.skills[1].contentHash));assert.match(prompt,/冲突的旧要求不叠加/);assert.doesNotMatch(prompt,new RegExp(f.workspace.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 await assert.rejects(centerSkillSnapshot({...args,writingPolicy:{...policy,instructions:'changed'}}),/快照不匹配/);await assert.rejects(centerSkillSnapshot({...args,claim:{...f.claim,id:'other-demand'}}),/快照不匹配/);
 const corrupt=JSON.parse(await readFile(file,'utf8'));corrupt.skills[0].content+='tamper';await writeFile(file,JSON.stringify(corrupt));await assert.rejects(centerSkillSnapshot(args),/快照损坏/);
});

test('missing skills, invalid site bindings and symlink escapes stop explicitly without a fallback',async t=>{
 const a=await fixture(t,{skills:['site-writing']});await assert.rejects(centerSkillSnapshot({claim:a.claim,directory:a.dir,writingPolicy:policy,env:a.env}),/缺少必需写作技能/);
 const b=await fixture(t);await writeFile(join(b.workspace,'.site.json'),JSON.stringify({id:'pets',spaceId:'pets'}));await assert.rejects(centerSkillSnapshot({claim:b.claim,directory:b.dir,writingPolicy:policy,env:b.env}),/身份不匹配/);
 const c=await fixture(t);const target=join(c.data,'outside.txt');await writeFile(target,'outside private content');const file=join(c.workspace,'.agents/skills/site-writing/SKILL.md');await rm(file);await symlink(target,file);await assert.rejects(centerSkillSnapshot({claim:c.claim,directory:c.dir,writingPolicy:policy,env:c.env}),/路径无效/);
});

test('old in-flight results without snapshots are preserved rather than retroactively relabelled',async t=>{
 const f=await fixture(t);await writeFile(join(f.dir,'zh-CN.result.json'),'{"retained":true}');await assert.rejects(centerSkillSnapshot({claim:f.claim,directory:f.dir,writingPolicy:policy,env:f.env}),/不能补造技能快照/);assert.equal(await readFile(join(f.dir,'zh-CN.result.json'),'utf8'),'{"retained":true}');
});

async function academicFixture(t){
 const data=await mkdtemp(join(tmpdir(),'rssd-academic-refs-'));t.after(()=>rm(data,{recursive:true,force:true}));
 const home=join(data,'center'),dir=join(home,'jobs','one'),workspace=join(data,'workspace');await mkdir(dir,{recursive:true});
 await mkdir(join(workspace,'_ops/inventory'),{recursive:true});await writeFile(join(workspace,'_ops/inventory/article-index.json'),'{}');
 await writeFile(join(data,'editorial-workspace.json'),JSON.stringify({path:workspace}));
 const files={
  'site-writing/SKILL.md':'---\nname: site-writing\n---\nsite rules',
  'scholay-xiwen/SKILL.md':'---\nname: scholay-xiwen\n---\n[资料](../scholay-xiwen/references/source-preprocessing.md) [质量](../scholay-seo-writing/references/column-quality.md) [旧流程](references/legacy-workflow.md)',
  'scholay-seo-writing/SKILL.md':'---\nname: scholay-seo-writing\n---\n[voice](references/voice.md) [quality](references/column-quality.md) [story](references/science-story.md) [product](references/product-capabilities.md)',
  'scholay-xiwen/references/source-preprocessing.md':'Actual conditional source preparation.',
  'scholay-seo-writing/references/voice.md':'Actual voice guidance.',
  'scholay-seo-writing/references/column-quality.md':'Actual column quality and citations.',
  'scholay-seo-writing/references/science-story.md':'Actual science narrative guidance.',
 };
 const base=join(workspace,'.agents/skills');for(const [name,text] of Object.entries(files)){const path=join(base,name);await mkdir((await import('node:path')).dirname(path),{recursive:true});await writeFile(path,text);}
 return {data,dir,base,claim:{id:'academic-one',generation:1,workspaceId:'academic',sectionId:'briefings',title:'Fixture',payload:{policy:{}}},env:{SCHOLAY_GLOBAL_APP_DATA:data}};
}
test('explicit academic references are frozen with their content and never refreshed on resume',async t=>{
 const f=await academicFixture(t),args={claim:f.claim,directory:f.dir,writingPolicy:policy,env:f.env},first=await centerSkillSnapshot(args);
 assert.equal(first.version,2);assert.deepEqual(first.references.map(r=>r.path),['scholay-seo-writing/references/column-quality.md','scholay-seo-writing/references/science-story.md','scholay-seo-writing/references/voice.md','scholay-xiwen/references/source-preprocessing.md']);
 assert.match(first.references[0].content,/column quality/);assert(!first.references.some(r=>/product|legacy/.test(r.path)));
 await writeFile(join(f.base,'scholay-seo-writing/references/column-quality.md'),'new version');assert.deepEqual(await centerSkillSnapshot(args),first);
 const changed=structuredClone(first);changed.references[0].content='tampered';await writeFile(join(f.dir,'writing-skills.json'),JSON.stringify(changed));await assert.rejects(centerSkillSnapshot(args),/参考资料快照损坏/);
 const {references,...legacy}=first;legacy.version=1;delete legacy.snapshotHash;legacy.snapshotHash=protocol.hash(legacy);
 assert.throws(()=>validateCenterSkillSnapshot(legacy,{claim:f.claim,scope:first.scope,writingPolicy:policy}),/旧写作技能快照缺少必需参考资料/);
});
test('missing, redirected and unknown selected references stop rather than reading arbitrary workspace files',async t=>{
 const a=await academicFixture(t),required=join(a.base,'scholay-seo-writing/references/column-quality.md');await rm(required);
 await assert.rejects(centerSkillSnapshot({claim:a.claim,directory:a.dir,writingPolicy:policy,env:a.env}),/缺少必需写作技能参考资料/);
 const b=await academicFixture(t),reference=join(b.base,'scholay-seo-writing/references/column-quality.md'),outside=join(b.data,'private.txt');await rm(reference);await writeFile(outside,'private');await symlink(outside,reference);
 await assert.rejects(centerSkillSnapshot({claim:b.claim,directory:b.dir,writingPolicy:policy,env:b.env}),/参考资料路径无效/);
 const c=await academicFixture(t),skill=join(c.base,'site-writing/SKILL.md');await writeFile(skill,'---\nname: site-writing\n---\n[unknown](references/new-private.md)');
 await assert.rejects(centerSkillSnapshot({claim:c.claim,directory:c.dir,writingPolicy:policy,env:c.env}),/尚未确认的本地参考资料/);
});
