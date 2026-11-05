import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {profiles,siteDescriptor} from '../scripts/site-config.mjs';
import {AUTHORIZATION_FORMAT,parseAuthorization,validateAuthorization} from '../contracts/site-authorization.mjs';
import {registry,importSite,authorizationTarget,registerAuthorizedSite} from '../scripts/space-registry.mjs';
import {verifyAuthorization} from '../desktop/scripts/space-authorization.mjs';
import {issueSiteAuthorization,revokeSiteAuthorization} from '../scripts/issue-site-authorization.mjs';
import {createApp} from '../admin/server.mjs';

const site=profiles.find(s=>s.id==='legis');
const token='synthetic-test-credential-not-a-real-secret-123456';
const authorization=(overrides={})=>({format:AUTHORIZATION_FORMAT,version:1,issuedAt:'2026-10-15T00:00:00Z',site,credential:{id:randomUUID(),scope:'editorial_publish',token},...overrides});
function fixture(t,beforeRemove=()=>{}){const dir=mkdtempSync(join(tmpdir(),'site-authorization-'));t.after(async()=>{await beforeRemove();rmSync(dir,{recursive:true,force:true});});return dir;}
const fakeSite=(s=site)=>async(url,options)=>{assert.equal(options.redirect,'error');return url.endsWith('/manage/api/site')?Response.json(siteDescriptor(s)):Response.json({items:[]});};

test('portable authorization rejects malformed, oversized, non-HTTPS and identity-changing input without echoing secrets',()=>{
 for(const input of [token,`{"credential":"${token}`, ' '.repeat(65537)])assert.throws(()=>parseAuthorization(input),e=>!e.message.includes(token));
 for(const change of [{version:2},{site:{...site,origin:'https://legis.wiki/path'}},{site:{...site,origin:'http://localhost'}},{site:{...site,spaceId:'../../outside'}},{site:{...site,legacy:true}},{site:{...site,spaceId:'academic'}},{site:{...profiles[0],spaceId:'elsewhere'}},{credential:{id:randomUUID(),scope:'publisher',token}}])assert.throws(()=>validateAuthorization(authorization(change)));
 const parsed=parseAuthorization('\ufeff'+JSON.stringify(authorization({site:{...site,workspaceRoot:'/private/untrusted',command:'echo secret'}})));
 assert.equal(parsed.site.workspaceRoot,undefined);assert.equal(parsed.site.command,undefined);
});

test('new installations start with one space and imports do not change an existing registry',t=>{
 const data=fixture(t);assert.equal(registry(data).sites.length,1);
 writeFileSync(join(data,'spaces.json'),JSON.stringify({version:1,activeSpaceId:'lingxi',sites:profiles.slice(0,5)}));
 assert.equal(registry(data).sites.length,5);assert.equal(registry(data).activeSpaceId,'lingxi');
});

test('live identity is checked without a token, then authorization is checked without modifying local state',async t=>{
 const data=fixture(t),calls=[];
 const result=await verifyAuthorization(data,authorization(),async(url,options)=>{calls.push({url,options});return fakeSite()(url,options);});
 assert.equal(result.connected,true);assert.equal(result.siteId,'legis');assert(!JSON.stringify(result).includes(token));
 assert.equal(calls[0].options.headers,undefined);assert.equal(calls[1].options.headers.Authorization,'Bearer '+token);
 assert.equal(existsSync(join(data,'spaces.json')),false);assert.equal(existsSync(join(data,'spaces')),false);
});

test('mismatched identity and revoked credentials never create spaces; redirects and transport failures do not leak tokens',async t=>{
 const data=fixture(t);let calls=0;
 await assert.rejects(verifyAuthorization(data,authorization(),async()=>{calls++;return Response.json({...siteDescriptor(site),siteId:'other'});}),/身份/);assert.equal(calls,1);
 await assert.rejects(verifyAuthorization(data,authorization(),async url=>url.endsWith('/site')?Response.json(siteDescriptor(site)):new Response('',{status:403})),/鉴权失败/);
 await assert.rejects(verifyAuthorization(data,authorization(),async()=>{throw Error(token);}),e=>!e.message.includes(token));
 assert.equal(existsSync(join(data,'spaces.json')),false);assert.equal(existsSync(join(data,'spaces')),false);
});

