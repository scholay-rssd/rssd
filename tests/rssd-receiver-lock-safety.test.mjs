import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir,link,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {withFileLock} from '../scripts/editorial-lock.mjs';
import {withHostBuildSlot,resolveBuildSiteConcurrency} from '../receiver/host-build-slot.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));

function runChild(script,env={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',script],{
      cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']
    });
    let out='',err='';
    child.stdout.on('data',c=>out+=c);
    child.stderr.on('data',c=>c&&(err+=c));
    child.on('error',reject);
    child.on('close',code=>resolve({code,out,err,pid:child.pid}));
  });
}

async function waitFlag(path,timeout=8000){
  const start=Date.now();
  for(;;){
    try{await access(path);return;}catch{}
    if(Date.now()-start>timeout)throw Error('timeout waiting for '+path);
    await new Promise(r=>setTimeout(r,10));
  }
}

/**
 * The rejected hardlink "CAS" reclaim: link aside, re-read nonce, then rm(file).
 * Not atomic — kept only so tests can prove it deletes a live replacement.
 */
async function unsafeHardlinkReclaim(file,owner,{afterVerify}={}){
  const aside=file+'.'+owner.nonce+'.reclaim';
  await link(file,aside);
  const seen=JSON.parse(await readFile(aside,'utf8'));
  assert.equal(seen.nonce,owner.nonce);
  if(afterVerify)await afterVerify();
  const {rm}=await import('node:fs/promises');
  try{await rm(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  await rm(aside,{force:true});
  return true;
}

test('hardlink reclaim deletes a live replacement after B verified the old inode',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-lock-hardlink-race-'));
  const file=join(home,'lock');
  t.after(()=>rm(home,{recursive:true,force:true}));
  const dead={pid:999999999,nonce:'dead-nonce-1',at:Date.now(),identity:'dead'};
  await writeFile(file,JSON.stringify(dead),{mode:0o600});

  let releaseB;
  const bPaused=new Promise(resolve=>{releaseB=resolve;});
  let bReachedVerify=false;
  const b=unsafeHardlinkReclaim(file,dead,{afterVerify:async()=>{
    bReachedVerify=true;
    // Signal A: B has verified the dead inode and is paused before unlink.
    await writeFile(join(home,'b-verified'),'1');
    await bPaused;
  }});

  await waitFlag(join(home,'b-verified'));
  // A: remove dead path and install a live holder at the same path.
  const {rm}=await import('node:fs/promises');
  await rm(file,{force:true});
  const liveNonce=randomUUID();
  await writeFile(file,JSON.stringify({pid:process.pid,nonce:liveNonce,at:Date.now(),role:'live-holder'}),{mode:0o600});
  await writeFile(join(home,'live-installed'),'1');
  releaseB();
  await b;

  // If reclaim were safe, the live lock would still be present with liveNonce.
  let remaining=null;
  try{remaining=JSON.parse(await readFile(file,'utf8'));}catch{remaining=null;}
  assert.equal(bReachedVerify,true);
  assert.equal(remaining,null,'unsafe hardlink reclaim unlinked the new holder\'s lock');
});

test('fence reclaim race: empty-slot check, new slotted holder, fence deleted, exclusive overlaps',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-lock-fence-race-'));
  const log=join(home,'events.ndjson');
  t.after(()=>rm(home,{recursive:true,force:true}));
  await mkdir(join(home,'build.slots'),{recursive:true});
  await writeFile(log,'');
  // Plant an orphan fence as after a previous slotted build drained.
  const fenceNonce=randomUUID();
  await writeFile(join(home,'build.lock'),JSON.stringify({role:'host-build-fence',concurrency:2,nonce:fenceNonce,at:Date.now()}),{mode:0o600});

  // Checker: see no live slots, pause, then delete fence (the rejected reclaimOrphanHostFence shape).
  const checker=`
    import {appendFileSync} from 'node:fs';
    import {readFile,rm,readdir,access,writeFile} from 'node:fs/promises';
    import {join} from 'node:path';
    const home=process.env.H,log=process.env.L;
    const w=e=>appendFileSync(log,JSON.stringify({who:'checker',...e,at:Date.now()})+'\\n');
    const fence=join(home,'build.lock'),slots=join(home,'build.slots');
    const names=await readdir(slots);
    const live=names.filter(n=>/^\\d+\\.lock$/.test(n));
    w({phase:'checked-empty',live:live.length});
    assertEmpty(live.length===0);
    await writeFile(join(home,'checked-empty'),'1');
    while(true){try{await access(join(home,'slotted-holding'));break;}catch{await new Promise(r=>setTimeout(r,10));}}
    const owner=JSON.parse(await readFile(fence,'utf8'));
    w({phase:'about-to-rm-fence',role:owner.role});
    await rm(fence,{force:true});
    w({phase:'fence-removed'});
    await writeFile(join(home,'fence-removed'),'1');
    function assertEmpty(ok){if(!ok)throw Error('expected empty');}
  `;

  // Slotted holder: after checker saw empty, take a slot and rely on existing fence.
  const slotted=`
    import {appendFileSync,writeFileSync} from 'node:fs';
    import {access,readFile} from 'node:fs/promises';
    import {join} from 'node:path';
    import {withFileLock} from './scripts/editorial-lock.mjs';
    const home=process.env.H,log=process.env.L;
    const w=e=>appendFileSync(log,JSON.stringify({who:'slotted',...e,at:Date.now()})+'\\n');
    while(true){try{await access(join(home,'checked-empty'));break;}catch{await new Promise(r=>setTimeout(r,10));}}
    await withFileLock(join(home,'build.slots','0.lock'),async()=>{
      const fence=JSON.parse(await readFile(join(home,'build.lock'),'utf8'));
      if(fence.role!=='host-build-fence')throw Error('expected fence');
      w({phase:'holding-with-fence'});
      writeFileSync(join(home,'slotted-holding'),'1');
      while(true){try{await access(join(home,'exclusive-entered'));break;}catch{await new Promise(r=>setTimeout(r,10));}}
      w({phase:'still-holding'});
    },{timeout:10000});
  `;

  // Legacy exclusive: after fence removed, acquire build.lock while slotted still holds a slot.
  const exclusive=`
    import {appendFileSync,writeFileSync} from 'node:fs';
    import {access} from 'node:fs/promises';
    import {join} from 'node:path';
    import {withFileLock} from './scripts/editorial-lock.mjs';
    const home=process.env.H,log=process.env.L;
    const w=e=>appendFileSync(log,JSON.stringify({who:'exclusive',...e,at:Date.now()})+'\\n');
    while(true){try{await access(join(home,'fence-removed'));break;}catch{await new Promise(r=>setTimeout(r,10));}}
    await withFileLock(join(home,'build.lock'),async()=>{
      w({phase:'holding-exclusive'});
      writeFileSync(join(home,'exclusive-entered'),'1');
      await new Promise(r=>setTimeout(r,200));
      w({phase:'exclusive-done'});
    },{timeout:5000});
  `;

  const c=runChild(checker,{H:home,L:log});
  await waitFlag(join(home,'checked-empty'));
  const s=runChild(slotted,{H:home,L:log});
  await waitFlag(join(home,'slotted-holding'));
  const e=runChild(exclusive,{H:home,L:log});
  const [cr,sr,er]=await Promise.all([c,s,e]);
  assert.equal(cr.code,0,cr.err);assert.equal(sr.code,0,sr.err);assert.equal(er.code,0,er.err);

  const events=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(events.some(x=>x.who==='checker'&&x.phase==='fence-removed'));
  assert.ok(events.some(x=>x.who==='slotted'&&x.phase==='holding-with-fence'));
  assert.ok(events.some(x=>x.who==='exclusive'&&x.phase==='holding-exclusive'));
  const slottedHold=events.find(x=>x.who==='slotted'&&x.phase==='holding-with-fence').at;
  const exclusiveHold=events.find(x=>x.who==='exclusive'&&x.phase==='holding-exclusive').at;
  const slottedStill=events.find(x=>x.who==='slotted'&&x.phase==='still-holding').at;
  assert.ok(exclusiveHold>slottedHold);
  assert.ok(slottedStill>exclusiveHold,'exclusive build.lock overlapped an in-flight slotted holder after fence reclaim');
});

test('host build concurrency >1 is refused; n=1 keeps exclusive build.lock',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-lock-n1-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  assert.equal(resolveBuildSiteConcurrency(undefined),1);
  await assert.rejects(withHostBuildSlot(home,2,async()=>{},{timeout:50}),/not deployed/);
  let ran=false;
  await withHostBuildSlot(home,1,async()=>{
    ran=true;
    await assert.rejects(withHostBuildSlot(home,1,async()=>{},{timeout:50}),/文件正在保存/);
  },{timeout:1000});
  assert.equal(ran,true);
});

test('protocol file alone does not stop a legacy exclusive builder',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-lock-protocol-weak-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(join(home,'build.protocol'),JSON.stringify({version:1,concurrency:2}),{mode:0o600});
  // Old binary only calls withFileLock(home/build.lock) and never reads build.protocol.
  let legacyEntered=false;
  await withFileLock(join(home,'build.lock'),async()=>{legacyEntered=true;},{timeout:500});
  assert.equal(legacyEntered,true,'legacy exclusive ignores build.protocol');
});
