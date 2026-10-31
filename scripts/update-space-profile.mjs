// Explicit maintenance of already connected built-in spaces. Never migrates
// manuscripts, credentials or site IDs; only a declared alias can change origin.
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {profiles,validateSite} from './site-config.mjs';
import {randomUUID} from 'node:crypto';
export async function updateSpaceProfile(data,siteId,{fetcher=fetch}={}){
 const registryFile=join(data,'spaces.json'),registry=JSON.parse(await readFile(registryFile,'utf8'));
 const old=registry.sites.find(s=>s.id===siteId),current=profiles.find(s=>s.id===siteId);
 if(!old||!current||old.spaceId!==current.spaceId||Boolean(old.legacy)!==Boolean(current.legacy)||JSON.stringify(old.columns)!==JSON.stringify(current.columns))throw Error('现有空间身份或旧栏目不匹配');
 if(old.origin!==current.origin&&!current.aliases?.includes(old.origin))throw Error('站点地址不是已声明的旧域名');
 const response=await fetcher(current.origin+'/manage/api/site',{redirect:'error',signal:AbortSignal.timeout(20000)}),remote=await response.json();
 if(!response.ok||remote.protocol!=='scholay-content'||remote.version!==1||remote.siteId!==current.id||remote.origin!==current.origin)throw Error('目标站点身份未通过验证');
 const state=current.legacy?data:join(data,'spaces',current.spaceId),root=JSON.parse(await readFile(join(state,'editorial-workspace.json'),'utf8')).path;
 const next=validateSite({...old,...current,retainLocal:old.retainLocal});
 const backup=join(data,'profile-backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+siteId);await mkdir(backup,{recursive:true,mode:0o700});
 const writes=[[join(state,'site.json'),next],...(!current.legacy?[[join(root,'.site.json'),next]]:[]),[registryFile,{...registry,sites:registry.sites.map(s=>s.id===siteId?next:s)}]];
 const before=[];
 try{for(const [file,value] of writes){const bytes=await readFile(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});before.push([file,bytes]);if(bytes)await writeFile(join(backup,before.length+'.json'),bytes,{mode:0o600});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,file);}}
 catch(error){for(const [file,bytes] of before.reverse())if(bytes)await writeFile(file,bytes,{mode:0o600});else await rm(file,{force:true});throw error;}
 return {siteId,spaceId:next.spaceId,origin:next.origin,previousOrigin:old.origin,name:next.name,backup};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [data,...ids]=process.argv.slice(2);if(!data||!ids.length)throw Error('Usage: update-space-profile.mjs DATA_DIRECTORY SITE_ID...');for(const id of ids)console.log(JSON.stringify(await updateSpaceProfile(data,id)));}catch(e){console.error(e.message);process.exitCode=1;}
}