test('duplicate authorization preserves workspace paths, columns, drafts, receipts and active selection',t=>{
 const data=fixture(t),first=registerAuthorizedSite(data,site);
 writeFileSync(join(first.workspaceRoot,'articles','keep.md'),'unchanged manuscript');
 mkdirSync(join(first.workspaceRoot,'.local'));writeFileSync(join(first.workspaceRoot,'.local','receipt.json'),'original request receipt');
 const before=readFileSync(join(data,'spaces.json'),'utf8');
 const second=registerAuthorizedSite(data,{...site,name:'Changed name',columns:profiles[0].columns});
 assert.equal(second.existing,true);assert.equal(second.workspaceRoot,first.workspaceRoot);assert.deepEqual(second.site.columns,site.columns);
 assert.equal(readFileSync(join(first.workspaceRoot,'articles','keep.md'),'utf8'),'unchanged manuscript');assert.equal(readFileSync(join(first.workspaceRoot,'.local','receipt.json'),'utf8'),'original request receipt');
 assert.equal(readFileSync(join(data,'spaces.json'),'utf8'),before);assert.equal(registry(data).activeSpaceId,'academic');
 for(const file of ['spaces.json',join('spaces',site.spaceId,'site.json'),join('spaces',site.spaceId,'website-vault-managed')])assert(!readFileSync(join(data,file),'utf8').includes(token));
});

test('conflicting IDs, domains, and orphaned directories are rejected before credentials are sent',async t=>{
 const data=fixture(t);registerAuthorizedSite(data,site);
 for(const next of [{...site,id:'other'},{...site,spaceId:'other'},{...site,origin:'https://other.example'}]){
  let called=false;await assert.rejects(verifyAuthorization(data,authorization({site:next}),async()=>{called=true;}),/空间|地址/);assert.equal(called,false);
 }
 const other={...site,id:'other',spaceId:'other'};mkdirSync(join(data,'spaces','other'));writeFileSync(join(data,'spaces','other','data'),'valuable');
 assert.throws(()=>authorizationTarget(data,other),/未登记/);assert.equal(readFileSync(join(data,'spaces','other','data'),'utf8'),'valuable');
});

test('supported old domains are verified separately and remain unchanged for existing publication receipts',async t=>{
 const data=fixture(t),canonical=profiles.find(s=>s.id==='lingxi'),old={...canonical,origin:canonical.aliases[0],aliases:[]};importSite(data,old);
 const calls=[];const result=await verifyAuthorization(data,authorization({site:canonical}),async(url,options)=>{calls.push(url);return fakeSite(url.startsWith(old.origin)?old:canonical)(url,options);});
 assert.equal(calls.length,4);assert.equal(result.site.origin,old.origin);assert.equal(authorizationTarget(data,canonical).existing,true);
});

test('a failed final registry write rolls back the new workspace and its binding marker',t=>{
 if(process.getuid?.()===0||process.platform==='win32'){t.skip('requires POSIX directory permissions');return;}
 const data=fixture(t);registry(data);mkdirSync(join(data,'spaces',site.spaceId),{recursive:true});
 const before=readFileSync(join(data,'spaces.json'),'utf8');chmodSync(data,0o500);
 try{assert.throws(()=>registerAuthorizedSite(data,site));}finally{chmodSync(data,0o700);}
 assert.equal(readFileSync(join(data,'spaces.json'),'utf8'),before);
 assert.equal(existsSync(join(data,'spaces',site.spaceId,'workspace')),false);
 assert.equal(existsSync(join(data,'spaces',site.spaceId,'website-vault-managed')),false);
});

test('issuance is idempotent, private, scoped, accepted by the server and individually revocable',async t=>{
 let app;const data=fixture(t,()=>app?.close());app=await createApp({dbPath:join(data,'admin.sqlite')});
 const academic=profiles[0],file=join(data,'authorization.json');
 const issued=issueSiteAuthorization(app.db,academic,file),again=issueSiteAuthorization(app.db,academic,file);
 assert.equal(issued.credentialId,again.credentialId);assert.equal(again.existing,true);assert.equal(app.db.prepare('SELECT count(*) AS n FROM tokens').get().n,1);
 if(process.platform!=='win32')assert.equal(statSync(file).mode&0o777,0o600);
 const auth=parseAuthorization(readFileSync(file,'utf8'));
 const fetcher=async(url,options)=>{const result=await app.inject({method:'GET',url:new URL(url).pathname+new URL(url).search,headers:options.headers});return new Response(result.body,{status:result.statusCode});};
 assert.equal((await verifyAuthorization(join(data,'client'),auth,fetcher)).connected,true);
 assert.equal(app.db.prepare('SELECT scope FROM tokens').get().scope,'editorial_publish');
 revokeSiteAuthorization(app.db,issued.credentialId);
 await assert.rejects(verifyAuthorization(join(data,'client'),auth,fetcher),/鉴权失败/);
 assert.throws(()=>issueSiteAuthorization(app.db,academic,file),/不一致/);
 assert.equal(existsSync(join(data,'client','spaces.json')),false);
});
