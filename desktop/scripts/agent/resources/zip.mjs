import {inflateRawSync,deflateRawSync} from 'node:zlib';
import {crc32} from 'node:zlib';

function u16(buf,off){return buf.readUInt16LE(off);}
function u32(buf,off){return buf.readUInt32LE(off);}
function put16(n){const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;}
function put32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;}

export function unzip(buffer){
 const data=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
 const eocd=data.lastIndexOf(Buffer.from('PK\x05\x06'));
 if(eocd<0||eocd+22>data.length)throw Error('不是有效的 ZIP 文件');
 const count=u16(data,eocd+10),central=u32(data,eocd+16);
 const files=new Map();
 let offset=central;
 for(let i=0;i<count;i++){
  if(u32(data,offset)!==0x02014b50)throw Error('ZIP 目录损坏');
  const method=u16(data,offset+10),comp=u32(data,offset+20),raw=u32(data,offset+24);
  const nameLen=u16(data,offset+28),extra=u16(data,offset+30),comment=u16(data,offset+32);
  const local=u32(data,offset+42),name=data.subarray(offset+46,offset+46+nameLen).toString('utf8');
  offset+=46+nameLen+extra+comment;
  if(name.endsWith('/'))continue;
  const localName=u16(data,local+26),localExtra=u16(data,local+28);
  const start=local+30+localName+localExtra,payload=data.subarray(start,start+comp);
  let body;
  if(method===0)body=payload;
  else if(method===8)body=inflateRawSync(payload);
  else throw Error('不支持的 ZIP 压缩方式');
  if(body.length!==raw&&raw!==0xffffffff)throw Error('ZIP 文件大小不匹配：'+name);
  files.set(name.replace(/\\/g,'/'),body);
 }
 return files;
}

export function zip(entries,storeOnly=false){
 const locals=[],centrals=[];
 let offset=0;
 for(const [name,content] of entries){
  const body=Buffer.isBuffer(content)?content:Buffer.from(content);
  const nameBuf=Buffer.from(name,'utf8');
  const compressed=storeOnly?body:deflateRawSync(body);
  const method=storeOnly?0:8;
  const crc=crc32(body)>>>0;
  const local=Buffer.concat([
   Buffer.from('PK\x03\x04'),put16(20),put16(0),put16(method),put16(0),put16(0),
   put32(crc),put32(compressed.length),put32(body.length),put16(nameBuf.length),put16(0),
   nameBuf,compressed,
  ]);
  const central=Buffer.concat([
   Buffer.from('PK\x01\x02'),put16(20),put16(20),put16(0),put16(method),put16(0),put16(0),
   put32(crc),put32(compressed.length),put32(body.length),put16(nameBuf.length),put16(0),put16(0),
   put16(0),put16(0),put32(0),put32(offset),nameBuf,
  ]);
  locals.push(local);centrals.push(central);offset+=local.length;
 }
 const central=Buffer.concat(centrals);
 const eocd=Buffer.concat([
  Buffer.from('PK\x05\x06'),put16(0),put16(0),put16(locals.length),put16(locals.length),
  put32(central.length),put32(offset),put16(0),
 ]);
 return Buffer.concat([...locals,central,eocd]);
}
