import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publicationImage} from '../scripts/publication-images.mjs';

test('publication derivatives preserve originals, add a footer, resize and reuse exact WebP bytes',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'scholay-media-'));t.after(()=>rm(cache,{recursive:true,force:true}));
  const input=await sharp({create:{width:2400,height:1200,channels:3,background:'#abcdef'}}).png().toBuffer(),original=Buffer.from(input);
  const first=await publicationImage(input,cache),again=await publicationImage(input,cache),meta=await sharp(first).metadata();
  assert.deepEqual(input,original);assert.deepEqual(again,first);assert.equal(meta.format,'webp');assert.equal(meta.width,1600);assert(meta.height>800&&meta.height<850);assert.equal(meta.exif,undefined);
  const {data}=await sharp(first).extract({left:1300,top:805,width:300,height:30}).raw().toBuffer({resolveWithObject:true});
  assert(data.some(x=>x>220),'footer includes visible light watermark glyphs');
  await assert.rejects(publicationImage(Buffer.from('<svg/>'),cache),/仅支持|unsupported|corrupt/i);
});

async function noise(width,height){
  const data=Buffer.alloc(width*height*3);let x=12345;
  for(let i=0;i<data.length;i++){x=(x*1103515245+12345)>>>0;data[i]=x>>>24;}
  return sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();
}

test('publication derivatives step quality and then width down until they fit the size limit',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'scholay-media-'));t.after(()=>rm(cache,{recursive:true,force:true}));
  const input=await noise(1700,360);
  const unlimited=await publicationImage(input,cache,{maxBytes:Infinity}),full=await sharp(unlimited).metadata();
  assert.equal(full.width,1600);
  // Below the preferred-settings size: quality must drop, first at full width.
  const qualityLimit=Math.floor(unlimited.length*0.8);
  const byQuality=await publicationImage(input,cache,{maxBytes:qualityLimit});
  assert(byQuality.length<=qualityLimit);assert.equal((await sharp(byQuality).metadata()).width,1600);
  // Too small for any quality at 1600px: width steps down as well.
  const widthLimit=Math.floor(unlimited.length*0.25);
  const byWidth=await publicationImage(input,cache,{maxBytes:widthLimit});
  assert(byWidth.length<=widthLimit);assert((await sharp(byWidth).metadata()).width<1600);
  await assert.rejects(publicationImage(input,cache,{maxBytes:1000}),/仍超过/);
});

test('oversized cached derivatives from older builds are regenerated within the limit',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'scholay-media-'));t.after(()=>rm(cache,{recursive:true,force:true}));
  const input=await noise(1700,300),limit=60*1024;
  const big=await publicationImage(input,cache,{maxBytes:limit});
  const {readdir,writeFile}=await import('node:fs/promises');
  const [name]=(await readdir(cache)).filter(x=>x.endsWith('.webp'));
  await writeFile(join(cache,name),Buffer.alloc(limit+1));
  const again=await publicationImage(input,cache,{maxBytes:limit});
  assert(again.length<=limit);assert.deepEqual(again,big);
});

test('repeated original widths do not stop later compression steps',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'scholay-media-'));t.after(()=>rm(cache,{recursive:true,force:true}));
  const input=await noise(1300,360),preferred=await publicationImage(input,cache,{maxBytes:Infinity});
  const limit=Math.floor(preferred.length*0.4),compressed=await publicationImage(input,cache,{maxBytes:limit});
  assert(compressed.length<=limit);assert((await sharp(compressed).metadata()).width<1300);
});
