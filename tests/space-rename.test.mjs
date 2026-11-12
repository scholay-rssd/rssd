import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {profiles} from '../scripts/site-config.mjs';
import {migrateRenamedSpaces,migrateCenterCache} from '../scripts/space-rename.mjs';
import {canonicalSiteId} from '../desktop/scripts/agent/headless/env.mjs';
import {spaceContext} from '../scripts/space-registry.mjs';

const json=file=>JSON.parse(readFileSync(file,'utf8'));
const save=(file,value)=>{mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,JSON.stringify(value,null,2)+'\n');};

test('a retired space ID moves to its new name once, with a backup, keeping free text',t=>{
  const data=mkdtempSync(join(tmpdir(),'space-rename-'));t.after(()=>rmSync(data,{recursive:true,force:true}));
  const current=profiles.find(s=>s.id==='xsime'),old={...current,id:'lingxi',spaceId:'lingxi',description:'记录灵犀输入法的构建。'};
  const pets=profiles.find(s=>s.id==='pets');
  save(join(data,'spaces.json'),{version:1,activeSpaceId:'lingxi',sites:[profiles.find(s=>s.legacy),old,pets]});
  const space=join(data,'spaces','lingxi'),workspace=join(space,'workspace');
  save(join(space,'editorial-workspace.json'),{path:workspace});
  save(join(workspace,'.site.json'),old);
  save(join(workspace,'_ops/inventory/article-index.json'),{version:1,spaceId:'lingxi',siteId:'lingxi',articles:{}});
  save(join(workspace,'.local/sites/lingxi/draft/prepared.json'),{workspaceId:'lingxi',title:'lingxi 草稿',path:join(workspace,'.local/sites/lingxi/draft/a.md')});
  save(join(data,'writing-brands.json'),{version:1,brands:[{id:'site:lingxi',name:'犀术 IME',description:'记录灵犀输入法的构建。'},{id:'site:xsiching',name:'犀术国学',description:'心有灵犀，只言见术'}]});

  const [report]=migrateRenamedSpaces(data);
  assert.deepEqual([report.from,report.to],['lingxi','xsime']);
  assert.ok(existsSync(report.backup)&&existsSync(join(report.backup,'workspace/.site.json')),'old folder kept as a backup');
  const registry=json(join(data,'spaces.json'));
  assert.equal(registry.activeSpaceId,'xsime');
  assert.deepEqual(registry.sites.map(s=>s.spaceId),['academic','xsime','pets']);
  assert.equal(registry.sites[1].description,current.description,'brand text comes from the current profile');
  const moved=join(data,'spaces','xsime','workspace');
  assert.equal(json(join(data,'spaces','xsime','editorial-workspace.json')).path,moved);
  assert.equal(json(join(moved,'.site.json')).id,'xsime');
  assert.deepEqual(json(join(moved,'_ops/inventory/article-index.json')),{version:1,spaceId:'xsime',siteId:'xsime',articles:{}});
  const draft=json(join(moved,'.local/sites/xsime/draft/prepared.json'));
  assert.equal(draft.workspaceId,'xsime');assert.equal(draft.title,'lingxi 草稿','free text is not rewritten');
  assert.equal(draft.path,join(moved,'.local/sites/xsime/draft/a.md'));
  const brands=json(join(data,'writing-brands.json')).brands;
  assert.deepEqual(brands.map(b=>b.id),['site:xsime','site:xsiching']);
  assert.equal(brands[0].description,'记录犀术输入法的构建。');assert.equal(brands[1].description,'心有灵犀，只言见术');
  assert.ok(!readdirSync(join(data,'spaces')).includes('lingxi'));

  assert.deepEqual(migrateRenamedSpaces(data),[],'a second run changes nothing');
  assert.equal(spaceContext(data,'xsime').siteId,'xsime');
});

test('a rename never overwrites an existing space with the new ID',t=>{
  const data=mkdtempSync(join(tmpdir(),'space-rename-'));t.after(()=>rmSync(data,{recursive:true,force:true}));
  const current=profiles.find(s=>s.id==='xsime');
  save(join(data,'spaces.json'),{version:1,activeSpaceId:'academic',sites:[profiles.find(s=>s.legacy),{...current,id:'lingxi',spaceId:'lingxi'},{...current}]});
  assert.throws(()=>migrateRenamedSpaces(data),/已存在/);
  assert.equal(json(join(data,'spaces.json')).sites[1].id,'lingxi');
});

test('the Center connection cache follows a rename even after the space already moved',t=>{
  const data=mkdtempSync(join(tmpdir(),'space-rename-'));t.after(()=>rmSync(data,{recursive:true,force:true}));
  const current=profiles.find(s=>s.id==='xsime');
  save(join(data,'spaces.json'),{version:1,activeSpaceId:'xsime',sites:[profiles.find(s=>s.legacy),current]});
  const center=join(data,'center');
  save(join(center,'connection.json'),{version:1,origin:'https://center.example',token:'secret-token',identity:{workerId:'w1',orgId:'o1',workspaceIds:['academic','lingxi','metho']}});
  save(join(center,'registry.json'),{origin:'https://center.example',value:{workspaces:[{id:'lingxi',siteId:'lingxi',name:'lingxi 记录',sections:[{policy:{targets:[{locale:'zh-CN',destinationId:'site-lingxi'}]}}]}],destinations:[{id:'site-lingxi',workspaceIds:['lingxi']}]}});
  save(join(center,'outbox/pending.json'),{workspaceId:'lingxi',requestId:'r1'});

  const [moved]=migrateRenamedSpaces(data);
  assert.deepEqual([moved.from,moved.to,moved.files],['lingxi','xsime',2]);
  assert.deepEqual(moved.stale,['outbox/pending.json'],'queued work is reported, not rewritten');
  const connection=json(join(center,'connection.json'));
  assert.deepEqual(connection.identity.workspaceIds,['academic','xsime','metho']);
  assert.equal(connection.token,'secret-token','credentials are kept');
  const registry=json(join(center,'registry.json')).value;
  assert.deepEqual([registry.workspaces[0].id,registry.workspaces[0].siteId,registry.workspaces[0].name],['xsime','xsime','lingxi 记录']);
  assert.equal(registry.workspaces[0].sections[0].policy.targets[0].destinationId,'site-xsime');
  assert.deepEqual([registry.destinations[0].id,registry.destinations[0].workspaceIds],['site-xsime',['xsime']]);
  assert.equal(json(join(center,'outbox/pending.json')).workspaceId,'lingxi');

  const again=migrateCenterCache(center);
  assert.deepEqual(again.map(r=>[r.files,r.stale]),[[0,['outbox/pending.json']]],'a second run changes nothing');
});

test('headless commands accept the retired site ID',()=>{
  assert.equal(canonicalSiteId('lingxi'),'xsime');
  assert.equal(canonicalSiteId('xsime'),'xsime');
  assert.equal(canonicalSiteId('today'),'scholay-today');
});
