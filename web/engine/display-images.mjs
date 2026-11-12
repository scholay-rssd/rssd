// Display copies for oversized published images.
//
// Registered originals stay byte-for-byte as published: their hashes bind
// Center gallery registration, visual review, exports and feeds. Pages instead
// show a resized WebP written beside the original, named by the original's hash
// and the encoding settings, so a copy in the previous release can be reused.
//
// The same pass corrects <img> width/height attributes whose proportions do
// not match the picture (templates often state a fixed 640x400 or 720x450).
// The stated width is kept and only the height follows the real proportions,
// so displayed sizes do not change but the browser reserves the right shape
// and layouts that follow a picture's own shape can rely on it.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from '../../admin/model.mjs';
import {byteHash} from './theme-homepage.mjs';
import {readImageSize} from './image-size.mjs';

export const DISPLAY_WIDTH=1600;
export const DISPLAY_MIN_BYTES=400*1024;
const QUALITY=82,VARIANT='w1600q82';
const original=/^([a-f0-9]{64})\.(png|jpg|webp)$/;
export const displayName=hash=>`${hash}.${VARIANT}.webp`;

async function loadEncoder(){
  try{return (await import('sharp')).default;}
  catch(error){console.warn('Display images skipped: image encoder unavailable ('+error.code+')');return null;}
}
async function previous(previousRoot,name){
  if(!previousRoot)return null;
  try{return await readFile(join(previousRoot,'article-media',name));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}

export async function attachDisplayImages({target,manifest,previousRoot,encoder}){
  let names;
  try{names=await readdir(join(target,'article-media'));}catch(error){if(error.code==='ENOENT')return manifest;throw error;}
  const replace=new Map();let sharp=encoder;
  for(const name of names.sort()){
    const match=original.exec(name);if(!match)continue;
    const bytes=await readFile(join(target,'article-media',name)),size=readImageSize(bytes);
    if(bytes.length<=DISPLAY_MIN_BYTES&&!(size?.width>DISPLAY_WIDTH))continue;
    const copy=displayName(match[1]);
    let derived=await previous(previousRoot,copy);
    if(!derived){
      sharp??=await loadEncoder();if(!sharp)break;
      derived=await sharp(bytes,{limitInputPixels:64000000}).rotate().resize({width:DISPLAY_WIDTH,withoutEnlargement:true}).webp({quality:QUALITY,effort:4}).toBuffer();
    }
    // Keep the original when the copy would not save a meaningful amount.
    if(derived.length>bytes.length*0.8)continue;
    const path='article-media/'+copy;
    await writeFile(join(target,path),derived);
    manifest.hashes[path]=digest(derived);manifest.byteHashes={...manifest.byteHashes,[path]:byteHash(derived)};
    replace.set(name,copy);
  }
  // Only image sources and stated proportions change; links, feeds, social
  // cards and exports keep the original.
  const sizes=new Map();
  const sizeOf=async name=>{
    if(!sizes.has(name)){let size=null;try{size=readImageSize(await readFile(join(target,'article-media',name)));}catch(error){if(error.code!=='ENOENT')throw error;}sizes.set(name,size);}
    return sizes.get(name);
  };
  const imgTag=/<img\b[^>]*>/g,source=/(\ssrc=")((?:https?:\/\/[^/"]+)?\/article-media\/)([a-f0-9]{64}\.(?:png|jpg|webp))(")/;
  for(const file of new Set([...Object.keys(manifest.hashes),...Object.keys(manifest.byteHashes||{})].filter(f=>f.endsWith('.html')))){
    const before=await readFile(join(target,file),'utf8');
    let after='',last=0;
    for(const match of before.matchAll(imgTag)){
      let tag=match[0];const src=source.exec(tag);
      if(src){
        const name=replace.get(src[3])||src[3];
        if(name!==src[3])tag=tag.replace(source,(all,head,base,_,tail)=>head+base+name+tail);
        const size=await sizeOf(name),w=/\swidth="(\d+)"/.exec(tag),h=/\sheight="(\d+)"/.exec(tag);
        if(size&&w&&h&&Number(w[1])>0&&Number(h[1])>0){
          const height=Math.max(1,Math.round(Number(w[1])*size.height/size.width));
          if(Math.abs(height-Number(h[1]))>1)tag=tag.replace(/\sheight="\d+"/,` height="${height}"`);
        }
      }
      after+=before.slice(last,match.index)+tag;last=match.index+match[0].length;
    }
    after+=before.slice(last);
    if(after===before)continue;
    await writeFile(join(target,file),after);if(Object.hasOwn(manifest.hashes,file))manifest.hashes[file]=digest(after);
    if(Object.hasOwn(manifest.byteHashes||{},file))manifest.byteHashes[file]=byteHash(Buffer.from(after));
  }
  return manifest;
}
