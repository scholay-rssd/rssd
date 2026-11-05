import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publicationQueueConfig,sharedAppDataDirectory,useSharedPublicationQueue} from '../scripts/publication-queue-client.mjs';

const keys=['SCHOLAY_PUBLICATION_QUEUE_CONFIG','SCHOLAY_GLOBAL_APP_DATA','SCHOLAY_SHARED_QUEUE_CONFIG'];
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'shared-queue-')),saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const k of keys)delete process.env[k];
 t.after(async()=>{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}await rm(root,{recursive:true,force:true});});
 const config=async(name,continuationOwner)=>{const file=join(root,name);await writeFile(file,JSON.stringify({version:1,enabled:true,endpoint:'https://queue.example/'+name,continuationOwner}));return file;};
 return {root,config};
}

test('the shared folder is the desktop data folder on every platform',()=>{
 assert.equal(sharedAppDataDirectory({platform:'darwin',home:'/Users/a',env:{}}),'/Users/a/Library/Application Support/com.thomas.papr');
 assert.equal(sharedAppDataDirectory({platform:'linux',home:'/home/a',env:{}}),'/home/a/.local/share/com.thomas.papr');
 assert.equal(sharedAppDataDirectory({platform:'linux',home:'/home/a',env:{XDG_DATA_HOME:'/data'}}),'/data/com.thomas.papr');
 assert.equal(sharedAppDataDirectory({platform:'win32',home:'C:/Users/a',env:{APPDATA:'C:/Roaming'}}),'C:\\Roaming\\com.thomas.papr');
 assert.equal(sharedAppDataDirectory({platform:'win32',home:'C:/Users/a',env:{}}),'C:\\Users\\a\\AppData\\Roaming\\com.thomas.papr');
 assert.equal(sharedAppDataDirectory({platform:'win32',home:'C:/Users/a',env:{APPDATA:'\\\\server\\profiles\\a'}}),'\\\\server\\profiles\\a\\com.thomas.papr');
});

test('command-line pushes read the shared queue config only when nothing closer is configured',async t=>{
 const {root,config}=await fixture(t);
 assert.equal(await publicationQueueConfig(root),null);
 const env={SCHOLAY_SHARED_QUEUE_CONFIG:'/explicit.json'};useSharedPublicationQueue(env);assert.equal(env.SCHOLAY_SHARED_QUEUE_CONFIG,'/explicit.json');
 process.env.SCHOLAY_SHARED_QUEUE_CONFIG=await config('shared.json','cloud');
 assert.deepEqual(await publicationQueueConfig(root),{version:1,enabled:true,endpoint:'https://queue.example/shared.json',continuationOwner:'cloud'});
 await mkdir(join(root,'desktop'));process.env.SCHOLAY_GLOBAL_APP_DATA=join(root,'desktop');await config('desktop/publication-queue.json','local');
 assert.equal((await publicationQueueConfig(root)).endpoint,'https://queue.example/desktop/publication-queue.json');
 await mkdir(join(root,'.local'));await config('.local/publication-queue.json','local');
 assert.equal((await publicationQueueConfig(root)).endpoint,'https://queue.example/.local/publication-queue.json');
});
