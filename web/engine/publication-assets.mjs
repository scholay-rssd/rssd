import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {markdownImages} from '../../scripts/article-format.mjs';

export async function publicationAssetBytes(asset,previousRoot){
  const match=/^\/article-media\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(asset.path||'');
  if(!match)throw Error('发布图片路径无效');
  if(typeof asset.data==='string')return Buffer.from(asset.data,'base64');
  if(asset.fromPublished!==true||!previousRoot)throw Error('发布图片缺少已发布来源');
  const bytes=await readFile(join(previousRoot,asset.path.slice(1)));
  if(createHash('sha256').update(bytes).digest('hex')!==match[1])throw Error('已发布图片校验失败：'+asset.path);
  return bytes;
}

// Preserve assets used only by a translated edition, and materialize the
// academic renderer's validated input without weakening article validation.
export async function prepareSnapshotAssets(snapshot,{target,previousRoot,inline=false,byteHashes={}}){
  const cached=new Map();
  const prepare=async item=>{
    const assets=new Map((item.assets||[]).map(a=>[a.path,a]));
    if(inline)for(const field of ['markdown','body','summary','factSummary','historicalSignificance','value']){
      for(const path of markdownImages(item[field]||''))if(path.startsWith('/article-media/')&&!assets.has(path))assets.set(path,{path,fromPublished:true});
    }
    const next=[];
    for(const asset of assets.values()){
      let bytes=cached.get(asset.path);
      if(!bytes){
        if(typeof asset.data==='string')bytes=await publicationAssetBytes(asset,previousRoot);
        else try{bytes=await publicationAssetBytes(asset,target);}catch(error){if(error.code!=='ENOENT')throw error;bytes=await publicationAssetBytes(asset,previousRoot);}
        const match=/^\/article-media\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(asset.path);
        if(!match||createHash('sha256').update(bytes).digest('hex')!==match[1])throw Error('发布图片校验失败');
        const file=join(target,asset.path.slice(1));await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);cached.set(asset.path,bytes);byteHashes[asset.path.slice(1)]=match[1];
      }
      next.push(inline?{path:asset.path,data:bytes.toString('base64')}:asset);
    }
    return {...item,assets:next};
  };
  const list=async items=>{const result=[];for(const item of items||[])result.push(await prepare(item));return result;};
  return {...snapshot,news:await list(snapshot.news),data:{...snapshot.data,year:await list(snapshot.data?.year),history:await list(snapshot.data?.history)},openSource:{...snapshot.openSource,items:await list(snapshot.openSource?.items)}};
}
