import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {brandSeeds,siteBrandIds,siteBrandMounts} from '../desktop/scripts/agent/brand-library.mjs';
import {finalizeNotebook,publicationMetadataFromNotebook,clipPlain,IMAGE_PRIORITY} from '../desktop/scripts/agent/notebook-finalize.mjs';
import {notebookMarkdown} from '../desktop/scripts/agent/notebook.mjs';
import {recordHeadings} from '../scripts/editorial-record.mjs';
import {createDraft} from '../scripts/editorial-workspace.mjs';
import {annexFolderStamp} from '../scripts/editorial-workspace.mjs';
import {TaskStore} from '../desktop/scripts/agent/task-store.mjs';
import {openNotebook,exportNotebook,applyNotebookImage} from '../desktop/scripts/agent/notebook-store.mjs';
import {canonicalSiteId} from '../desktop/scripts/agent/headless/env.mjs';
import {initSpaces} from '../desktop/scripts/agent/headless/spaces.mjs';
import {DEFAULT_SITE} from '../scripts/site-config.mjs';
import {publicationDirectory} from '../scripts/site-config.mjs';

const note=(id,text,extra={})=>({id,type:'paragraph',state:'ready',text,sourceIds:[],...extra});

test('site brand policy keeps pets exclusive and does not duplicate Scholay on today',()=>{
 assert.deepEqual(siteBrandIds('pets'),['site:pets']);
 assert.deepEqual(siteBrandIds('scholay-today'),['scholay-platform','enterscholar']);
 assert.deepEqual(siteBrandIds('metho'),['site:metho','scholay-platform','enterscholar']);
 assert.deepEqual(siteBrandIds('enter'),['site:enter','scholay-platform','enterscholar']);
 const mounts=siteBrandMounts('pets');
 assert.equal(mounts.length,1);
 assert.match(mounts[0].endnotes[0].text,/\[小猪萌宠\]\(https:\/\/pet\.piggytuck\.com\)/);
 assert.doesNotMatch(mounts[0].endnotes[0].text,/scholay\.com|enterscholar/);
 const today=siteBrandMounts('scholay-today');
 assert.equal(today.map(b=>b.id).filter(id=>id==='scholay-platform'||id.startsWith('site:scholay-today')).length,1);
 for(const brand of [...today,...siteBrandMounts('metho')])assert.match(brand.endnotes[0].text,/\[.+\]\(https?:\/\//);
});

test('finalize mounts brand endnotes, fills alt, demotes extra structured headings and drops empty image slots',()=>{
 const seeds=brandSeeds();
 const [intro,value]=recordHeadings('openSource');
 const n={
  version:2,kind:'openSource',title:'工具介绍',skills:['opensource'],fields:{date:'2026-10-17',category:'文献与写作',url:'https://example.org'},
  sources:[],groups:[],mounts:{templates:[],brands:[]},assets:{},
  blocks:[
   note('h0',intro,{type:'heading',level:2,locked:true}),
   note('p0','这是一段足够长的导语，用来生成摘要，说明这个开源工具解决什么问题。'),
   {id:'img',type:'image',state:'placeholder',text:'',requirement:'示意图',sourceIds:[]},
   {id:'cap',type:'annotation',role:'caption',targetId:'img',state:'placeholder',text:'',sourceIds:[]},
   note('h1',value,{type:'heading',level:2,locked:true}),
   note('p1','核对过的官方仓库与许可证。'),
   {id:'href',type:'heading',level:2,state:'placeholder',text:'',requirement:'参考文献',sourceIds:[]},
   {id:'ready-img',type:'image',state:'ready',text:'assets/notebook/'+'ab'.repeat(32)+'.webp',sourceIds:[],requirement:'仓库截图'},
   {id:'ready-cap',type:'annotation',role:'caption',targetId:'ready-img',state:'ready',text:'官方文档首页截图，展示安装说明。',sourceIds:[]},
  ],
 };
 const {notebook,images,added}=finalizeNotebook(n,{siteId:'metho',brands:seeds});
 assert.equal(notebook.blocks.some(b=>b.id==='img'),false);
 assert.equal(notebook.blocks.find(b=>b.id==='href').level,3);
 assert.equal(notebook.blocks.find(b=>b.id==='href').state,'ready');
 assert.equal(images.length,1);
 assert.match(images[0].alt,/官方文档首页/);
 assert.equal(added,3);
 assert.deepEqual(notebook.mounts.brands.map(b=>b.id),siteBrandIds('metho'));
 const text=notebookMarkdown(notebook);
 assert.equal((text.match(/^## /gm)||[]).length,2);
 assert.match(text,/### 参考文献/);
 assert.doesNotMatch(text,/### 品牌与发布说明/);
 assert.match(text,/\[研究方法\]\(https:\/\/metho\.scholay\.com\)/);
 assert.match(text,/Scholay 学术一站式平台/);
 assert.match(text,/恩特学术/);
});

test('publication metadata comes from the lede and record fields when export does not supply them',()=>{
 const n={version:2,kind:'article',title:'观察',sectionId:'observations',fields:{},blocks:[note('lede','这是一段超过三十个字的导语，用来充当可以单独发表的摘要，并说明事件本身。'),note('body','后文。')],sources:[],skills:[],mounts:{templates:[],brands:[]}};
 const meta=publicationMetadataFromNotebook(n,DEFAULT_SITE,{});
 assert.equal(meta.sectionId,'observations');
 assert.equal(meta.category,'学者观察');
 assert.match(meta.summary,/导语/);
 assert.match(meta.date,/^\d{4}-\d{2}-\d{2}$/);
 assert.ok(clipPlain('![图](a.webp) 正文。',10).includes('正文')||clipPlain('![图](a.webp) 正文。',10)==='正文。');
 assert.match(IMAGE_PRIORITY,/网络原图/);
});

async function workspace(t){
 const root=await mkdtemp(join(tmpdir(),'today-headless-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_ops/inventory'),{recursive:true});
 await mkdir(join(root,'articles'));
 await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:['新闻聚合']}));
 return root;
}

test('annex folders include a date and article-id fragment instead of a local 01 counter',async t=>{
 const root=await workspace(t);
 const a=await createDraft({id:'draft-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'第一篇',markdown:'# 第一篇\n\n正文。'},root);
 const b=await createDraft({id:'draft-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'第二篇',markdown:'# 第二篇\n\n正文。'},root);
 assert.match(a.canonicalPath,/articles\/annex\/新闻聚合\/\d{8}-aaaaaaaa_第一篇\/正文\.md$/);
 assert.match(b.canonicalPath,/articles\/annex\/新闻聚合\/\d{8}-bbbbbbbb_第二篇\/正文\.md$/);
 assert.notEqual(a.canonicalPath,b.canonicalPath);
 assert.equal(annexFolderStamp('draft-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','第一篇','20261017'),'20261017-aaaaaaaa_第一篇');
});

test('export writes summary/date metadata, image-rights records and filled alt text',async t=>{
 const root=await workspace(t);
 const store=new TaskStore(root);
 let task=await openNotebook(store,(await store.create({mode:'observation'})).id);
 const png=(await sharp({create:{width:24,height:16,channels:3,background:'#445566'}}).png().toBuffer()).toString('base64');
 task=await store.update(task.id,{notebook:{...task.notebook,title:'带图观察',sectionId:'observations',blocks:[
  {id:'lede',type:'paragraph',state:'ready',text:'这是一段足够长的导语，用来生成网站摘要，并说明这一事件的要点。',sourceIds:[]},
  {id:'photo',type:'image',state:'placeholder',text:'',requirement:'实验装置示意图',sourceIds:[]},
  {id:'caption',type:'annotation',role:'caption',targetId:'photo',state:'ready',text:'实验室光学台，镜头朝向样品室。',sourceIds:[]},
 ]}},task.revision);
 const applied=await applyNotebookImage(store,task.id,{blockId:'photo',data:png,generated:true,expectedRevision:task.revision});
 assert.match(applied.notebook.blocks.find(b=>b.id==='photo').alt,/实验室光学台/);
 const done=await exportNotebook(store,task.id,applied.revision);
 const meta=JSON.parse(await readFile(join(publicationDirectory(root),task.articleId,'metadata.json'),'utf8'));
 assert.match(meta.summary,/导语/);
 assert.match(meta.date,/^\d{4}-\d{2}-\d{2}$/);
 assert.equal(meta.sectionId,'observations');
 const rights=join(root,'_ops/inventory/image-rights',task.articleId);
 const files=await readdir(rights);
 assert.equal(files.length,1);
 const record=JSON.parse(await readFile(join(rights,files[0]),'utf8'));
 assert.equal(record.origin,'generated');
 assert.match(record.alt,/实验室光学台/);
 assert.ok(done.completedAt);
});

test('spaces init writes 0600 tokens outside the repo and never echoes credentials',async t=>{
 const data=await mkdtemp(join(tmpdir(),'today-auth-'));
 t.after(()=>rm(data,{recursive:true,force:true}));
 const credential={id:'11111111-1111-4111-8111-111111111111',scope:'editorial_publish',token:'A'.repeat(48)};
 const pets=JSON.parse(await readFile(new URL('../sites/profiles.json',import.meta.url),'utf8')).find(s=>s.id==='pets');
 const petsAuth={format:'scholay-site-authorization',version:1,issuedAt:'2026-10-17T00:00:00.000Z',site:pets,credential};
 process.env.SCHOLAY_AUTH_DIR=join(data,'auth');
 process.env.SCHOLAY_SPACES_ROOT=join(data,'spaces');
 await mkdir(join(process.env.SCHOLAY_AUTH_DIR,'pets'),{recursive:true});
 await writeFile(join(process.env.SCHOLAY_AUTH_DIR,'pets','pets.scholay-site.json'),JSON.stringify(petsAuth));
 const logs=[];const orig=console.log;console.log=(...a)=>logs.push(a.join(' '));
 try{const out=initSpaces(['pets']);assert.equal(out[0].siteId,'pets');}
 finally{console.log=orig;delete process.env.SCHOLAY_AUTH_DIR;delete process.env.SCHOLAY_SPACES_ROOT;delete process.env.SCHOLAY_AUTH_FILE;}
 const tokenFile=join(data,'auth','pets','publish-token');
 const {statSync}=await import('node:fs');
 if(process.platform!=='win32')assert.equal(statSync(tokenFile).mode&0o077,0);
 assert.equal((await readFile(tokenFile,'utf8')).trim(),credential.token);
 assert.ok(logs.every(line=>!line.includes(credential.token)));
 assert.equal(canonicalSiteId('today'),'scholay-today');
 assert.throws(()=>canonicalSiteId('nope'),/unknown site/);
});
