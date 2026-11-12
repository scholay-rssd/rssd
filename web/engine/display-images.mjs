// Display copies for oversized published images.
//
// Registered originals stay byte-for-byte as published: their hashes bind
// Center gallery registration, visual review, exports and feeds. Pages instead
// show a resized WebP written beside the original, named by the original's hash
// and the encoding settings, so a copy in the previous release can be reused.
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
      sharp??=await loadEncoder();if(!sharp)return manifest;
      derived=await sharp(bytes,{limitInputPixels:64000000}).rotate().resize({width:DISPLAY_WIDTH,withoutEnlargement:true}).webp({quality:QUALITY,effort:4}).toBuffer();
    }
    // Keep the original when the copy would not save a meaningful amount.
    if(derived.length>bytes.length*0.8)continue;
    const path='article-media/'+copy;
    await writeFile(join(target,path),derived);
    manifest.hashes[path]=digest(derived);manifest.byteHashes={...manifest.byteHashes,[path]:byteHash(derived)};
    replace.set(name,copy);
  }
  if(!replace.size)return manifest;
  // Only image sources change; links, feeds, social cards and exports keep the original.
  const pattern=/(<img\b[^>]*?\ssrc=")((?:https?:\/\/[^/"]+)?\/article-media\/)([a-f0-9]{64}\.(?:png|jpg|webp))(")/g;
  for(const file of new Set([...Object.keys(manifest.hashes),...Object.keys(manifest.byteHashes||{})].filter(f=>f.endsWith('.html')))){
    const before=await readFile(join(target,file),'utf8');
    const after=before.replace(pattern,(all,head,base,name,tail)=>replace.has(name)?head+base+replace.get(name)+tail:all);
    if(after===before)continue;
    await writeFile(join(target,file),after);if(Object.hasOwn(manifest.hashes,file))manifest.hashes[file]=digest(after);
    if(Object.hasOwn(manifest.byteHashes||{},file))manifest.byteHashes[file]=byteHash(Buffer.from(after));
  }
  return manifest;
}
