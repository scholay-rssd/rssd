import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {switchConnectionContext,recoverConnectionSwitch} from '../scripts/rssd-connection-context.mjs';
import {writeCenterJson,loadCenterConnection} from '../scripts/rssd-center-client.mjs';
const a={origin:'https://a.example',identity:{orgId:'a',workerId:'one'}},b={origin:'https://b.example',identity:{orgId:'b',workerId:'two'}};
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'rssd-context-test-'));t.after(()=>rm(home,{recursive:true,force:true}));await writeCenterJson(join(home,'connection.json'),a);await writeCenterJson(join(home,'drafts','original.json'),{body:'original manuscript'});await writeCenterJson(join(home,'outbox','original.json'),{requestId:'original-request',state:'pending'});return home;}
const read=async path=>JSON.parse(await readFile(path,'utf8'));
test('switching organizations archives pending receipts and restores their exact originals',async t=>{
 const home=await fixture(t);await switchConnectionContext(home,a,b,writeCenterJson);
 await assert.rejects(read(join(home,'outbox','original.json')),{code:'ENOENT'});
 await writeCenterJson(join(home,'drafts','second.json'),{body:'other organization'});
 await switchConnectionContext(home,b,a,writeCenterJson);
 assert.deepEqual(await read(join(home,'drafts','original.json')),{body:'original manuscript'});assert.equal((await read(join(home,'outbox','original.json'))).requestId,'original-request');
 await assert.rejects(read(join(home,'drafts','second.json')),{code:'ENOENT'});
});
test('a failed switch restores the connection and every pending packet',async t=>{
 const home=await fixture(t);let fail=true;
 const write=async(path,value)=>{if(path===join(home,'connection.json')&&value.origin===b.origin&&fail){fail=false;throw Error('Disk interrupted');}await writeCenterJson(path,value);};
 await assert.rejects(switchConnectionContext(home,a,b,write),/Disk interrupted/);assert.deepEqual(await read(join(home,'connection.json')),a);assert.equal((await read(join(home,'outbox','original.json'))).state,'pending');
});
test('an interrupted switch journal recovers before loading credentials',async t=>{
 const home=await fixture(t);await switchConnectionContext(home,a,b,writeCenterJson);
 const index=await read(join(home,'contexts','index.json')),snapshot=Object.values(index)[0];
 await writeCenterJson(join(home,'connection.json'),a);await writeCenterJson(join(home,'connection-switch.json'),{previous:a,next:'uncommitted',snapshot});
 await recoverConnectionSwitch(home,writeCenterJson);assert.equal((await read(join(home,'outbox','original.json'))).requestId,'original-request');assert(!(await readdir(home)).includes('connection-switch.json'));
 await writeCenterJson(join(home,'connection.json'),{...a,disconnected:true});await assert.rejects(loadCenterConnection(home),{code:'disconnected'});
});
test('an unresolved claim cannot be archived under another organization',async t=>{
 const home=await fixture(t);await writeCenterJson(join(home,'active-claim.json'),{claim:{id:'unresolved'}});
 await assert.rejects(switchConnectionContext(home,a,b,writeCenterJson),/认领/);assert.deepEqual(await read(join(home,'connection.json')),a);
});
