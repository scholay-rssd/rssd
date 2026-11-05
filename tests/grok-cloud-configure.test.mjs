import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profiles} from '../scripts/site-config.mjs';
import {atomic,optional} from '../scripts/publishing-flow.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {configureGrokCloud} from '../scripts/grok-cloud-configure.mjs';
const ids=['scholay-today','metho','enter','study','xsiching'];
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'grok-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config={version:1,workspaces:[]};
 for(const id of ids){const root=join(dir,id),site=profiles.find(row=>row.id===id),tokenFile=join(root,'token');await atomic(join(root,'.site.json'),site);await writeFile(tokenFile,'',{mode:0o600});await protectPrivateFile(tokenFile);await writeFile(tokenFile,'fixture-token');config.workspaces.push({root,site,tokenFile});}
 const file=join(dir,'config.json');await atomic(file,config);return {file,config};
}
test('configure validates all sites before writes and preserves old config on reapply',async t=>{
 const {file,config}=await fixture(t);let calls=0;
 const fetcher=async()=>{calls++;return new Response('{"jobs":[]}',{status:200});};
 const target=join(config.workspaces[0].root,'.local/publication-queue.json'),prior={version:1,enabled:false};await atomic(target,prior);
 assert.equal((await configureGrokCloud(file,{fetcher})).status,'validated');assert.equal(calls,5);assert.deepEqual(await optional(target),prior);
 await configureGrokCloud(file,{fetcher,apply:true});await configureGrokCloud(file,{fetcher,apply:true});
 assert.equal((await optional(target)).continuationOwner,'cloud');assert.deepEqual((await optional(target+'.before-cloud.json')).config,prior);
});
test('excluded site or failed authorization does not partially configure earlier sites',async t=>{
 const {file,config}=await fixture(t);const target=join(config.workspaces[0].root,'.local/publication-queue.json');let calls=0;
 await assert.rejects(configureGrokCloud(file,{apply:true,fetcher:async()=>new Response('{"jobs":[]}',{status:++calls===5?403:200})}),/authorization check failed/);assert.equal(await optional(target),null);
 config.workspaces[4].site=profiles.find(row=>row.id==='legis');await atomic(file,config);
 await assert.rejects(configureGrokCloud(file,{apply:true,fetcher:()=>{throw Error('must not call');}}),/Unexpected cloud workspace/);assert.equal(await optional(target),null);
});
test('HTTP 200 login pages and unrelated JSON cannot enable cloud ownership',async t=>{
 const {file,config}=await fixture(t);const target=join(config.workspaces[0].root,'.local/publication-queue.json');
 for(const body of ['<html>Login</html>','{"status":"ok"}','{"jobs":[{"siteId":"legis","jobId":"'+ 'a'.repeat(64)+'"}]}']){
  await assert.rejects(configureGrokCloud(file,{apply:true,fetcher:async()=>new Response(body)}),/non-JSON|identity is invalid/);assert.equal(await optional(target),null);
 }
});
