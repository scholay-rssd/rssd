import {SITE} from './site-config.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';

// Runs on the authoring computer only; the public server serves the derivative.
const policy=SITE.legacy?'scholay-watermark-webp-v1':'site-watermark-webp-v1:'+SITE.id+':'+SITE.name;
const watermark=SITE.legacy?'scholay today':SITE.name.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
// Server-side upload limit per derivative; editorial-workspace enforces the same value.
export const PUBLICATION_IMAGE_MAX_BYTES=1024*1024;
// Preferred settings first; quality steps down before width so detail is kept as long as possible.
const WIDTHS=[1600,1400,1200,1000,800],QUALITIES=[86,78,70,62,54];
async function render(sharp,bytes,maxWidth,quality){
  const resized=await sharp(bytes,{limitInputPixels:64000000}).rotate().resize({width:maxWidth,height:4000,fit:'inside',withoutEnlargement:true}).toBuffer({resolveWithObject:true});
  const width=resized.info.width,font=Math.max(9,Math.min(22,Math.floor(width/40))),height=font+16;
  // A dedicated footer avoids covering scientific labels and source credits.
  const mark=Buffer.from('<svg width="'+width+'" height="'+height+'"><text x="'+(width-10)+'" y="'+(font+5)+'" text-anchor="end" font-family="Arial,sans-serif" font-size="'+font+'" fill="#ffffff">'+watermark+'</text></svg>');
  return {width,data:await sharp(resized.data).extend({bottom:height,background:'#28352f'}).composite([{input:mark,gravity:'south'}]).webp({quality,alphaQuality:100,effort:5}).toBuffer()};
}
export async function publicationImage(bytes,cacheDir,{maxBytes=PUBLICATION_IMAGE_MAX_BYTES}={}) {
  if(bytes.length>24*1024*1024)throw Error('原始配图超过 24MB，请先缩小后发布');
  const sharp=(await import('sharp')).default;
  // The default limit keeps the historical cache key: its first attempt is byte-identical to the old fixed settings.
  const hash=createHash('sha256').update(policy+':'+sharp.versions.sharp+':'+sharp.versions.vips+(maxBytes===PUBLICATION_IMAGE_MAX_BYTES?'':':max'+maxBytes)).update(bytes).digest('hex');
  await mkdir(cacheDir,{recursive:true,mode:0o700});
  const target=join(cacheDir,hash+'.webp');
  // Older builds cached oversized derivatives; those are regenerated with the fallback ladder.
  try{const cached=await readFile(target);if(cached.length<=maxBytes)return cached;}catch(e){if(e.code!=='ENOENT')throw e;}
  const meta=await sharp(bytes,{limitInputPixels:64000000}).metadata();
  if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)>1)throw Error('发布配图仅支持静态 PNG、JPEG、WebP；请先导出静态图');
  let result=null;
  const attemptedWidths=new Set();
  outer:for(const maxWidth of WIDTHS){
    let width=0;
    for(const quality of QUALITIES){
      const out=await render(sharp,bytes,maxWidth,quality);width=out.width;
      if(attemptedWidths.has(width))break;
      if(out.data.length<=maxBytes){result=out.data;break outer;}
    }
    // Two early limits may produce the same width; a later limit can still
    // shrink that source, so skip repeats without stopping the ladder.
    attemptedWidths.add(width);
  }
  if(!result)throw Error('配图压缩到最低画质和宽度后仍超过 '+Math.round(maxBytes/1024)+'KB，请换图或先裁剪');
  const tmp=target+'.'+randomUUID()+'.tmp';
  try{await writeFile(tmp,result,{mode:0o600,flag:'wx'});await rename(tmp,target);}finally{await rm(tmp,{force:true});}
  return result;
}
