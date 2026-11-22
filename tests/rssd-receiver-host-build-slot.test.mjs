import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withHostBuildSlot,hostBuildBusy,resolveBuildSiteConcurrency} from '../receiver/host-build-slot.mjs';

const here=fileURLToPath(new URL('.',import.meta.url));

function runChild(script,env={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',script],{
      cwd:join(here,'..'),env:{...process.env,...env},stdio:['ignore','pipe','pipe']
    });
    let out='',err='';
    child.stdout.on('data',chunk=>out+=chunk);
    child.stderr.on('data',chunk=>err+=chunk);
    child.on('error',reject);
    child.on('close',code=>resolve({code,out,err,pid:child.pid}));
  });
}

test('concurrency 1 uses home/build.lock like the deployed exclusive host lock',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-host-slot-1-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  let inside=false;
  await withHostBuildSlot(home,1,async()=>{
    inside=true;
    assert.equal(await hostBuildBusy(home),true);
    await assert.rejects(withHostBuildSlot(home,1,async()=>{},{timeout:50}),/文件正在保存/);
  },{timeout:1000});
  assert.equal(inside,true);
  assert.equal(await hostBuildBusy(home),false);
  assert.equal(resolveBuildSiteConcurrency(undefined),1);
  await assert.rejects(withHostBuildSlot(home,2,async()=>{},{timeout:50}),/not deployed/);
});

test('a crashed process releases the exclusive host lock for a later process',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-host-slot-crash-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const holder=`
    import {withHostBuildSlot} from './receiver/host-build-slot.mjs';
    await withHostBuildSlot(process.env.RSSD_TEST_HOME,1,async()=>{
      process.stdout.write('held\\n');
      await new Promise(()=>{});
    },{timeout:1000});
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',holder],{
    cwd:join(here,'..'),env:{...process.env,RSSD_TEST_HOME:home},stdio:['ignore','pipe','pipe']
  });
  await new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>{if(String(chunk).includes('held'))resolve();});
    child.on('error',reject);
    setTimeout(()=>reject(Error('holder did not acquire lock')),5000);
  });
  child.kill('SIGKILL');
  await new Promise(r=>child.on('close',r));
  let recovered=false;
  await withHostBuildSlot(home,1,async()=>{recovered=true;},{timeout:2000});
  assert.equal(recovered,true);
});

test('Promise-pool style per-site locks alone do not enforce a host-wide cap across processes',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-host-slot-false-'));
  const log=join(home,'events.ndjson');
  t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(log,'');
  const script=`
    import {appendFileSync} from 'node:fs';
    import {join} from 'node:path';
    import {withFileLock} from './scripts/editorial-lock.mjs';
    const home=process.env.RSSD_TEST_HOME,log=process.env.RSSD_TEST_LOG,site=process.env.RSSD_TEST_SITE;
    const write=event=>appendFileSync(log,JSON.stringify({site,pid:process.pid,...event,at:Date.now()})+'\\n');
    await withFileLock(join(home,site,'build.lock'),async()=>{
      write({phase:'start'});
      await new Promise(r=>setTimeout(r,200));
      write({phase:'end'});
    },{timeout:1000});
  `;
  const kids=await Promise.all(['metho','pets','enter'].map(site=>runChild(script,{RSSD_TEST_HOME:home,RSSD_TEST_LOG:log,RSSD_TEST_SITE:site})));
  assert.ok(kids.every(k=>k.code===0),kids.map(k=>k.err||k.out).join('\n'));
  const events=(await import('node:fs')).readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const spans=events.filter(e=>e.phase==='start').map(start=>{
    const end=events.find(e=>e.phase==='end'&&e.site===start.site);
    return {start:start.at,end:end.at};
  });
  let peak=0;
  for(const at of [...new Set(spans.flatMap(s=>[s.start,s.end]))].sort((a,b)=>a-b)){
    peak=Math.max(peak,spans.filter(s=>s.start<=at&&at<s.end).length);
  }
  assert.ok(peak>=3,'control case: per-site locks alone allow all processes to build at once, peak='+peak);
});
