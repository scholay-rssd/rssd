import {chmodSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseAuthorization} from '../../../../contracts/site-authorization.mjs';
import {DEFAULT_SITE,profiles,setSiteContext,validateSite} from '../../../../scripts/site-config.mjs';
import {useSharedPublicationQueue} from '../../../../scripts/publication-queue-client.mjs';
import {renamedSiteId} from '../../../../contracts/site-renames.mjs';

export const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');

export function headlessHome(){
 const home=resolve(process.env.SCHOLAY_HEADLESS_HOME||join(repoRoot,'.local/headless'));
 mkdirSync(join(home,'briefs'),{recursive:true,mode:0o700});
 mkdirSync(join(home,'results'),{recursive:true,mode:0o700});
 return home;
}
export function spacesRoot(){
 return resolve(process.env.SCHOLAY_SPACES_ROOT||join(homedir(),'.local/share/scholay/spaces'));
}
export function authDir(){
 return resolve(process.env.SCHOLAY_AUTH_DIR||join(homedir(),'.local/share/scholay/auth'));
}
export function tokenPath(siteId){
 return join(authDir(),siteId,'publish-token');
}
export function authorizationPath(siteId){
 return process.env.SCHOLAY_AUTH_FILE||join(authDir(),siteId,siteId+'.scholay-site.json');
}
export function spaceIdOf(siteId){
 const site=profiles.find(site=>site.id===canonicalSiteId(siteId));
 return site.spaceId;
}
export function spaceDir(spaceId){
 return join(spacesRoot(),spaceId);
}
export function siteConfigPath(spaceId){
 return join(spaceDir(spaceId),'site.json');
}
export function canonicalSiteId(siteKey){
 if(siteKey==='today')return 'scholay-today';
 // Retired IDs (lingxi -> xsime) keep working in commands and briefs.
 siteKey=renamedSiteId(siteKey);
 if(typeof siteKey!=='string'||!/^[a-z][a-z0-9-]{1,48}$/.test(siteKey))throw Error('unknown site');
 if(!profiles.some(s=>s.id===siteKey))throw Error('unknown site');
 return siteKey;
}
export function writeTokenFile(path,token){
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 writeFileSync(path,String(token).trim()+'\n',{mode:0o600});
 chmodSync(path,0o600);
 return path;
}
export function ensureTokenFile(siteId){
 const file=tokenPath(siteId);
 if(existsSync(file))return file;
 const authFile=authorizationPath(siteId);
 if(!existsSync(authFile))return file;
 const auth=parseAuthorization(readFileSync(authFile,'utf8'));
 if(auth.site.id!==siteId)throw Error('authorization file site mismatch');
 return writeTokenFile(file,auth.credential.token);
}

export function applySiteEnv(siteKey){
 const siteId=canonicalSiteId(siteKey);
 const spaceId=spaceIdOf(siteId);
 const cfg=siteConfigPath(spaceId);
 const tokenFile=ensureTokenFile(siteId);
 let site,root;
 if(existsSync(cfg)){
  site=validateSite(JSON.parse(readFileSync(cfg,'utf8')));
  if(site.id!==siteId||site.spaceId!==spaceId)throw Error('site workspace identity mismatch');
  root=site.legacy?join(repoRoot,'editorial'):join(spaceDir(site.spaceId),'workspace');
  Object.assign(process.env,{
   SCHOLAY_SITE_CONFIG:cfg,
   SCHOLAY_SITE_JSON:JSON.stringify(site),
   SCHOLAY_SITE_ID:site.id,
   SCHOLAY_EDITORIAL_ROOT:root,
   SCHOLAY_TODAY_TOKEN_FILE:tokenFile,
  });
 }else if(siteId===DEFAULT_SITE.id&&existsSync(join(repoRoot,'editorial','_ops/inventory/article-index.json'))){
  site=DEFAULT_SITE;
  root=join(repoRoot,'editorial');
  delete process.env.SCHOLAY_SITE_CONFIG;
  Object.assign(process.env,{SCHOLAY_SITE_JSON:JSON.stringify(site),SCHOLAY_SITE_ID:site.id,SCHOLAY_EDITORIAL_ROOT:root,SCHOLAY_TODAY_TOKEN_FILE:tokenFile});
 }else throw Error('site workspace missing; run npm run headless -- spaces '+siteId);
 setSiteContext(site);
 // Headless pushes use the same queue config as the desktop, so English is
 // handed off here too. An explicit or workspace config still wins.
 useSharedPublicationQueue();
 return {siteId,site,root,tokenFile,home:headlessHome(),spaceId};
}

export function cursorPathEnv(base=process.env){
 const env={...base,PATH:join(base.HOME||homedir(),'.local/bin')+delimiter+(base.PATH||'')};
 delete env.SCHOLAY_TODAY_TOKEN;
 delete env.SCHOLAY_TODAY_TOKEN_FILE;
 return env;
}
