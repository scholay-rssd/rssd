import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_SITE} from '../scripts/site-config.mjs';

const worker=fileURLToPath(new URL('../scripts/publication-queue-worker.mjs',import.meta.url));

// website-publication.mjs imports the worker module, so a worker started as its
// own entry must settle that cycle instead of stalling every queued push.
test('a spawned publication queue worker loads the publisher it imports back',async t=>{
  const root=await mkdtemp(join(tmpdir(),'scholay-queue-worker-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'articles'));await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:[],articles:{}}));
  const env={...process.env,SCHOLAY_EDITORIAL_ROOT:root,SCHOLAY_SITE_JSON:JSON.stringify(DEFAULT_SITE),SCHOLAY_TODAY_TOKEN_FILE:join(root,'missing-token')};
  delete env.SCHOLAY_SITE_CONFIG;
  const run=spawnSync(process.execPath,[worker,root,'missing-queued-article'],{env,encoding:'utf8',timeout:30000});
  assert.doesNotMatch(run.stderr,/unsettled top-level await/);
  assert.notEqual(run.status,13);
  assert.equal(run.signal,null);
});
