import {open} from 'node:fs/promises';
import {spawn} from 'node:child_process';

// The flock child inherits our open file description. Its successful lock stays
// held by this process until close (or process exit), with no stale lease files.
// A root-owned, world-readable lock is provisioned outside the public releases.
export async function withPublicationLock(path,work){
  if(!path)return work();
  const file=await open(path,'r');
  try{
    const code=await new Promise((resolve,reject)=>{
      const child=spawn('flock',['--exclusive','--nonblock','--conflict-exit-code','75','3'],{stdio:['ignore','ignore','pipe',file.fd],windowsHide:true});
      let error='';child.stderr.on('data',chunk=>{error=(error+chunk).slice(-1000);});
      child.on('error',reject);
      child.on('close',code=>[0,75].includes(code)?resolve(code):reject(Error('发布资源锁不可用：'+error)));
    });
    if(code===75)return;
    return await work();
  }finally{await file.close();}
}
