import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {spaceContext,selectSpace,importSite} from '../scripts/space-registry.mjs';

test('context reads and repeated switches preserve unchanged site files',async t=>{
  const data=await mkdtemp(join(tmpdir(),'space-read-'));
  t.after(()=>rm(data,{recursive:true,force:true}));
  const academic=spaceContext(data);
  const pets=importSite(data,profiles.find(site=>site.spaceId==='pets'));
  for(const context of [academic,pets]){
    const time=new Date('2000-01-01T00:00:00Z');
    await utimes(context.configFile,time,time);
    const before=await stat(context.configFile);
    for(let i=0;i<3;i++){
      assert.equal(spaceContext(data,context.spaceId).spaceId,context.spaceId);
      selectSpace(data,context.spaceId);
    }
    assert.equal((await stat(context.configFile)).mtimeMs,before.mtimeMs);
    assert.equal(JSON.parse(await readFile(join(data,'spaces.json'),'utf8')).activeSpaceId,context.spaceId);
  }
});

test('context reads still repair outdated local metadata from the registry',async t=>{
  const data=await mkdtemp(join(tmpdir(),'space-repair-'));
  t.after(()=>rm(data,{recursive:true,force:true}));
  const context=spaceContext(data);
  await writeFile(context.configFile,'{}');
  spaceContext(data,context.spaceId);
  const {sectionCatalog,...identity}=context.site;
  assert.equal(sectionCatalog.status,'unavailable');
  assert.deepEqual(JSON.parse(await readFile(context.configFile,'utf8')),identity);
});
