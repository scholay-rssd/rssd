import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const bytes=await readFile(new URL('../contracts/writing-defaults-v1.cjs',import.meta.url));
const target=new URL('../center/rssd/writing-defaults-v1.cjs',import.meta.url);
if(process.argv.includes('--check')){if(!bytes.equals(await readFile(target)))throw Error('Center writing defaults contract differs from core');}
else{
 await writeFile(target,bytes);
 await writeFile(new URL('../center/rssd/writing-defaults.source.json',import.meta.url),JSON.stringify({repository:'scholay-rssd/rssd',path:'contracts/writing-defaults-v1.cjs',sha256:createHash('sha256').update(bytes).digest('hex'),license:'MIT'},null,2)+'\n');
}
