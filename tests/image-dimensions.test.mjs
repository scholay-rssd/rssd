import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {readImageSize} from '../web/engine/image-size.mjs';
import {imageSizeMap} from '../web/engine/publication-assets.mjs';
import {renderArticle,renderArticleParts} from '../scripts/article-format.mjs';
import {articleBodyOnPage} from '../scripts/website-article-readback.mjs';

const picture=async (width,height,format)=>sharp({create:{width,height,channels:3,background:'#336699'}})[format]().toBuffer();

test('static image headers report intrinsic size',async ()=>{
  assert.deepEqual(readImageSize(await picture(320,180,'png')),{width:320,height:180});
  assert.deepEqual(readImageSize(await picture(640,480,'jpeg')),{width:640,height:480});
  assert.deepEqual(readImageSize(await picture(800,200,'webp')),{width:800,height:200});
  assert.equal(readImageSize(Buffer.from('not an image')),null);
});

test('published article images reserve their space and keep later pictures lazy',async ()=>{
  const bytes=await picture(120,80,'png');
  const path='/article-media/'+createHash('sha256').update(bytes).digest('hex')+'.png';
  const imageSizes=await imageSizeMap([{path,data:bytes.toString('base64')}]);
  const markdown='![一]('+path+')\n\n![二](https://example.org/remote.png)\n\n![三]('+path+')';
  const html=renderArticle(markdown,{imageSizes});
  const images=[...html.matchAll(/<img\b[^>]*>/g)].map(match=>match[0]);
  assert.equal(images.length,3);
  assert.match(images[0],/width="120"/);assert.match(images[0],/height="80"/);
  assert.match(images[0],/fetchpriority="high"/);assert.doesNotMatch(images[0],/loading=/);
  assert.match(images[1],/loading="lazy"/);assert.doesNotMatch(images[1],/width=/);assert.doesNotMatch(images[1],/fetchpriority=/);
  assert.match(images[2],/width="120"/);assert.match(images[2],/loading="lazy"/);assert.doesNotMatch(images[2],/fetchpriority=/);
  const parts=renderArticleParts('![一]('+path+')\n\n## 参考文献\n\n1. 说明 ![二]('+path+')',{imageSizes});
  assert.match(parts.body,/fetchpriority="high"/);assert.doesNotMatch(parts.body,/loading=/);
  assert.match(parts.endnotes,/loading="lazy"/);assert.doesNotMatch(parts.endnotes,/fetchpriority=/);
  const page='<div class="article-body">'+html+'</div>';
  assert.equal(articleBodyOnPage(page,markdown),true);
  assert.equal(articleBodyOnPage(page.replace(/\s(?:width|height|loading|decoding|fetchpriority)="[^"]*"/g,''),markdown),true);
});
