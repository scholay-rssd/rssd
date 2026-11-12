import test from 'node:test';
import assert from 'node:assert/strict';
import {platformProductionInstructions,platformGuide} from '../contracts/rssd-platform-content.cjs';

const claim=destinations=>({payload:{destinations}});

test('no social destinations add no platform instructions',()=>{
 assert.equal(platformProductionInstructions(claim([])),'');
 assert.equal(platformProductionInstructions(claim([{destinationId:'site-a',kind:'site'}])),'');
});

test('article platforms get their body format and required settings',()=>{
 assert.match(platformGuide('medium'),/纯 Markdown/);
 assert.match(platformGuide('medium'),/title.*subtitle/);
 assert.match(platformGuide('devto'),/纯 Markdown/);
 assert.match(platformGuide('devto'),/数字标签 ID，不知道时写 \[\]/);
 assert.match(platformGuide('hashnode'),/至少 6 字/);
 assert.match(platformGuide('hashnode'),/publication/);
 assert.match(platformGuide('hashnode'),/不要编造/);
 assert.match(platformGuide('wordpress'),/text 用 HTML，不用 Markdown/);
 assert.match(platformGuide('wordpress'),/type（通常为 "post"）/);
 for(const platform of ['medium','devto','hashnode','wordpress'])assert.match(platformGuide(platform),/main_image.*不要填写/);
});

test('short-form platforms stay plain text without article settings',()=>{
 for(const platform of ['linkedin','x','telegram','',undefined]){
  assert.match(platformGuide(platform),/纯文本/);
  assert.doesNotMatch(platformGuide(platform),/settings 必填/);
 }
 assert.match(platformGuide('discord'),/纯 Markdown/);
 assert.doesNotMatch(platformGuide('discord'),/settings 必填/);
});

test('instructions keep protocol v1 and list each platform once with its destinations',()=>{
 const text=platformProductionInstructions(claim([
  {destinationId:'wp-en',kind:'postiz',platform:'wordpress',locale:'en'},
  {destinationId:'medium-en',kind:'postiz',platform:'medium',locale:'en'},
  {destinationId:'wp-2',kind:'postiz',platform:'wordpress',locale:'en'},
  {destinationId:'old',kind:'postiz',locale:'en'},
  {destinationId:'site-a',kind:'site'},
 ]));
 assert.match(text,/平台成品协议 v1/);
 assert.match(text,/metadata\.platformContent/);
 assert.match(text,/- wordpress（wp-en、wp-2）：text 用 HTML/);
 assert.match(text,/- medium（medium-en）：text 用纯 Markdown/);
 assert.match(text,/- 未知平台（old）：text 用纯文本/);
 assert.equal(text.match(/^- wordpress/gm).length,1);
 assert.doesNotMatch(text,/site-a/);
});
