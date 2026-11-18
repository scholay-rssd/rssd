import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {outputManifest} from '../contracts/output-package.mjs';
import {prepareCardRendition} from '../scripts/prepare-card-rendition.mjs';
import {uploadCardRendition} from '../scripts/upload-card-rendition.mjs';

test('prepare and retry a complete card set with deduplicated WebP and cover',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-cards-'));
 try{
  const png=await sharp({create:{width:1080,height:1440,channels:3,background:'#eeccaa'}}).png().toBuffer();
  const files=['01.png','02.png'].map(path=>({path,role:'page',type:'image/png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')}));
  const manifest=outputManifest({format:'cards',destination:null,source:{id:'article',locale:'en',sectionId:'section'},site:{id:'space',name:'Space'},style:'ai-image',sourceHash:'a'.repeat(64),engine:{name:'test',version:'1'},createdAt:new Date().toISOString(),fields:{title:'Title'},files});
  const args={manifest,workspaceId:'space',directory:dir,readPage:async()=>png};
  const first=await prepareCardRendition(args);
  assert.equal((await prepareCardRendition(args)).file,first.file);
  const rendition=JSON.parse(await readFile(first.file));
  assert.equal(rendition.pages.length,2);
  assert.equal(rendition.pages[0].mediaId,rendition.pages[1].mediaId);
  assert.equal((await readdir(join(dir,'article-media'))).length,2);
  const remote=new Map();let commits=0,uploads=0,fail=true;
  const client={async request(path,options){
   if(path==='/media'){uploads++;const body=options.body;const asset=rendition.pages.find(p=>p.sha256===body.sha256)||rendition.cover;remote.set(asset.mediaId,{workspaceId:'space',manifest:body});return {};}
   if(path.startsWith('/media/')){const got=remote.get(path.slice(7));if(got)return got;throw Object.assign(Error('missing'),{status:404})}
   commits++;if(fail){fail=false;throw Error('interrupted')}
   assert.equal(options.body.locale,'en');assert.equal(options.body.pages.length,2);return {id:'cards-test'};
  }};
  const binding={workId:'work',revision:1,sourceHash:'b'.repeat(64),exportHash:manifest.source.hash};
  await assert.rejects(uploadCardRendition({client,rendition,directory:dir,binding}),/interrupted/);
  assert.deepEqual(await uploadCardRendition({client,rendition,directory:dir,binding}),{id:'cards-test'});
  assert.equal(uploads,2);assert.equal(commits,2);
  await assert.rejects(prepareCardRendition({...args,readPage:async()=>Buffer.from('corrupt')}),/checksum/);
  await assert.rejects(uploadCardRendition({client,rendition,directory:dir,binding:{...binding,exportHash:'c'.repeat(64)}}),/binding/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
