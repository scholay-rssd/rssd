import {mkdir,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {basename,join,sep} from 'node:path';

// Receives one validated cloud revision. Exporting never imports a draft or
// changes the workspace index, sync baseline, publication receipt or server.
export async function exportCloudArticle({root,directory,origin,bundle}){
  const base=await realpath(directory),workspace=await realpath(root);
  if(!(await stat(base)).isDirectory())throw Error('导出位置不是文件夹');
  if(base===workspace||base.startsWith(workspace+sep))throw Error('请选择稿件工作目录之外的位置，避免在原稿中写入导出文件');
  if(!Number.isSafeInteger(bundle.version)||bundle.version<1)throw Error('云端稿件版本无效');
  const {data}=bundle;
  const title=data.title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'').replace(/[. ]+$/g,'').trim().slice(0,60)||'云端稿件';
  const name=`${data.date}_${title}`;
  let target;
  for(let copy=1;;copy++){
    const candidate=join(base,copy===1?name:`${name} ${copy}`);
    try{await mkdir(candidate,{mode:0o700});target=candidate;break;}
    catch(e){if(e.code!=='EEXIST')throw e;}
  }
  try{
    let markdown=data.markdown;
    const assets=[...new Map((data.assets||[]).map(asset=>[asset.path,asset])).values()];
    if(assets.length)await mkdir(join(target,'assets'),{mode:0o700});
    for(const asset of assets){
      const path='assets/'+basename(asset.path);
      await writeFile(join(target,path),Buffer.from(asset.data,'base64'),{flag:'wx',mode:0o600});
      markdown=markdown.split(origin+asset.path).join(path).split(asset.path).join(path);
    }
    await writeFile(join(target,'正文.md'),markdown,{flag:'wx',mode:0o600});
    const {markdown:_,assets:__,...metadata}=data;
    await writeFile(join(target,'文章信息.json'),JSON.stringify({
      ...metadata,origin,version:bundle.version,publishedVersion:bundle.publishedVersion??null,
      exportedAt:new Date().toISOString(),assets:assets.map(asset=>({path:'assets/'+basename(asset.path),cloudPath:asset.path})),
    },null,2)+'\n',{flag:'wx',mode:0o600});
    return {directory:target,version:bundle.version,images:assets.length};
  }catch(e){
    await rm(target,{recursive:true,force:true});
    throw e;
  }
}
