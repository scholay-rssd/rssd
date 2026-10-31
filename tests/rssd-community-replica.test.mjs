import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CommunityMirror,publicCommunity} from '../receiver/community.mjs';
test('community replica keeps only valid source/topic pairs and survives center failure',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-discussion-'));t.after(()=>rm(directory,{recursive:true,force:true}));let now=0,ok=true;
 const payload={version:1,links:{'/news/example/':'https://enterscholar.com/t/-/123'},private:'must not be public'};
 const mirror=new CommunityMirror({origin:'https://center.example.org',siteId:'metho',directory},{now:()=>now,fetchImpl:async()=>ok?new Response(JSON.stringify(payload)):new Response('Unavailable',{status:503})});
 await mirror.tick();const file=join(directory,'links.json'),original=await readFile(file,'utf8');assert(!original.includes('private'));
 now+=60001;ok=false;await assert.rejects(mirror.tick(),/503/);assert.equal(await readFile(file,'utf8'),original);
 for(const links of [{'/news/a/':'https://evil.example/t/-/1'},{'/news/%2e%2e/':'https://enterscholar.com/t/-/1'},{'/news/a/':'javascript:alert(1)'},{'/news/a/?token=1':'https://enterscholar.com/t/-/1'}])assert.throws(()=>publicCommunity({version:1,links}));
});
