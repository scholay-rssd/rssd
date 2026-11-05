import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDraft,saveDraft,readDraft,workspaceCall,packedDraft,sha} from '../scripts/editorial-workspace.mjs';
import {renderArticle} from '../scripts/article-format.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'scholay-editorial-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:['新闻聚合'],articles:{}}));return root;}
test('index-only title changes refresh the manuscript map without changing identity or body',async t=>{
 const root=await fixture(t),draft=await createDraft({id:'index-title',title:'旧标题',markdown:'# 正文不变'},root);
 const before=await workspaceCall('workspace_stamp',{},root),path=join(root,'_ops/inventory/article-index.json');
 const index=JSON.parse(await readFile(path,'utf8'));index.articles[draft.id].shortTitle='用于左栏的新标题';await writeFile(path,JSON.stringify(index));
 assert.notEqual((await workspaceCall('workspace_stamp',{},root)).stamp,before.stamp);
 const listed=(await workspaceCall('draft_list',{},root)).articles[0];
 assert.equal(listed.id,draft.id);assert.equal(listed.canonicalPath,draft.canonicalPath);assert.equal(listed.shortTitle,'用于左栏的新标题');
 assert.equal((await readDraft(draft.id,root)).sha256,draft.sha256);
});
test('shared manuscripts preserve external changes and stable identity with a backup',async t=>{
 const root=await fixture(t),d=await createDraft({id:'news-example',title:'测试文章',markdown:'# 原稿'},root);
 const saved=await saveDraft({id:d.id,markdown:'# 改稿',expectedSha256:d.sha256},root);
 assert.equal(saved.canonicalPath,d.canonicalPath);assert.equal(await readFile(join(root,'.local/editorial-backups',d.id,d.sha256+'.md'),'utf8'),'# 原稿');
 await assert.rejects(saveDraft({id:d.id,markdown:'# 过时',expectedSha256:d.sha256},root),/CONFLICT/);
 await writeFile(join(root,d.canonicalPath),'# Cursor 的修改');
 await assert.rejects(saveDraft({id:d.id,markdown:'# 覆盖',expectedSha256:saved.sha256},root),/CONFLICT/);
 assert.equal((await readDraft(d.id,root)).markdown,'# Cursor 的修改');
 assert.match((await workspaceCall('draft_preview',{id:d.id},root)).html,/<h1>Cursor 的修改/);
 await assert.rejects(createDraft({id:d.id,title:'重复',markdown:'文本'},root),/already exists/);
});
test('manuscript operations refuse escaping paths and package local raster assets',async t=>{
 const root=await fixture(t),d=await createDraft({id:'news-image',title:'图片稿',markdown:'# 图片稿'},root),dir=join(root,d.canonicalPath,'..');
 const image=await (await import('sharp')).default({create:{width:320,height:180,channels:3,background:'#4d7060'}}).png().toBuffer();await writeFile(join(dir,'test.png'),image);
 await saveDraft({id:d.id,markdown:'# 图\n\n![例](test.png)',expectedSha256:d.sha256},root);
 const packed=await packedDraft(d.id,root);assert.equal(packed.assets.length,1);assert.match(packed.markdown,/article-media\/[a-f0-9]{64}\.webp/);
 const latest=await readDraft(d.id,root);await symlink(join(root,'_ops/inventory/article-index.json'),join(dir,'escape.png'));
 await saveDraft({id:d.id,markdown:'![例](escape.png)',expectedSha256:latest.sha256},root);
 await assert.rejects(packedDraft(d.id,root),/leaves/);
 await assert.rejects(workspaceCall('run_shell',{},root),/Unknown/);
});
test('live manuscript preview renders the buffer without saving or weakening Markdown safety',async t=>{
 const root=await fixture(t),d=await createDraft({id:'live-preview',title:'实时预览',markdown:'# 已保存'},root);
 const markdown='# 尚未保存\n\n**加粗**与[来源](https://example.org/article)\n\n<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))';
 const preview=await workspaceCall('draft_preview',{id:d.id,markdown,embedImages:true},root);
 assert.equal(preview.id,d.id);assert.equal(preview.sha256,sha(markdown));assert.match(preview.html,/<h1>尚未保存<\/h1>/);assert.match(preview.html,/<strong>加粗<\/strong>/);
 assert.match(preview.html,/href="https:\/\/example.org\/article" rel="noopener noreferrer"/);
 assert.doesNotMatch(preview.html,/<script|href="javascript:/);assert.match(preview.html,/&lt;script&gt;/);
 assert.equal((await readDraft(d.id,root)).markdown,'# 已保存');
 assert.equal((await workspaceCall('draft_preview',{id:d.id,markdown:'',embedImages:true},root)).html,'');
 assert.match((await workspaceCall('draft_preview',{id:d.id},root)).html,/已保存/);
 await assert.rejects(workspaceCall('draft_preview',{id:d.id,markdown:42,embedImages:true},root),/invalid/);
 await assert.rejects(workspaceCall('draft_preview',{id:d.id,markdown:'x'.repeat(160001),embedImages:true},root),/too large/);
});
test('live preview resolves local image tokens with spaces and keeps broken or escaped images isolated',async t=>{
 const root=await fixture(t),d=await createDraft({id:'live-images',title:'图片预览',markdown:'# 已保存'},root),dir=join(root,d.canonicalPath,'..');
 const image=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex');
 await mkdir(join(dir,'图片'),{recursive:true});await writeFile(join(dir,'图片/图 表.png'),image);
 const outside=join(root,'articles/private.png');await writeFile(outside,Buffer.concat([image,Buffer.from('PRIVATE_IMAGE_SENTINEL')]));await symlink(outside,join(dir,'escape.png'));
 const markdown='# 图稿\n\n![空格](<图片/图 表.png>)\n\n![编码](图片/图%20表.png)\n\n![远程](https://example.org/photo.jpg)\n\n![缺失](missing.png)\n\n![软链接](escape.png)\n\n![越界](../../../private.png)\n\n![未完成](\n\n尾段继续可读';
 const preview=await workspaceCall('draft_preview',{id:d.id,markdown,embedImages:true},root);
 assert.equal((preview.html.match(/src="data:image\/png;base64,/g)||[]).length,2);
 assert.match(preview.html,new RegExp(image.toString('base64')));assert.match(preview.html,/src="https:\/\/example.org\/photo.jpg"/);
 assert.match(preview.html,/尾段继续可读/);assert.match(preview.html,/图片无法预览/);assert.equal(preview.warnings.length,3);
 assert.doesNotMatch(preview.html,/PRIVATE_IMAGE_SENTINEL|UFJJVkFURV9JTUFHRV9TRU5USU5FTA/);assert.ok(!JSON.stringify(preview).includes(root));
 assert.equal(preview.imageSources,undefined);
 const rich=await workspaceCall('draft_preview',{id:d.id,markdown,embedImages:true,includeImageSources:true},root);
 assert.equal(rich.imageSources['图片/图 表.png'],'data:image/png;base64,'+image.toString('base64'));
 assert.equal(rich.imageSources['escape.png'],null);
 assert.equal(rich.imageSources['missing.png'],null);
 assert.ok(!JSON.stringify(rich.imageSources).includes('UFJJVkFURV9JTUFHRV9TRU5USU5FTA'));
 assert.equal((await readDraft(d.id,root)).markdown,'# 已保存');
 // Local preview replacements are request-scoped, never accepted by the public renderer.
 assert.doesNotMatch(renderArticle('![图](<图片/图 表.png>)'),/data:image/);
 assert.doesNotMatch(renderArticle('![图](data:image/png;base64,'+image.toString('base64')+')'),/<img/);
});
test('live preview omits unsupported and oversized assets while publication remains strict',async t=>{
 const root=await fixture(t),d=await createDraft({id:'live-limits',title:'图片限制',markdown:'![图](missing.png)'},root),dir=join(root,d.canonicalPath,'..');
 await writeFile(join(dir,'vector.svg'),'<svg><script>alert(1)</script></svg>');await writeFile(join(dir,'large.png'),Buffer.alloc(4*1024*1024+1));
 const preview=await workspaceCall('draft_preview',{id:d.id,markdown:'![矢量](vector.svg)\n\n![大图](large.png)\n\n正文仍在',embedImages:true},root);
 assert.equal(preview.warnings.length,2);assert.match(preview.warnings[0],/PNG/);assert.match(preview.warnings[1],/4MB/);assert.match(preview.html,/正文仍在/);assert.doesNotMatch(preview.html,/<img|<svg|<script/);
 await assert.rejects(packedDraft(d.id,root),/ENOENT/);
});

test('desktop line protocol completes without waiting for parent stdin to close',async t=>{
 const {spawn}=await import('node:child_process');
 const child=spawn(process.execPath,['scripts/editorial-workspace.mjs'],{stdio:['pipe','pipe','pipe']});
 t.after(()=>child.kill());let stderr='';child.stderr.on('data',x=>stderr+=x);
 // Include cold Node startup on a busy Windows host while keeping stdin open.
 const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Manuscript input waited for EOF'));},15000);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);resolve(code);});});
 child.stdin.write(JSON.stringify({method:'unknown',params:{}})+'\n');
 assert.equal(await result,1);assert.match(stderr,/Unknown editorial operation/);
});
