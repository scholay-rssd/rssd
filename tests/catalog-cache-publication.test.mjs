import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

test('partial cloud catalog is visible and cached without replacing the authoritative version index',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-partial-catalog-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});await mkdir(join(root,'articles'));
 await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));
 await mkdir(join(root,'.local/today'),{recursive:true});
 await writeFile(join(root,'.local/today/remote-index.json'),JSON.stringify({checkedAt:'before',items:[{id:'existing',version:7}]}));
 const moduleUrl=new URL('../desktop/scripts/publication-center.mjs',import.meta.url).href;
 const script=`
 import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {join} from 'node:path';
 let calls=0;globalThis.fetch=async(url,options)=>{
  assert.equal(options.method,'GET');calls++;
  if(calls>1)return Response.json({error:'rate limited'},{status:429,headers:{'Retry-After':'60'}});
  return Response.json({generation:1,scope:'all',next:80,items:[{key:'news:one',kind:'news',title:'partial',articleId:'one',url:'https://today.scholay.com/news/one/',version:1,publishedVersion:null}]});
 };
 const {refreshWebsite}=await import(${JSON.stringify(moduleUrl)});
 for(let i=0;i<5;i++){const value=await refreshWebsite({refresh:true});assert.equal(value.partial,true);assert.equal(value.items.length,1);assert.match(value.notice,/尚未完整/);}
 assert.equal(calls,2);
 const root=process.env.SCHOLAY_EDITORIAL_ROOT;
 const index=JSON.parse(await readFile(join(root,'.local/today/remote-index.json'),'utf8'));assert.equal(index.checkedAt,'before');assert.deepEqual(index.items,[{id:'existing',version:7}]);
 const displayed=JSON.parse(await readFile(join(root,'.local/publication-center/website.json'),'utf8'));assert.equal(displayed.partial,true);assert.equal(displayed.items.length,1);
 console.log('partial catalog cached; original version index preserved; Retry-After respected');`;
 const result=await run(process.execPath,['--input-type=module','-e',script],{env:{...process.env,SCHOLAY_EDITORIAL_ROOT:root,SCHOLAY_TODAY_TOKEN:'synthetic-catalog-read-token'},windowsHide:true});
 assert.match(result.stdout,/original version index preserved/);
});
