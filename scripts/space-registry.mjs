import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync,readdirSync,rmSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {profiles,DEFAULT_SITE,validateSite} from './site-config.mjs';
import {refreshSiteBrand} from '../contracts/site-branding.mjs';
import {siteWithCachedSections,syncSectionCatalog} from './site-section-catalog.mjs';
import {migrateRenamedSpaces} from './space-rename.mjs';

const json=file=>JSON.parse(readFileSync(file,'utf8'));
function saveBytes(file,value){const tmp=file+'.'+randomUUID()+'.tmp';try{writeFileSync(tmp,value,{mode:0o600,flag:'wx'});renameSync(tmp,file);}finally{rmSync(tmp,{force:true});}}
function save(file,value){saveBytes(file,JSON.stringify(value,null,2)+'\n');}
export function registry(data,initialize=true){
  const file=join(data,'spaces.json');
  // Retired space IDs move to their new names before anything reads them.
  if(initialize)migrateRenamedSpaces(data);
  const value=existsSync(file)?json(file):{version:1,activeSpaceId:DEFAULT_SITE.spaceId,sites:[DEFAULT_SITE]};
  if(value.version!==1||!Array.isArray(value.sites))throw Error('空间配置版本无效');
  const oldBrands=value.sites.map(s=>JSON.stringify([s.name,s.author,s.slogan]));
  value.sites=value.sites.map(validateSite);
  if(new Set(value.sites.map(s=>s.id)).size!==value.sites.length||new Set(value.sites.map(s=>s.spaceId)).size!==value.sites.length||!value.sites.some(s=>s.spaceId===value.activeSpaceId))throw Error('空间或站点编号重复或缺失');
  if(initialize&&(!existsSync(file)||value.sites.some((s,i)=>JSON.stringify([s.name,s.author,s.slogan])!==oldBrands[i]))){mkdirSync(data,{recursive:true,mode:0o700});save(file,value);}
  return value;
}
export function spaceContext(data,id){
  const all=registry(data),site=all.sites.find(s=>s.spaceId===(id||all.activeSpaceId));if(!site)throw Error('空间不存在');
  return prepareContext(data,all,site);
}
function spaceLayout(data,site){
  const stateDirectory=site.legacy?data:join(data,'spaces',site.spaceId);
  const preference=join(stateDirectory,'editorial-workspace.json');
  const workspaceRoot=existsSync(preference)?json(preference).path:join(stateDirectory,'workspace');
  if(typeof workspaceRoot!=='string'||!workspaceRoot.startsWith('/' )&& !/^[A-Z]:[\\/]/i.test(workspaceRoot))throw Error('稿件目录必须为绝对路径');
  if(!site.legacy){
    // Never interpret an existing unrelated folder as a new empty workspace.
    const binding=join(workspaceRoot,'.site.json');
    if(existsSync(workspaceRoot)&&!existsSync(binding)&&readdirSync(workspaceRoot).length)throw Error('现有目录未绑定此站点，请选择空文件夹或此站点已有工作区');
    if(existsSync(binding)){const old=validateSite(json(binding));if(old.id!==site.id||old.spaceId!==site.spaceId)throw Error('稿件目录已属于其他空间');}
  }
  return {stateDirectory,preference,workspaceRoot};
}
function prepareContext(data,all,site){
  const {stateDirectory,preference,workspaceRoot}=spaceLayout(data,site);
  mkdirSync(stateDirectory,{recursive:true,mode:0o700});
  if(!site.legacy){
    if(!existsSync(join(workspaceRoot,'.site.json')))initializeSiteWorkspace(workspaceRoot,site);
    else{const binding=join(workspaceRoot,'.site.json'),old=json(binding),next=refreshSiteBrand(old);if(JSON.stringify(old)!==JSON.stringify(next))save(binding,next);}
    if(!existsSync(preference))save(preference,{path:workspaceRoot});
  }
  const configFile=join(stateDirectory,'site.json'),configBytes=JSON.stringify(site,null,2)+'\n';
  // Context reads and repeated switches must not rewrite unchanged metadata.
  if(!existsSync(configFile)||readFileSync(configFile,'utf8')!==configBytes)saveBytes(configFile,configBytes);
  site=siteWithCachedSections(workspaceRoot,site,{required:true});
  return {spaceId:site.spaceId,siteId:site.id,site,stateDirectory,workspaceRoot,configFile,spaces:all.sites.map(s=>({id:s.spaceId,siteId:s.id,name:s.name,domain:s.domain,origin:s.origin}))};
}
export function initializeSiteWorkspace(workspaceRoot,site){
      site=validateSite(site);
      if(site.legacy)throw Error('默认学术工作区使用原有初始化流程');
      if(existsSync(workspaceRoot)&&readdirSync(workspaceRoot).length)throw Error('新工作区必须为空文件夹');
      for(const path of ['articles','_ops/inventory','_ops/publishing/article-packages','.agents/skills/site-writing'])mkdirSync(join(workspaceRoot,path),{recursive:true,mode:0o700});
      save(join(workspaceRoot,'_ops/inventory/article-index.json'),{version:1,spaceId:site.spaceId,siteId:site.id,annexColumns:site.columns,articles:{}});
      save(join(workspaceRoot,'_ops/publishing/article-packages/package-map.json'),{version:1,packages:{}});
      writeFileSync(join(workspaceRoot,'AGENTS.md'),`# ${site.name} 创作空间\n领域：${site.domain}。只处理此空间的材料；原始来源与事实分开，未知信息明确保留。通过内容工作台工具保存与发布，稿件稳定编号与来源哈希不得改写。发布前使用预览与用户确认，提交不确定时查询原回执。\n`);
      writeFileSync(join(workspaceRoot,'README.md'),`# ${site.name}\n本站稿件、素材与发布回执在此独立保存。站点：${site.origin}\n`);
      writeFileSync(join(workspaceRoot,'.agents/skills/site-writing/SKILL.md'),`# 内容写作\n围绕${site.domain}采集已核实的原始来源。区分事实、观点和计划。新闻与历史保留出处；年度惯例须有月日依据，不把发布日期当作事件日期。通过 draft_create、draft_save 按稳定编号与 SHA 保存。公开前遵守工作台确认流程，不通过 shell 绕过。\n`);
      save(join(workspaceRoot,'.site.json'),site);
}
export function selectSpace(data,id){const context=spaceContext(data,id),all=registry(data);all.activeSpaceId=id;save(join(data,'spaces.json'),all);return context;}
export async function refreshSpaceSections(data,id){
 const before=spaceContext(data,id),catalog=await syncSectionCatalog(before.workspaceRoot,before.site);
 const context=spaceContext(data,id);context.site.sectionCatalog=catalog;return context;
}
export function authorizationTarget(data,input){
  const incoming=validateSite(input),all=registry(data,false);
  if((incoming.id===DEFAULT_SITE.id)!==incoming.legacy||(incoming.id===DEFAULT_SITE.id)!==(incoming.spaceId===DEFAULT_SITE.spaceId))throw Error('默认学术空间的身份不能改写');
  const existing=all.sites.find(s=>s.id===incoming.id||s.spaceId===incoming.spaceId);
  if(existing){
    if(existing.id!==incoming.id||existing.spaceId!==incoming.spaceId||existing.legacy!==incoming.legacy)throw Error('空间或站点编号已被另一连接使用，原空间保持不变');
    const canonical=profiles.find(s=>s.id===incoming.id&&s.spaceId===incoming.spaceId&&s.origin===incoming.origin);
    if(existing.origin!==incoming.origin&&!(canonical?.aliases?.includes(existing.origin)&&incoming.aliases?.includes(existing.origin)))throw Error('此空间已连接其他站点地址，不能用授权文件覆盖');
  }else{
    const dir=join(data,'spaces',incoming.spaceId);
    if(existsSync(dir)&&(lstatSync(dir).isSymbolicLink()||!lstatSync(dir).isDirectory()||readdirSync(dir).length))throw Error('空间目录已有未登记的数据，请先恢复原空间配置');
  }
  // Reauthorization never overwrites local columns, workspace paths or metadata.
  const site=existing||incoming;
  spaceLayout(data,site);
  return {site,existing:Boolean(existing),all};
}

