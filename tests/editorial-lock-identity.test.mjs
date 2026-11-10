import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {lockOwnerAlive,withFileLock} from '../scripts/editorial-lock.mjs';

test('a live PID with a different recorded process identity is not its old lock owner',async()=>{
 if(!['darwin','linux'].includes(process.platform))return;
 const dir=await mkdtemp(join(tmpdir(),'rssd-lock-identity-')),file=join(dir,'lock');
 try{
  await withFileLock(file,async()=>{
   const owner=JSON.parse(await readFile(file,'utf8'));
   assert.equal(owner.pid,process.pid);assert.equal(typeof owner.identity,'string');
   assert.equal(await lockOwnerAlive(owner),true);
   assert.equal(await lockOwnerAlive({...owner,identity:owner.identity+'-previous-boot'}),false);
  });
  // Old legacy locks without identity remain conservative when their PID is alive.
  await writeFile(file,JSON.stringify({pid:process.pid}));
  await assert.rejects(withFileLock(file,async()=>{}, {timeout:0}),/文件正在保存/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('contending workers see complete lock owners and do not overlap',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-lock-contention-')),file=join(dir,'lock');
 let active=0,completed=0;
 try{
  await Promise.all(Array.from({length:20},()=>withFileLock(file,async()=>{
   assert.equal(++active,1);
   const owner=JSON.parse(await readFile(file,'utf8'));
   assert.equal(owner.pid,process.pid);assert.match(owner.nonce,/^[a-f0-9-]{36}$/);
   await new Promise(resolve=>setTimeout(resolve,2));
   completed++;active--;
  })));
  assert.equal(completed,20);assert.deepEqual(await readdir(dir),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('an unreadable existing lock remains untouched and a timed-out candidate is removed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-lock-unknown-')),file=join(dir,'lock');
 try{
  await writeFile(file,'');
  await assert.rejects(withFileLock(file,async()=>assert.fail('must not acquire unknown lock'),{timeout:0}),/文件正在保存/);
  assert.equal(await readFile(file,'utf8'),'');assert.deepEqual(await readdir(dir),['lock']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a lock left by a terminated owner can be recovered',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-lock-crash-')),file=join(dir,'lock');
 const moduleUrl=new URL('../scripts/editorial-lock.mjs',import.meta.url).href;
 const code=`import {withFileLock} from ${JSON.stringify(moduleUrl)}; await withFileLock(process.argv[1],async()=>{process.stdout.write('locked\\n');await new Promise(()=>setInterval(()=>{},1000));});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,file],{stdio:['ignore','pipe','pipe']});
 try{
  const exited=once(child,'exit');
  await once(child.stdout,'data');
  assert.equal(JSON.parse(await readFile(file,'utf8')).pid,child.pid);
  child.kill('SIGKILL');await exited;
  await withFileLock(file,async()=>assert.equal(JSON.parse(await readFile(file,'utf8')).pid,process.pid));
  assert.deepEqual(await readdir(dir),[]);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
});
