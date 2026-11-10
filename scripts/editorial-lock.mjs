import {mkdir,readFile,writeFile,link,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
async function processIdentity(pid){
  if(process.platform==='linux')try{const stat=await readFile('/proc/'+pid+'/stat','utf8'),boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();return boot+':'+stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];}catch{return null;}
  if(process.platform==='darwin')try{
    const opts={encoding:'utf8',timeout:2000,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LC_ALL:'C'}};
    const [boot,start]=await Promise.all([exec('/usr/sbin/sysctl',['-n','kern.bootsessionuuid'],opts),exec('/bin/ps',['-p',String(pid),'-o','lstart='],opts)]);
    const session=boot.stdout.trim(),time=start.stdout.trim().replace(/\s+/g,' ');
    if(!/^[0-9A-Fa-f-]{36}$/.test(session)||!time)return null;
    return 'darwin:'+session+':'+time;
  }catch{return null;}
  return null;
}
export async function lockOwnerAlive(owner){
  if(!Number.isSafeInteger(owner?.pid)||owner.pid<=0)return true;
  try{process.kill(owner.pid,0);}catch(e){return e.code!=='ESRCH';}
  if(owner.identity){const current=await processIdentity(owner.pid);if(current&&current!==owner.identity)return false;}
  return true;
}
export async function withFileLock(file,work,{timeout=5000}={}){
  await mkdir(dirname(file),{recursive:true});const start=Date.now(),nonce=randomUUID(),identity=await processIdentity(process.pid);
  // Prepare the complete owner record before making the shared lock visible.
  // An interrupted write can leave an unused candidate, but never an empty
  // shared lock that every receiver must conservatively treat as occupied.
  const candidate=file+'.'+nonce+'.candidate';
  await writeFile(candidate,JSON.stringify({pid:process.pid,at:Date.now(),nonce,...(identity?{identity}:{})}),{flag:'wx',mode:0o600});
  try{
    for(;;){
      try{await link(candidate,file);break;}
      catch(e){if(e.code!=='EEXIST')throw e;
        try{const owner=JSON.parse(await readFile(file,'utf8'));if(!await lockOwnerAlive(owner)){await rm(file,{force:true});continue;}}catch{}
        if(Date.now()-start>=timeout)throw Error('文件正在保存，请稍后重试；现有内容已保留');
        await new Promise(r=>setTimeout(r,30));
      }
    }
  }finally{await rm(candidate,{force:true}).catch(()=>{});}
  try{return await work();}finally{try{if(JSON.parse(await readFile(file,'utf8')).nonce===nonce)await rm(file,{force:true});}catch(e){if(e.code!=='ENOENT')throw e;}}
}
