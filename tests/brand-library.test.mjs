import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {brandLibrary,brandSeeds,siteBrandIds} from '../desktop/scripts/agent/brand-library.mjs';
async function fixture(t){const data=await mkdtemp(join(tmpdir(),'today-brands-'));t.after(()=>rm(data,{recursive:true,force:true}));return data;}
test('shared defaults contain the two requested brands and ten distinct canonical sites',async t=>{
 const data=await fixture(t),brands=await brandLibrary({data});assert.equal(brands.length,12);
 assert.equal(brands.filter(b=>b.id.startsWith('site:')).length,10);
 assert.match(brands.find(b=>b.name==='恩特学术').description,/enterscholar\.com/);
 assert.match(brands.find(b=>b.name==='学术之门').description,/enter\.scholay\.com/);
 assert.match(brands.find(b=>b.name==='小猪盖被').description,/https:\/\/www\.piggytuck\.com/);
 assert.deepEqual(await brandLibrary({data}),brands);
});
test('legacy import preserves IDs, versions and exact endnotes without changing the original DB',async t=>{
 const data=await fixture(t),brand={...brandSeeds()[0],id:'existing-id',version:4,endnotes:[{id:'existing-note',label:'原尾注',text:'信息由 [Scholay](https://www.scholay.com/t/M4ZZW8KRE5) 整理。'}]};
 const db=new DatabaseSync(join(data,'papr.db'));db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO settings VALUES (?,?)').run('writing.brands.v1.academic',JSON.stringify([brand]));db.close();
 await writeFile(join(data,'spaces.json'),JSON.stringify({sites:[{spaceId:'academic',legacy:true}]}));
 const before=await readFile(join(data,'papr.db')),list=await brandLibrary({data});assert.equal(list.length,12);assert.deepEqual(list.find(b=>b.id==='existing-id'),brand);assert.deepEqual(await readFile(join(data,'papr.db')),before);
});
test('updates are visible across clients, retain snapshots and reject concurrent stale saves',async t=>{
 const data=await fixture(t),a=await brandLibrary({data}),b=await brandLibrary({data});
 const results=await Promise.allSettled(['one','two'].map(name=>brandLibrary({data,brand:{...a[0],name},expectedVersion:1})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const current=await brandLibrary({data});assert.equal(current.find(v=>v.id===a[0].id).version,2);assert.equal(b[0].version,1);assert.equal(b[0].name,a[0].name);
});
test('malformed data and invalid saves never overwrite the existing library',async t=>{
 const data=await fixture(t),a=await brandLibrary({data}),file=join(data,'writing-brands.json'),before=await readFile(file);
 await assert.rejects(brandLibrary({data,brand:{...a[0],endnotes:[{id:'bad',label:'',text:''}]},expectedVersion:1}),/尾注/);
 assert.deepEqual(await readFile(file),before);await writeFile(file,'broken');await assert.rejects(brandLibrary({data}));assert.equal(await readFile(file,'utf8'),'broken');
});
test('headless site mounts follow the pets-only and academic-family brand rule',()=>{
 assert.deepEqual(siteBrandIds('pets'),['site:pets']);
 assert.deepEqual(siteBrandIds('scholay-today'),['scholay-platform','enterscholar']);
 assert.deepEqual(siteBrandIds('metho')[0],'site:metho');
 assert.throws(()=>siteBrandIds('Pets'),/站点编号/);
});
test('custom brands from other spaces are retained and not reimported over later shared edits',async t=>{
 const data=await fixture(t),dir=join(data,'spaces','metho');await mkdir(dir,{recursive:true});
 const old={...brandSeeds()[1],id:'custom',name:'我的品牌',description:'自定义资料',endnotes:[]};
 const db=new DatabaseSync(join(dir,'papr.db'));db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO settings VALUES (?,?)').run('writing.brands.v1.metho',JSON.stringify([old]));db.close();
 await writeFile(join(data,'spaces.json'),JSON.stringify({sites:[{spaceId:'metho'}]}));
 const first=await brandLibrary({data});assert.equal(first.length,13);
 await brandLibrary({data,brand:{...old,name:'共享后的修改'},expectedVersion:1});assert.equal((await brandLibrary({data})).find(b=>b.id==='custom').name,'共享后的修改');
});

test('all site policies resolve imported brand IDs without replacing custom text or versions',async()=>{
 const {siteBrandMounts}=await import('../desktop/scripts/agent/brand-library.mjs');
 const {profiles}=await import('../scripts/site-config.mjs');
 const brands=brandSeeds().map(b=>({...b,id:'imported-'+b.id,version:7}));
 for(const site of profiles){
  const result=siteBrandMounts(site.id,brands);
  assert.equal(result.length,siteBrandIds(site.id).length);
  for(const b of result){assert.ok(brands.includes(b));assert.equal(b.version,7);}
 }
 assert.throws(()=>siteBrandMounts('metho',[...brands,{...brands[0],id:'duplicate'}]),/不唯一/);
});
