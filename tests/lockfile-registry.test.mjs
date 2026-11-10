import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// CI runners must fetch from the public registry: a regional mirror in a
// lockfile's resolved URLs times out from GitHub Actions (E504 on Windows).
// Developers can still use a mirror locally with `--replace-registry-host=always`.
for(const lock of ['package-lock.json','desktop/runtime/package-lock.json']){
  test(`${lock} resolves packages only from registry.npmjs.org`,async()=>{
    const {packages}=JSON.parse(await readFile(new URL('../'+lock,import.meta.url),'utf8'));
    const foreign=Object.entries(packages).filter(([,p])=>p.resolved?.startsWith('http')&&!p.resolved.startsWith('https://registry.npmjs.org/')).map(([name,p])=>`${name} ${p.resolved}`);
    assert.deepEqual(foreign,[]);
  });
}
