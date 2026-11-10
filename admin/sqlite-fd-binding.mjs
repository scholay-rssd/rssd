// Linux-only descriptor binding. The caller must not yield between snapshot and
// DatabaseSync construction, otherwise a foreign descriptor can be misattributed.
import {readdirSync,fstatSync,lstatSync} from 'node:fs';
import {CoordinationError} from './release-coordination.mjs';
function descriptors(){
 let names;try{names=readdirSync('/proc/self/fd');}catch{throw new CoordinationError('Cannot inspect SQLite descriptors');}
 const result=new Map();
 for(const name of names){
  if(!/^\d+$/.test(name))continue;const fd=Number(name);
  try{const st=fstatSync(fd);if(st.isFile())result.set(fd,{dev:st.dev,ino:st.ino});}
  catch(e){if(e.code!=='EBADF')throw new CoordinationError('Cannot inspect SQLite descriptor');}
 }
 return result;
}
export function beginDescriptorObservation(path){
 let current;try{const s=lstatSync(path);if(!s.isFile()||s.nlink!==1)throw new CoordinationError('Unsafe database');current={dev:s.dev,ino:s.ino};}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const before=descriptors();
 if(current&&[...before.values()].some(s=>s.dev===current.dev&&s.ino===current.ino))throw new CoordinationError('Database already has another process-local descriptor');
 return {path,before,current};
}
export function finishDescriptorObservation(observation){
 let s;try{s=lstatSync(observation.path);}catch{throw new CoordinationError('Database missing after open');}
 if(!s.isFile()||s.nlink!==1||(observation.current&&(s.dev!==observation.current.dev||s.ino!==observation.current.ino)))throw new CoordinationError('Database replaced during open');
 const after=descriptors(),matching=[...after].filter(([,v])=>v.dev===s.dev&&v.ino===s.ino);
 if(matching.length!==1||observation.before.has(matching[0][0]))throw new CoordinationError('Cannot uniquely bind SQLite database descriptor');
 return {path:observation.path,fd:matching[0][0],dev:s.dev,ino:s.ino};
}
export function verifyDescriptor(binding){
 let path,fd;try{path=lstatSync(binding.path);fd=fstatSync(binding.fd);}catch{throw new CoordinationError('SQLite database descriptor missing');}
 if(!path.isFile()||!fd.isFile()||path.nlink!==1||path.dev!==binding.dev||path.ino!==binding.ino||fd.dev!==binding.dev||fd.ino!==binding.ino)throw new CoordinationError('SQLite database descriptor replaced');
 const matching=[...descriptors()].filter(([,v])=>v.dev===binding.dev&&v.ino===binding.ino);
 if(matching.length!==1||matching[0][0]!==binding.fd)throw new CoordinationError('Ambiguous SQLite database descriptor');
}
