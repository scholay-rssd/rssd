import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {freezeImagePolicy,validateImagePolicySnapshot} from '../scripts/rssd-image-policy.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');

test('new site image tasks freeze actual skill, linked references and pinned brand; old snapshot is immutable',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'rssd-image-policy-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const skill=join(root,'SKILL.md'),refs=join(root,'references'),style=join(refs,'style.md'),directory=join(root,'job');await mkdir(refs);
 const content='# Site image skill\nSee [style](references/style.md).',styleText='Use a hand-drawn style.';await writeFile(skill,content);await writeFile(style,styleText);
 const args={directory,siteId:'metho',workspaceId:'metho',referenceSha256:'a'.repeat(64),configuration:{skills:[{path:skill,sha256:hash(content)}],references:[{path:style,sha256:hash(styleText)}],disclosures:{'zh-CN':'Scholay 原创手绘示意（AI 辅助生成）',en:'Scholay original illustration (AI-generated)'}}};
 await assert.rejects(freezeImagePolicy({...args,directory:join(root,'missing-disclosure'),configuration:{...args.configuration,disclosures:undefined}}),{code:'image_pending'});
 const snap=await freezeImagePolicy(args);assert.equal(snap.skills[0].content,content);assert.equal(snap.references[0].content,styleText);assert.equal(snap.referenceSha256,args.referenceSha256);assert.equal(snap.disclosures['zh-CN'],'Scholay 原创手绘示意（AI 辅助生成）');
 await writeFile(skill,'later change');assert.deepEqual(await freezeImagePolicy({...args,configuration:undefined}),snap);
 assert.throws(()=>validateImagePolicySnapshot({...snap,skills:[{...snap.skills[0],content:'changed'}]},args),{code:'image_pending'});
 assert.throws(()=>validateImagePolicySnapshot(snap,{...args,siteId:'pets'}),{code:'image_pending'});
 const stored=JSON.parse(await readFile(join(directory,'image-policy.json'),'utf8'));assert.deepEqual(stored,snap);
});

test('unconfigured, incomplete or changed site image policy never starts a new snapshot',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'rssd-image-policy-invalid-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const skill=join(root,'SKILL.md'),content='[style](references/style.md)';await writeFile(skill,content);
 const args={directory:join(root,'job'),siteId:'pets',workspaceId:'pets',referenceSha256:'b'.repeat(64)};
 await assert.rejects(freezeImagePolicy(args),{code:'image_pending'});
 await assert.rejects(freezeImagePolicy({...args,configuration:{skills:[{path:skill,sha256:hash(content)}],references:[],disclosures:{'zh-CN':'AI 生成示意图',en:'AI-generated illustration'}}}),{code:'image_pending'});
 await assert.rejects(freezeImagePolicy({...args,configuration:{skills:[{path:skill,sha256:'0'.repeat(64)}],references:[],disclosures:{'zh-CN':'AI 生成示意图',en:'AI-generated illustration'}}}),{code:'image_pending'});
});
