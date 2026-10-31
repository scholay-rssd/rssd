import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export async function publicationAssetBytes(asset,previousRoot){
  const match=/^\/article-media\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(asset.path||'');
  if(!match)throw Error('发布图片路径无效');
  if(typeof asset.data==='string')return Buffer.from(asset.data,'base64');
  if(asset.fromPublished!==true||!previousRoot)throw Error('发布图片缺少已发布来源');
  const bytes=await readFile(join(previousRoot,asset.path.slice(1)));
  if(createHash('sha256').update(bytes).digest('hex')!==match[1])throw Error('已发布图片校验失败：'+asset.path);
  return bytes;
}