// Called only after live verification and OS-vault storage. Publish the registry
// last; on failure restore metadata and remove only directories created here.
export function registerAuthorizedSite(data,input,{vaultManaged=true}={}){
  const {site,existing,all}=authorizationTarget(data,input);
  const {stateDirectory,preference,workspaceRoot}=spaceLayout(data,site);
  const stateExisted=existsSync(stateDirectory),workspaceExisted=existsSync(workspaceRoot);
  const initializeWorkspace=!site.legacy&&(!workspaceExisted||readdirSync(workspaceRoot).length===0);
  const files=[join(stateDirectory,'site.json'),preference,join(stateDirectory,'website-vault-managed')];
  const before=files.map(file=>[file,existsSync(file)?readFileSync(file):null]);
  if(!existing)all.sites.push(site);
  try{
    const context=prepareContext(data,all,site);
    if(vaultManaged)saveBytes(join(stateDirectory,'website-vault-managed'),'1');
    if(!existing||!existsSync(join(data,'spaces.json')))save(join(data,'spaces.json'),all);
    return {...context,existing};
  }catch(error){
    try{
      if(initializeWorkspace){rmSync(workspaceRoot,{recursive:true,force:true});if(workspaceExisted)mkdirSync(workspaceRoot,{recursive:true,mode:0o700});}
      for(const [file,bytes] of before){if(bytes!==null)saveBytes(file,bytes);else rmSync(file,{force:true});}
      if(!stateExisted)rmSync(stateDirectory,{recursive:true,force:true});
    }catch{throw Error('空间建立失败，恢复本地配置也未完成；请保留原目录并重试');}
    throw error;
  }
}
export function importSite(data,input){const site=validateSite(input),all=registry(data);if(site.legacy||site.id==='scholay-today')throw Error('默认学术空间不可覆盖');if(all.sites.some(s=>s.id===site.id||s.spaceId===site.spaceId))throw Error('空间或站点已存在；为保护既有回执，不能覆盖身份');return registerAuthorizedSite(data,site,{vaultManaged:false});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [method,data,id]=process.argv.slice(2);const result=method==='refresh'?await refreshSpaceSections(data,id):method==='select'?selectSpace(data,id):method==='import'?importSite(data,json(id)):spaceContext(data,id);process.stdout.write(JSON.stringify(result));}catch(e){process.stderr.write(e.message);process.exitCode=1;}
}
