import {SITE,siteForWorkspace} from './site-config.mjs';
import {initializeSiteWorkspace} from './space-registry.mjs';
// A local preference, never a second source checkout or a public deployment input.
import {readFileSync,realpathSync,existsSync} from 'node:fs';
import {readFile,mkdir,writeFile,rename,rm,readdir,cp} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

export const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const preference=process.env.SCHOLAY_APP_DATA?join(process.env.SCHOLAY_APP_DATA,'editorial-workspace.json'):join(projectRoot,'.local/editorial-workspace.json');
export function validateWorkspace(path){
  if(typeof path!=='string'||!path.trim())throw Error('请选择稿件工作目录');
  let root=realpathSync(path);
  // Accept the unified repository, its editorial folder, or its articles folder.
  if(existsSync(join(root,'editorial/_ops/inventory/article-index.json')))root=join(root,'editorial');
  else if(!existsSync(join(root,'_ops/inventory/article-index.json'))&&existsSync(join(root,'../_ops/inventory/article-index.json')))root=realpathSync(join(root,'..'));
  const index=JSON.parse(readFileSync(join(root,'_ops/inventory/article-index.json'),'utf8'));
  if(!index.articles||!Array.isArray(index.annexColumns)||!existsSync(join(root,'articles')))throw Error('目录需要包含 articles 和 _ops/inventory/article-index.json；不会扫描无关文件');
  const binding=join(root,'.site.json');
  if(!SITE.legacy&&!existsSync(binding))throw Error('该目录未绑定当前站点，不能作为此空间的工作区');
  const bound=siteForWorkspace(root);
  if(bound.id!==SITE.id||bound.spaceId!==SITE.spaceId)throw Error('工作区属于其他站点');
  return root;
}
export function configuredWorkspace(){
  if(process.env.SCHOLAY_EDITORIAL_ROOT)return validateWorkspace(process.env.SCHOLAY_EDITORIAL_ROOT);
  try{return validateWorkspace(JSON.parse(readFileSync(preference,'utf8')).path);}
  catch(e){if(e.code==='ENOENT'&&!existsSync(preference))return process.env.SCHOLAY_APP_DATA?join(process.env.SCHOLAY_APP_DATA,'workspace'):join(projectRoot,'editorial');throw Error('已选择的稿件目录不可用，请重新定位目录；未切换到其他目录。');}
}
export async function selectWorkspace(path){
  const root=validateWorkspace(path);await mkdir(dirname(preference),{recursive:true,mode:0o700});
  const tmp=preference+'.'+randomUUID()+'.tmp';
  try{await writeFile(tmp,JSON.stringify({path:root}),{mode:0o600,flag:'wx'});await rename(tmp,preference);}finally{await rm(tmp,{force:true});}
  return workspaceInfo(root);
}
export async function workspaceInfo(root=configuredWorkspace()){
  const index=JSON.parse(await readFile(join(root,'_ops/inventory/article-index.json'),'utf8'));
  return {path:root,articlesPath:join(root,'articles'),count:Object.keys(index.articles).length};
}

export async function initializeWorkspace(path){
  if(typeof path!=='string'||!path.trim())throw Error('请选择本地工作文件夹');
  const root=realpathSync(path);
  if((await readdir(root)).length)throw Error('新工作区请选择空文件夹；已有稿件请使用“选择已有工作区”');
  if(!SITE.legacy){initializeSiteWorkspace(root,SITE);return selectWorkspace(root);}
  const template=process.env.SCHOLAY_TEMPLATE_ROOT||join(projectRoot,'desktop/resources/workspace-template');
  for(const entry of await readdir(template))await cp(join(template,entry),join(root,entry),{recursive:true,force:false,errorOnExist:true});
  await mkdir(join(root,'articles'),{recursive:true});
  await mkdir(join(root,'_ops/inventory/briefs'),{recursive:true});
  await mkdir(join(root,'_ops/publishing/article-packages'),{recursive:true});
  await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({version:1,annexColumns:['学界犀闻','学者观察','昔日学术','学术情报','学术开源','新闻聚合','研究方法'],articles:{}},null,2),{flag:'wx'});
  await writeFile(join(root,'_ops/publishing/article-packages/package-map.json'),JSON.stringify({version:1,packages:{}}),{flag:'wx'});
  return selectWorkspace(root);
}
