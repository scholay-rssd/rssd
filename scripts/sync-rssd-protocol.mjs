import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=new URL('../contracts/rssd-v1.cjs',import.meta.url);
const target=new URL('../center/rssd/',import.meta.url);
const bytes=await readFile(source);await mkdir(target,{recursive:true});
await writeFile(new URL('protocol.cjs',target),bytes);
// Keep the imported filename so publication.cjs works in both repositories.
await writeFile(new URL('rssd-v1.cjs',target),"module.exports=require('./protocol.cjs');\n");
await writeFile(new URL('publication.cjs',target),await readFile(new URL('../contracts/rssd-publication.cjs',import.meta.url)));
await writeFile(new URL('rssd-media.cjs',target),await readFile(new URL('../contracts/rssd-media.cjs',import.meta.url)));
const files={};for(const path of ['contracts/rssd-v1.cjs','contracts/rssd-publication.cjs','contracts/rssd-media.cjs'])files[path]=createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex');
await writeFile(new URL('protocol.source.json',target),JSON.stringify({version:1,repository:'scholay-rssd/rssd',path:'contracts/rssd-v1.cjs',sha256:files['contracts/rssd-v1.cjs'],files,license:'MIT'},null,2)+'\n');
console.log('RSSD protocol v1 synchronized with a source fingerprint');
