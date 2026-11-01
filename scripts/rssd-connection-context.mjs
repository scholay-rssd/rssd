import {cp,mkdir,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const FILES=['outbox','drafts','media','registry.json','active-claim.json','worker.json','stop.json'];
const key=value=>createHash('sha256').update(JSON.stringify([value.origin,value.identity.orgId])).digest('hex');
const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function copy(source,target){await mkdir(target,{recursive:true,mode:0o700});for(const file of FILES){try{await access(join(source,file));}catch(e){if(e.code==='ENOENT')continue;throw e;}await cp(join(source,file),join(target,file),{recursive:true,force:true});}}
async function clear(home){for(const file of FILES)await rm(join(home,file),{recursive:true,force:true});}
// The journal is written before the first active file changes. An interrupted
// switch restores the immutable old snapshot unless the new connection committed.
export async function recoverConnectionSwitch(home,write){
 const journal=await read(join(home,'connection-switch.json'));if(!journal)return;
 const current=await read(join(home,'connection.json'));
 if(!current||key(current)!==journal.next){await clear(home);await copy(join(home,'contexts',journal.snapshot),home);await write(join(home,'connection.json'),journal.previous);}
 await rm(join(home,'connection-switch.json'));
}
export async function switchConnectionContext(home,previous,next,write){
 await recoverConnectionSwitch(home,write);
 if(!previous||key(previous)===key(next)){await write(join(home,'connection.json'),next);return;}
 const active=await read(join(home,'active-claim.json'));
 if(active?.claim)throw Error('请先恢复或释放当前认领，再切换中心；原稿件已保留');
 const snapshot=key(previous)+'-'+Date.now(),archive=join(home,'contexts',snapshot);
 await copy(home,archive);await write(join(archive,'connection.json'),previous);
 const index=await read(join(home,'contexts','index.json'))||{};
  const target=index[key(next)];
  index[key(previous)]=snapshot;await write(join(home,'contexts','index.json'),index);
 await write(join(home,'connection-switch.json'),{previous,next:key(next),snapshot});
 try{
  await clear(home);
  if(target)await copy(join(home,'contexts',target),home);
  await write(join(home,'connection.json'),next);
 }catch(error){await recoverConnectionSwitch(home,write);throw error;}
 await rm(join(home,'connection-switch.json')).catch(()=>{});
}
