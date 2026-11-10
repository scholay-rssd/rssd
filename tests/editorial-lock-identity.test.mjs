import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
