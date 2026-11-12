import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {attachDisplayImages,displayName,DISPLAY_WIDTH} from '../web/engine/display-images.mjs';
import {digest} from '../admin/model.mjs';
import {byteHash} from '../web/engine/theme-homepage.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function noisy(width,height){
  const raw=Buffer.alloc(width*height*3);for(let i=0;i<raw.length;i++)raw[i]=(i*2654435761>>>13)&255;
  return sharp(raw,{raw:{width,height,channels:3}}).png({compressionLevel:0}).toBuffer();
}

test('oversized images get a display copy; originals, links and feeds keep the original',async t=>{
  const root=await mkdtemp(join(tmpdir(),'display-images-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const target=join(root,'release');await mkdir(join(target,'article-media'),{recursive:true});
  const big=await noisy(2400,1200),small=await sharp({create:{width:300,height:200,channels:3,background:'#fff'}}).png().toBuffer();
  const bigName=sha(big)+'.png',smallName=sha(small)+'.png';
  await writeFile(join(target,'article-media',bigName),big);await writeFile(join(target,'article-media',smallName),small);
  const html=`<img src="/article-media/${bigName}" alt=""><a href="/article-media/${bigName}">原图</a><img src="https://example.org/article-media/${bigName}"><img alt="s" src="/article-media/${smallName}">`;
  await writeFile(join(target,'index.html'),html);await writeFile(join(target,'feed.xml'),`<img src="/article-media/${bigName}">`);
  const manifest={hashes:{'index.html':digest(html),'feed.xml':'x',['article-media/'+bigName]:digest(big)},byteHashes:{['article-media/'+bigName]:byteHash(big)}};

  await attachDisplayImages({target,manifest});
  const copy=displayName(sha(big)),page=await readFile(join(target,'index.html'),'utf8'),derived=await readFile(join(target,'article-media',copy));
  assert.equal((await sharp(derived).metadata()).width,DISPLAY_WIDTH);
  assert.equal((await sharp(derived).metadata()).format,'webp');
  assert.ok(derived.length<big.length*0.8);
  assert.deepEqual(await readFile(join(target,'article-media',bigName)),big,'registered original is unchanged');
  assert.match(page,new RegExp(`<img src="/article-media/${copy}"`));
  assert.match(page,new RegExp(`<img src="https://example.org/article-media/${copy}"`));
  assert.match(page,new RegExp(`href="/article-media/${bigName}"`),'links keep the original');
  assert.match(page,new RegExp(`src="/article-media/${smallName}"`),'small images are left alone');
  assert.match(await readFile(join(target,'feed.xml'),'utf8'),new RegExp(bigName),'feeds keep the original');
  assert.equal(manifest.hashes['index.html'],digest(page));
  assert.equal(manifest.byteHashes['article-media/'+copy],byteHash(derived));

  // A later build reuses the previous release's copy instead of encoding again.
  const next=join(root,'next');await mkdir(join(next,'article-media'),{recursive:true});
  await writeFile(join(next,'article-media',bigName),big);await writeFile(join(next,'index.html'),html);
  const encoder=()=>{throw Error('must not encode again');};
  await attachDisplayImages({target:next,manifest:{hashes:{'index.html':digest(html)},byteHashes:{}},previousRoot:target,encoder});
  assert.deepEqual(await readFile(join(next,'article-media',copy)),derived);
});
