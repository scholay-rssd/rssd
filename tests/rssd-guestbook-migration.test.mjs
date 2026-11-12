import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openGuestbook,submit} from '../admin/guestbook/store.mjs';
import {exportGuestbook} from '../scripts/rssd-migrate-guestbook.mjs';
import {profiles} from '../scripts/site-config.mjs';
import p from '../contracts/rssd-v1.cjs';
test('private guestbook export retains secret, original IDs and unapproved private details',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-guestbook-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const database=join(directory,'guestbook.sqlite'),db=openGuestbook(database,'xsime');
 const result=submit(db,{visitor:'a'.repeat(64),day:'2026-11-01',key:'original-request-key',payload:{kind:'feature',name:'Synthetic',message:'Suggestion',contact:'private@example.org',details:{scenario:'private detail'}},now:1793505600000});db.close();
 const output=join(directory,'private.json');await exportGuestbook({database,site:profiles.find(s=>s.id==='xsime'),output});
 const bundle=JSON.parse(await readFile(output));assert.equal(bundle.source.messages[0].id,result.id);assert.equal(bundle.source.messages[0].status,'pending');assert.equal(JSON.parse(bundle.source.messages[0].payload).contact,'private@example.org');assert.equal(bundle.sourceHash,p.hash(bundle.source));assert.equal(bundle.source.guestbook_meta.find(r=>r.key==='secret').value.length,64);
 await assert.rejects(exportGuestbook({database,site:profiles.find(s=>s.id==='scholay-today'),output}),/site mismatch/);
});
