import {mkdir,open,rm} from 'node:fs/promises';
import {replaceFile} from './replace-file.mjs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// Accepted background work must survive losing the process after its ACK.
export async function durableWriteJson(file,value){
 const directory=dirname(file),temporary=file+'.'+randomUUID()+'.tmp';
 await mkdir(directory,{recursive:true,mode:0o700});
 try{
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
  await replaceFile(temporary,file);
  // Windows does not support opening directories with Node. The atomically
  // replaced file has already been flushed; Unix also flushes its directory.
  if(process.platform!=='win32'){
   const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
  }
 }finally{await rm(temporary,{force:true});}
}
