import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ARTICLE_WRITING_POLICY,ARTICLE_WRITING_INSTRUCTIONS} from '../contracts/article-writing-policy.mjs';

test('external agents can read the current writing policy without initializing a workspace or runtime',async t=>{
 const root=await mkdtemp(join(tmpdir(),'writing-policy-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const cli=fileURLToPath(new URL('../desktop/scripts/agent/headless/cli.mjs',import.meta.url));
 const env={...process.env,SCHOLAY_HEADLESS_HOME:join(root,'runtime'),SCHOLAY_AUTH_DIR:join(root,'auth'),SCHOLAY_SPACES_ROOT:join(root,'spaces')};
 const result=spawnSync(process.execPath,[cli,'writing-policy'],{cwd:root,env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);
 const policy=JSON.parse(result.stdout);
 assert.equal(policy.version,ARTICLE_WRITING_POLICY);
 assert.equal(policy.instructions,ARTICLE_WRITING_INSTRUCTIONS);
 assert.equal(policy.sha256,createHash('sha256').update(policy.instructions).digest('hex'));
 assert.equal(policy.source,'contracts/article-writing-policy.mjs');
 assert.deepEqual(await readdir(root),[]);
 const invalid=spawnSync(process.execPath,[cli,'writing-policy','--apply'],{cwd:root,env,encoding:'utf8',timeout:10000});
 assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);
 assert.deepEqual(await readdir(root),[]);
});
