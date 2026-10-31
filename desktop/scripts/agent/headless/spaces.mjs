#!/usr/bin/env node
// Build per-site workspaces outside the repository from authorization files.
// Tokens are written as 0600 files under SCHOLAY_AUTH_DIR, never into Git.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseAuthorization} from '../../../../contracts/site-authorization.mjs';
import {validateSite} from '../../../../scripts/site-config.mjs';
import {initializeSiteWorkspace} from '../../../../scripts/space-registry.mjs';
import {authDir,authorizationPath,canonicalSiteId,repoRoot,siteConfigPath,spaceDir,spaceIdOf,tokenPath,writeTokenFile} from './env.mjs';

export function initSpaces(ids){
 if(!ids.length)throw Error('Usage: spaces <siteId> [siteId...]');
 mkdirSync(authDir(),{recursive:true,mode:0o700});
 const out=[];
 for(const raw of ids){
  const siteId=canonicalSiteId(raw);
  const auth=parseAuthorization(readFileSync(authorizationPath(siteId),'utf8'));
  if(auth.site.id!==siteId)throw Error('authorization file site mismatch: '+siteId);
  const site=auth.site;
  if(site.spaceId!==spaceIdOf(siteId))throw Error('authorization space mismatch: '+siteId);
  const dir=spaceDir(site.spaceId);
  const workspace=site.legacy?join(repoRoot,'editorial'):join(dir,'workspace');
  for(const file of [siteConfigPath(site.spaceId),join(workspace,'.site.json')]){
   if(!existsSync(file))continue;
   const old=validateSite(JSON.parse(readFileSync(file,'utf8')));
   if(old.id!==site.id||old.spaceId!==site.spaceId||old.origin!==site.origin)throw Error('existing workspace belongs to another site');
  }
  if(!site.legacy&&!existsSync(join(workspace,'.site.json')))initializeSiteWorkspace(workspace,site);
  mkdirSync(dir,{recursive:true,mode:0o700});
  writeFileSync(siteConfigPath(site.spaceId),JSON.stringify(site,null,2)+'\n',{mode:0o600});
  writeTokenFile(tokenPath(site.id),auth.credential.token);
  if(site.legacy){
   console.log(site.id,site.spaceId,site.origin,'(legacy editorial workspace)');
  }
  console.log(site.id,site.spaceId,site.origin,site.columns.join('/'),'ok');
  out.push({siteId:site.id,spaceId:site.spaceId,origin:site.origin,workspace});
 }
 return out;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{initSpaces(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
