import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isPrivateFile,protectPrivateFile} from '../scripts/private-file.mjs';
import {makePublic} from './fixtures/private-file.mjs';

test('private credentials reject public access and recheck ACL changes and replacement files',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-private-file-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,"私有 [credential] ' $value.txt"),replacement=join(root,'replacement');
 await writeFile(file,'synthetic credential',{mode:0o600});await protectPrivateFile(file);
 assert.equal(await isPrivateFile(file),true);
 await makePublic(file);assert.equal(await isPrivateFile(file),false);
 await writeFile(replacement,'rotated credential',{mode:0o600});await protectPrivateFile(replacement);await rename(replacement,file);
 assert.equal(await isPrivateFile(file),true);
 assert.equal(await isPrivateFile(root),false);
 await assert.rejects(isPrivateFile(join(root,'absent')),error=>error.code==='ENOENT');
});
