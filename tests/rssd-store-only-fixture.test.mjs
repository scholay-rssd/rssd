import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {requireNode24,requireStoreOnlyFixtureTree,readStoreOnlyProfiles,sitesGitlinkSha,STORE_ONLY_PROFILES} from '../scripts/rssd-store-only-fixture.mjs';
import {archiveStoreOnlyFixture} from '../scripts/archive-store-only-fixture.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));

test('headless packaging copies the real sites/profiles.json; it is not a generator',async()=>{
  const source=await readFile(join(root,'desktop/scripts/prepare-workbench.mjs'),'utf8');
  assert.match(source,/cp\(join\(root,'sites\/profiles\.json'\),join\(out,'sites\/profiles\.json'\)\)/);
  assert.equal(source.includes("writeFile(join(out,'sites/profiles.json'),'[]'"),false);
});

test('store-only fixture requires Node 24+ and the real sites submodule catalog',()=>{
  assert.equal(requireNode24(),Number(process.versions.node.split('.')[0]));
  assert.throws(()=>requireNode24('22.23.4'),{code:'node_version'});
  const tree=requireStoreOnlyFixtureTree();
  assert.match(tree.sitesGitlink,/^[a-f0-9]{40}$/);
  assert.equal(tree.sitesGitlink,sitesGitlinkSha());
  const enter=tree.profiles.find(site=>site.id==='enter');
  assert.equal(enter.spaceId,'enter');
  assert.match(enter.origin,/^https:\/\//);
});

test('parent git archive omits sites/profiles.json; the submodule archive contains the real catalog',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'rssd-archive-omit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const appTar=join(dir,'app.tar.gz');
  const app=spawnSync('git',['archive','--format=tar.gz','-o',appTar,'HEAD'],{cwd:root});
  assert.equal(app.status,0);
  const listed=spawnSync('tar',['-tzf',appTar],{encoding:'utf8'});
  assert.equal(listed.status,0);
  assert.equal(listed.stdout.split('\n').includes(STORE_ONLY_PROFILES),false);
  const sitesTar=join(dir,'sites.tar.gz');
  const sites=spawnSync('git',['-C','sites','archive','--format=tar.gz','-o',sitesTar,'HEAD'],{cwd:root});
  assert.equal(sites.status,0);
  const sitesList=spawnSync('tar',['-tzf',sitesTar],{encoding:'utf8'});
  assert.ok(sitesList.stdout.split('\n').includes('profiles.json'));
});

test('an empty stub is not accepted as profiles.json',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'rssd-stub-profiles-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'sites'),{recursive:true});
  await writeFile(join(dir,'sites/profiles.json'),'[]\n');
  assert.throws(()=>readStoreOnlyProfiles(dir),{code:'sites_submodule'});
  await writeFile(join(dir,'sites/profiles.json'),JSON.stringify([{id:'enter'}])+'\n');
  assert.throws(()=>readStoreOnlyProfiles(dir),{code:'sites_submodule'});
});

test('official pack extracts a tree that can import site-config without a stub',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'rssd-store-pack-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const packed=await archiveStoreOnlyFixture(dir,root,{extractTree:true});
  assert.equal(packed.sitesSha,sitesGitlinkSha());
  const extracted=JSON.parse(await readFile(join(packed.combined,STORE_ONLY_PROFILES),'utf8'));
  assert.deepEqual(extracted,readStoreOnlyProfiles());
  const loaded=await import(pathToFileURL(join(packed.combined,'scripts/site-config.mjs')).href);
  assert.equal(loaded.profiles.find(site=>site.id==='enter').origin,'https://enter.scholay.com');
  const require=createRequire(import.meta.url);
  assert.equal(typeof require('markdown-it'),'function');
});
