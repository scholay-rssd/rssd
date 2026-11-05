import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {createDraft,packedDraft,sha} from '../scripts/editorial-workspace.mjs';
import {publicationImage} from '../scripts/publication-images.mjs';

test('frozen notebook figures publish exact reviewed bytes and reject a changed source image',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-frozen-images-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:['新闻聚合'],articles:{}}));
 const original=await sharp({create:{width:750,height:452,channels:3,background:'#def'}}).webp().toBuffer(),src='assets/notebook/'+sha(original)+'.webp';
 const draft=await createDraft({id:'test-frozen-figure',title:'原图',markdown:'# 原图\n\n![研究原图]('+src+')\n\n图 1｜原图未修改。'},root);
 const file=join(root,dirname(draft.canonicalPath),src);await mkdir(dirname(file),{recursive:true});await writeFile(file,original);
 const packed=await packedDraft(draft.id,root);assert.equal(packed.assets.length,1);assert.deepEqual(Buffer.from(packed.assets[0].data,'base64'),original);assert.equal((await sharp(Buffer.from(packed.assets[0].data,'base64')).metadata()).height,452);assert(packed.markdown.includes('图 1｜原图未修改。'));
 await writeFile(file,await sharp({create:{width:750,height:452,channels:3,background:'#abc'}}).webp().toBuffer());
 await assert.rejects(packedDraft(draft.id,root),/笔记配图已改变/);
});

test('ordinary publication image branding follows the selected site and isolates its cached derivative',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-selected-brand-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bytes=await sharp({create:{width:750,height:452,channels:3,background:'#def'}}).png().toBuffer();
 const pets={id:'pets',name:'Pets',legacy:false},metho={id:'metho',name:'Methods',legacy:false};
 const a=await publicationImage(bytes,root,{site:pets}),b=await publicationImage(bytes,root,{site:metho});assert.notDeepEqual(a,b);assert.deepEqual(await publicationImage(bytes,root,{site:pets}),a);
});
