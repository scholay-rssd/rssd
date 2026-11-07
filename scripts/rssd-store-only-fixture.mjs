import {existsSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';

export const STORE_ONLY_SITES_SUBMODULE='sites';
export const STORE_ONLY_PROFILES='sites/profiles.json';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

function fail(message,code='fixture_unavailable'){throw Object.assign(Error(message),{code});}

export function requireNode24(version=process.versions.node){
  const major=Number(String(version).split('.')[0]);
  if(!Number.isInteger(major)||major<24)fail('Store-only fixture and engines require Node.js 24+; Node '+version+' cannot be used as a complete verification','node_version');
  return major;
}

export function storeOnlyProfilesPath(base=root){return join(base,STORE_ONLY_PROFILES);}

export function readStoreOnlyProfiles(base=root){
  const file=storeOnlyProfilesPath(base);
  if(!existsSync(file))fail(STORE_ONLY_PROFILES+' is missing. It is the public rssd-sites submodule file, not generated and not a stub. Checkout it with: git submodule update --init sites','sites_submodule');
  let profiles;
  try{profiles=JSON.parse(readFileSync(file,'utf8'));}catch{fail(STORE_ONLY_PROFILES+' is unreadable JSON; restore the rssd-sites submodule instead of writing a stub','sites_submodule');}
  if(!Array.isArray(profiles)||!profiles.some(site=>site?.id==='enter'&&typeof site.spaceId==='string'&&site.spaceId&&typeof site.origin==='string'&&site.origin.startsWith('https://')))fail(STORE_ONLY_PROFILES+' is not the real sites submodule catalog (enter identity missing). Do not replace it with an extract stub.','sites_submodule');
  return profiles;
}

export function sitesGitlinkSha(base=root){
  const result=spawnSync('git',['ls-tree','HEAD',STORE_ONLY_SITES_SUBMODULE],{cwd:base,encoding:'utf8'});
  if(result.status!==0)fail('Cannot read the sites gitlink from HEAD','sites_submodule');
  const sha=result.stdout.trim().split(/\s+/)[2];
  if(!/^[a-f0-9]{40}$/.test(sha||''))fail('sites gitlink SHA is missing from HEAD','sites_submodule');
  return sha;
}

export function requireStoreOnlyFixtureTree(base=root){
  requireNode24();
  const profiles=readStoreOnlyProfiles(base);
  return {root:base,profiles,sitesGitlink:sitesGitlinkSha(base),profilesPath:storeOnlyProfilesPath(base)};
}
