import {rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

// Windows readers and scanners can briefly deny replacement. Keep the original
// file in place throughout the retry; never unlink it to make rename succeed.
export async function replaceFile(source,target,{platform=process.platform,move=rename,wait=delay}={}){
 for(let attempt=0;;attempt++){
  try{return await move(source,target);}
  catch(error){
   if(platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=7)throw error;
   await wait(Math.min(20*2**attempt,250));
  }
 }
}
