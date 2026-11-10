import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {profiles} from '../scripts/site-config.mjs';
import {main,loadCloudQueueConfig} from '../scripts/cloud-queue-cli.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {makePublic} from './fixtures/private-file.mjs';
const run=promisify(execFile);
test('cloud CLI validates private config and token permissions on the host platform',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-cloud-cli-permissions-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const siteFile=join(root,'site.json'),tokenFile=join(root,'token'),configFile=join(root,'config.json');
 await writeFile(siteFile,JSON.stringify(profiles.find(site=>site.id==='metho')));
 await writeFile(tokenFile,'PRIVATE_TEST_TOKEN',{mode:0o600});await protectPrivateFile(tokenFile);
 await writeFile(configFile,JSON.stringify({version:1,directory:join(root,'state'),sites:[{siteFile,tokenFile}]}),{mode:0o600});await protectPrivateFile(configFile);
 assert.equal((await main(['check','--config',configFile])).status,'configured');
 await makePublic(tokenFile);await assert.rejects(main(['check','--config',configFile]),/private token file/);
 await makePublic(configFile);await assert.rejects(loadCloudQueueConfig(configFile),/config must be private/);
});
test('cloud CLI actually runs through the current-release symlink, with or without Node preserve-symlinks-main', {skip:process.platform==='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-cloud-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));const siteFile=join(root,'site.json'),tokenFile=join(root,'token'),configFile=join(root,'config.json'),entry=join(root,'entry.mjs');
 await writeFile(siteFile,JSON.stringify(profiles.find(site=>site.id==='metho')),{mode:0o600});await writeFile(tokenFile,'PRIVATE_TEST_TOKEN',{mode:0o600});await writeFile(configFile,JSON.stringify({version:1,directory:join(root,'state'),sites:[{siteFile,tokenFile}]}),{mode:0o600});await symlink(resolve('scripts/cloud-queue-cli.mjs'),entry);
 const normal=await run(process.execPath,[entry,'check','--config',configFile]);assert.equal(JSON.parse(normal.stdout).status,'configured');
 // A directory release symlink preserves the CLI's relative import tree.
 const release=join(root,'current');await symlink(resolve('.'),release,'dir');const preserved=await run(process.execPath,['--preserve-symlinks-main',join(release,'scripts/cloud-queue-cli.mjs'),'check','--config',configFile]);assert.equal(JSON.parse(preserved.stdout).status,'configured');
});
