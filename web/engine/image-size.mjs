// Width and height from a static PNG, JPEG, or WebP header. No decoder:
// the publisher only needs the intrinsic size so the page can reserve space.
export function readImageSize(bytes){
  const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes||[]);
  return png(buffer)||jpeg(buffer)||webp(buffer);
}
function box(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>100000||height>100000)return null;
  return {width,height};
}
function png(buffer){
  if(buffer.length<24||buffer[0]!==0x89||buffer.toString('ascii',1,4)!=='PNG')return null;
  if(buffer.toString('ascii',12,16)!=='IHDR')return null;
  return box(buffer.readUInt32BE(16),buffer.readUInt32BE(20));
}
function jpeg(buffer){
  if(buffer.length<4||buffer[0]!==0xff||buffer[1]!==0xd8)return null;
  let offset=2;
  while(offset+8<buffer.length){
    if(buffer[offset]!==0xff)return null;
    const marker=buffer[offset+1];
    if(marker===0xd9||marker===0xda)return null;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7)){offset+=2;continue;}
    const length=buffer.readUInt16BE(offset+2);
    if(length<2||offset+2+length>buffer.length)return null;
    if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return box(buffer.readUInt16BE(offset+7),buffer.readUInt16BE(offset+5));
    offset+=2+length;
  }
  return null;
}
function webp(buffer){
  if(buffer.length<30||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP')return null;
  let offset=12;
  while(offset+8<=buffer.length){
    const type=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),data=offset+8;
    if(type==='VP8X'&&size>=10&&data+10<=buffer.length)return box(1+buffer.readUIntLE(data+4,3),1+buffer.readUIntLE(data+7,3));
    if(type==='VP8 '&&data+10<=buffer.length&&buffer[data+3]===0x9d&&buffer[data+4]===0x01&&buffer[data+5]===0x2a)return box(buffer.readUInt16LE(data+6)&0x3fff,buffer.readUInt16LE(data+8)&0x3fff);
    if(type==='VP8L'&&data+5<=buffer.length&&buffer[data]===0x2f){
      const bits=buffer.readUInt32LE(data+1);
      return box((bits&0x3fff)+1,((bits>>14)&0x3fff)+1);
    }
    offset=data+size+(size&1);
  }
  return null;
}
