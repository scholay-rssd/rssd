const encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const header=size=>{const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};};
export async function makeZip(entries){
 if(!entries.length||entries.length>65535)throw Error('Invalid ZIP entry count');
 const parts=[],central=[];let offset=0,centralSize=0;
 for(const entry of entries){
  if(!/^[a-zA-Z0-9_.-]+$/.test(entry.name))throw Error('Invalid ZIP entry name');
  const name=encoder.encode(entry.name),bytes=new Uint8Array(await entry.blob.arrayBuffer()),size=bytes.length,crc=crc32(bytes);
  if(offset+size>0xffffffff)throw Error('This export exceeds the ZIP size limit');
  const local=header(30);local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint16(6,0x800,true);local.view.setUint32(14,crc,true);local.view.setUint32(18,size,true);local.view.setUint32(22,size,true);local.view.setUint16(26,name.length,true);
  local.view.setUint16(12,33,true);parts.push(local.bytes,name,entry.blob);
  const record=header(46);record.view.setUint32(0,0x02014b50,true);record.view.setUint16(4,20,true);record.view.setUint16(6,20,true);record.view.setUint16(8,0x800,true);record.view.setUint16(14,33,true);record.view.setUint32(16,crc,true);record.view.setUint32(20,size,true);record.view.setUint32(24,size,true);record.view.setUint16(28,name.length,true);record.view.setUint32(42,offset,true);central.push(record.bytes,name);centralSize+=46+name.length;offset+=30+name.length+size;
 }
 const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,entries.length,true);end.view.setUint16(10,entries.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
 return new Blob([...parts,...central,end.bytes],{type:'application/zip'});
}
