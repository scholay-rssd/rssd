#!/usr/bin/env node
// Sign a CI-built desktop installer on this Mac and add it to the static update feed.
// CI builds unsigned artifacts; the updater private key never leaves the maintainer's machine.
//
//   node scripts/sign-desktop-update.mjs --run <actions-run-id> --target windows-x64 --out <staging-dir>
//
// The staging directory is then reviewed and uploaded as described in deploy/docs/client-updates.md.
import {spawnSync,execFileSync} from 'node:child_process';
import {readdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {prepareDesktopUpdate} from './desktop-update-manifest.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
// CI matrix name -> Tauri updater platform key and installer pattern.
export const targets={
  'windows-x64':{platform:'windows-x86_64',installer:/_x64-setup\.exe$/i},
};

export function updaterKeyFile(env=process.env,home=homedir()){
  return env.SCHOLAY_UPDATER_KEY_FILE||join(home,'Library/Application Support/Scholay Today Maintenance/updates/today.key');
}

// The CLI rejects --private-key-path when TAURI_SIGNING_PRIVATE_KEY is set, even to "".
export function signingEnv(env=process.env){
  const out={...env,TAURI_SIGNING_PRIVATE_KEY_PASSWORD:env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD??''};
  delete out.TAURI_SIGNING_PRIVATE_KEY;
  return out;
}

export function parseArgs(argv){
  const options={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    if(!['--run','--target','--out'].includes(key)||value===undefined||value.startsWith('--'))throw Error('Usage: --run <id> --target windows-x64 --out <dir>');
    options[key.slice(2)]=value;
  }
  if(!/^\d+$/.test(options.run||''))throw Error('--run must be a GitHub Actions run ID');
  if(!targets[options.target])throw Error('--target must be one of: '+Object.keys(targets).join(', '));
  if(!options.out)throw Error('--out is required');
  return options;
}

// Exactly one installer for the expected version, so a stale or extra file is never signed.
export function pickInstaller(paths,target,version){
  const {installer}=targets[target];
  const matches=paths.filter(path=>installer.test(basename(path)));
  if(matches.length!==1)throw Error(`Expected one ${target} installer in the artifact, found ${matches.length}`);
  const name=basename(matches[0]);
  if(!name.includes('_'+version+'_'))throw Error(`Installer ${name} does not match version ${version}`);
  return matches[0];
}

async function walk(folder){
  const out=[];
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const path=join(folder,entry.name);
    if(entry.isDirectory())out.push(...await walk(path));else if(entry.isFile())out.push(path);
  }
  return out;
}

async function main(){
  const {run,target,out}=parseArgs(process.argv.slice(2));
  const keyFile=updaterKeyFile();
  if(!existsSync(keyFile))throw Error('Updater key not found; set SCHOLAY_UPDATER_KEY_FILE');
  const meta=JSON.parse(execFileSync('gh',['api',`repos/scholay-rssd/rssd/actions/runs/${run}`],{encoding:'utf8'}));
  if(meta.conclusion!=='success'||meta.head_branch!=='main')throw Error('Only sign artifacts from a successful run on main');
  const commit=meta.head_sha;
  const version=JSON.parse(execFileSync('git',['show',`${commit}:desktop/package.json`],{cwd:root,encoding:'utf8'})).version;
  const work=await mkdtemp(join(tmpdir(),'rssd-sign-'));
  try{
    const name=`rssd-${target}-${commit}`;
    const download=spawnSync('gh',['run','download',run,'--repo','scholay-rssd/rssd','-n',name,'-D',work],{stdio:'inherit'});
    if(download.status!==0)throw Error('Artifact download failed: '+name);
    const installer=pickInstaller(await walk(work),target,version);
    const tauri=createRequire(join(root,'desktop/package.json')).resolve('@tauri-apps/cli/tauri.js');
    const sign=spawnSync(process.execPath,[tauri,'signer','sign','--private-key-path',keyFile,installer],{
      stdio:['ignore','ignore','inherit'],env:signingEnv(),
    });
    if(sign.status!==0||!existsSync(installer+'.sig'))throw Error('Signing failed');
    const receipt=await prepareDesktopUpdate({artifact:installer,platform:targets[target].platform,directory:resolve(out),version,commit});
    console.log(JSON.stringify({...receipt,signature:(await readFile(installer+'.sig','utf8')).trim().length+' bytes'}));
  }finally{await rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
