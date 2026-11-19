import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeQr} from '../web/engine/browser-export/qr.mjs';

// Format information: 15 bits, BCH(15,5) with generator 0x537, masked with 0x5412, read from both copies.
const formatBits=(q,first)=>{
 const s=q.size,bits=[];
 if(first){for(let i=0;i<=5;i++)bits.push(q.dark(8,i));bits.push(q.dark(8,7),q.dark(8,8),q.dark(7,8));for(let i=9;i<15;i++)bits.push(q.dark(14-i,8));}
 else{for(let i=0;i<8;i++)bits.push(q.dark(s-1-i,8));for(let i=8;i<15;i++)bits.push(q.dark(8,s-15+i));}
 return bits.reduce((v,b,i)=>v|(b?1<<i:0),0);
};
const bchValid=value=>{let v=value^0x5412;for(let i=14;i>=10;i--)if(v>>>i&1)v^=0x537<<(i-10);return v===0;};

test('QR codes for page addresses carry valid finder, timing, format and version patterns, at level M',()=>{
 for(const [text,version] of [['https://x.test/',2],['https://legis.wiki/news/a-long-article-about-something/',4],['https://example.org/'+'a'.repeat(140),9],['https://example.org/'+'中'.repeat(60),10]]){
  const q=encodeQr(text);assert.equal(q.version,version,text);assert.equal(q.size,version*4+17);
  for(const [x,y] of [[0,0],[q.size-7,0],[0,q.size-7]])for(let i=0;i<7;i++)for(let j=0;j<7;j++){
   const ring=Math.max(Math.abs(i-3),Math.abs(j-3));assert.equal(q.dark(x+i,y+j),ring!==2,`finder at ${x},${y}`);
  }
  for(let i=8;i<q.size-8;i++){assert.equal(q.dark(i,6),i%2===0);assert.equal(q.dark(6,i),i%2===0);}
  assert.equal(q.dark(8,q.size-8),true);
  const format=formatBits(q,true);assert.equal(format,formatBits(q,false));assert.ok(bchValid(format));
  assert.equal(((format^0x5412)>>>13)&3,0,'level M');
  if(version>=7){let v=0;for(let i=0;i<18;i++)if(q.dark(q.size-11+i%3,Math.floor(i/3)))v|=1<<i;assert.equal(v>>>12,version);}
 }
 assert.throws(()=>encodeQr('x'.repeat(214)),/too long/);
});
