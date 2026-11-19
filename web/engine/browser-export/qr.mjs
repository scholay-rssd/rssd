// A small QR Code encoder for the share poster: byte mode, error correction level M, versions 1 to 10
// (up to 213 bytes, enough for a page address). It follows ISO/IEC 18004: Reed–Solomon codewords over
// GF(256), interleaved blocks, function patterns, and the mask with the lowest penalty. No dependencies.

const ECC_PER_BLOCK=[0,10,16,26,18,24,16,18,22,22,26];
const BLOCKS=[0,1,1,1,2,2,4,4,4,5,5];
const MAX_VERSION=10;

const rawModules=v=>{let n=(16*v+128)*v+64;if(v>=2){const a=Math.floor(v/7)+2;n-=(25*a-10)*a-55;if(v>=7)n-=36;}return n;};
const dataCodewords=v=>Math.floor(rawModules(v)/8)-ECC_PER_BLOCK[v]*BLOCKS[v];

function multiply(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x;}return z;}
function divisor(degree){
 const result=new Array(degree).fill(0);result[degree-1]=1;let root=1;
 for(let i=0;i<degree;i++){for(let j=0;j<degree;j++){result[j]=multiply(result[j],root);if(j+1<degree)result[j]^=result[j+1];}root=multiply(root,2);}
 return result;
}
function remainder(data,div){
 const result=div.map(()=>0);
 for(const b of data){const factor=b^result.shift();result.push(0);div.forEach((c,i)=>{result[i]^=multiply(c,factor);});}
 return result;
}
function alignment(v){
 if(v===1)return [];
 const count=Math.floor(v/7)+2,step=Math.ceil((v*4+4)/(count*2-2))*2,result=[6];
 for(let pos=v*4+17-7;result.length<count;pos-=step)result.splice(1,0,pos);
 return result;
}

/** Encode text (UTF-8) and return {size, dark(x,y)}; throws when it does not fit version 10. */
export function encodeQr(text){
 const bytes=[...new TextEncoder().encode(text)];
 let version=1;
 for(;version<=MAX_VERSION;version++)if(4+(version<10?8:16)+bytes.length*8<=dataCodewords(version)*8)break;
 if(version>MAX_VERSION)throw Error('Address too long for a QR code');
 // Data bits: byte mode, length, the bytes, terminator, padding.
 const bits=[];const put=(value,length)=>{for(let i=length-1;i>=0;i--)bits.push((value>>>i)&1);};
 put(4,4);put(bytes.length,version<10?8:16);bytes.forEach(b=>put(b,8));
 const capacity=dataCodewords(version)*8;
 put(0,Math.min(4,capacity-bits.length));put(0,(8-bits.length%8)%8);
 for(let pad=0xec;bits.length<capacity;pad^=0xec^0x11)put(pad,8);
 const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>a<<1|b,0));
 // Split into blocks, add error correction, interleave.
 const blocks=BLOCKS[version],eccLength=ECC_PER_BLOCK[version],raw=Math.floor(rawModules(version)/8);
 const shortBlocks=blocks-raw%blocks,shortLength=Math.floor(raw/blocks),div=divisor(eccLength),parts=[];
 for(let i=0,k=0;i<blocks;i++){
  const length=shortLength-eccLength+(i<shortBlocks?0:1),block=data.slice(k,k+length);k+=length;
  parts.push({data:block,ecc:remainder(block,div)});
 }
 const codewords=[];
 for(let i=0;i<shortLength-eccLength+1;i++)for(const p of parts)if(i<p.data.length)codewords.push(p.data[i]);
 for(let i=0;i<eccLength;i++)for(const p of parts)codewords.push(p.ecc[i]);
 // Function patterns.
 const size=version*4+17,modules=Array.from({length:size},()=>new Array(size).fill(false)),fixed=Array.from({length:size},()=>new Array(size).fill(false));
 const set=(x,y,dark)=>{modules[y][x]=dark;fixed[y][x]=true;};
 for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
 for(const [cx,cy] of [[3,3],[size-4,3],[3,size-4]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
  const d=Math.max(Math.abs(dx),Math.abs(dy)),x=cx+dx,y=cy+dy;
  if(x>=0&&x<size&&y>=0&&y<size)set(x,y,d!==2&&d!==4);
 }
 const align=alignment(version);
 align.forEach((a,i)=>align.forEach((b,j)=>{
  if(i===0&&j===0||i===0&&j===align.length-1||i===align.length-1&&j===0)return;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(a+dx,b+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
 }));
 const format=mask=>{
  const value=(0<<3)|mask;let rem=value;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);
  const f=((value<<10)|rem)^0x5412,bit=i=>((f>>>i)&1)!==0;
  for(let i=0;i<=5;i++)set(8,i,bit(i));
  set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));
  for(let i=9;i<15;i++)set(14-i,8,bit(i));
  for(let i=0;i<8;i++)set(size-1-i,8,bit(i));
  for(let i=8;i<15;i++)set(8,size-15+i,bit(i));
  set(8,size-8,true);
 };
 format(0);
 if(version>=7){
  let rem=version;for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>>11)*0x1f25);
  const v=(version<<12)|rem;
  for(let i=0;i<18;i++){const dark=((v>>>i)&1)!==0,a=size-11+i%3,b=Math.floor(i/3);set(a,b,dark);set(b,a,dark);}
 }
 // Codewords in the zigzag order, upwards and downwards in two-module columns.
 let index=0;
 for(let right=size-1;right>=1;right-=2){
  if(right===6)right=5;
  for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){
   const x=right-j,upward=((right+1)&2)===0,y=upward?size-1-vert:vert;
   if(!fixed[y][x]&&index<codewords.length*8){modules[y][x]=((codewords[index>>>3]>>>(7-(index&7)))&1)!==0;index++;}
  }
 }
 const masks=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,x=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
 const apply=mask=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!fixed[y][x]&&masks[mask](x,y))modules[y][x]=!modules[y][x];};
 let best=0,lowest=Infinity;
 for(let mask=0;mask<8;mask++){apply(mask);format(mask);const score=penalty(modules);if(score<lowest){lowest=score;best=mask;}apply(mask);}
 apply(best);format(best);
 return {size,version,dark:(x,y)=>modules[y][x]};
}

function penalty(m){
 const size=m.length;let score=0;
 const line=get=>{
  let run=1;const history=[];let count=0,color=get(0);
  for(let i=1;i<=size;i++){
   const c=i<size?get(i):null;
   if(c===color){run++;continue;}
   if(run>=5)score+=run-2;
   history.push(run);run=1;color=c;
  }
  // Finder-like 1:1:3:1:1 runs with four light modules on a side.
  for(let i=0;i+4<history.length;i++){
   const [a,b,c,d,e]=history.slice(i,i+5),n=b;
   if(n>0&&a===n&&c===n*3&&d===n&&e===n){
    const before=history[i-1]??4,after=history[i+5]??4;
    if(before>=n*4||after>=n*4)count++;
   }
  }
  score+=count*40;
 };
 for(let y=0;y<size;y++)line(x=>m[y][x]);
 for(let x=0;x<size;x++)line(y=>m[y][x]);
 for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){const c=m[y][x];if(c===m[y][x+1]&&c===m[y+1][x]&&c===m[y+1][x+1])score+=3;}
 let dark=0;for(const row of m)for(const c of row)if(c)dark++;
 const total=size*size;score+=Math.max(0,Math.ceil(Math.abs(dark*20-total*10)/total)-1)*10;
 return score;
}
