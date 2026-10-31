import {mkdir,readFile,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import m from '../contracts/rssd-media.cjs';
import p from '../contracts/rssd-v1.cjs';
export class ReceiverMedia {
 constructor(directory){this.directory=directory;}
 async status(sha256){
  if(!/^[a-f0-9]{64}$/.test(sha256))p.fail('Invalid media checksum');
  for(const extension of ['png','jpg','webp'])try{const bytes=await readFile(join(this.directory,sha256+'.'+extension)),manifest=m.imageManifest(bytes);if(manifest.sha256!==sha256)p.fail('Stored media checksum mismatch',409);return manifest;}catch(error){if(error.code!=='ENOENT')throw error;}
  p.fail('Media not found',404,'not_found');
 }
 async accept(sha256,input){
  const {bytes,manifest}=m.decodeImage(input);if(sha256!==manifest.sha256)p.fail('Media identity mismatch',409);
  await mkdir(this.directory,{recursive:true,mode:0o700});const destination=join(this.directory,manifest.path.split('/').at(-1));
  try{return await this.status(sha256);}catch(error){if(error.status!==404)throw error;}
  const temporary=destination+'.'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await rename(temporary,destination);}finally{await rm(temporary,{force:true});}
  return manifest;
 }
 async bytes(manifest){const expected=m.mediaManifest(manifest),bytes=await readFile(join(this.directory,expected.path.split('/').at(-1)));if(p.hash(m.imageManifest(bytes))!==p.hash(expected))p.fail('Stored media does not match the publication',409);return bytes;}
}
