#!/usr/bin/env node
// Prepare a signed Tauri artifact and its static update feed for reviewed upload.
import {readFile,mkdir,copyFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function prepareDesktopUpdate({artifact,platform,directory,version,commit}){
 if(!/^(?:darwin|windows|linux)-(?:aarch64|x86_64)$/.test(platform)||!/^\d+\.\d+\.\d+$/.test(version)||!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid release identity');
 const suffix=platform.startsWith('darwin')?'.app.tar.gz':platform.startsWith('windows')?'.exe':'.AppImage.tar.gz';
 if(!artifact.endsWith(suffix))throw Error('Wrong updater artifact type');
 const bytes=await readFile(artifact),signature=(await readFile(artifact+'.sig','utf8')).trim();
 if(!bytes.length||!signature||signature.length>4096)throw Error('Missing signed artifact');
 await mkdir(directory,{recursive:true});
 const name='today-'+version+'-'+platform+suffix,sha256=createHash('sha256').update(bytes).digest('hex');
 await copyFile(artifact,join(directory,name));await copyFile(artifact+'.sig',join(directory,name+'.sig'));
 let manifest;try{manifest=JSON.parse(await readFile(join(directory,'latest.json'),'utf8'));}catch{}
 if(manifest?.version!==version)manifest={version,notes:'today '+version,pub_date:new Date().toISOString(),platforms:{}};
 manifest.platforms[platform]={signature,url:'https://today.scholay.com/updates/today/'+encodeURIComponent(name)};
 await writeFile(join(directory,'latest.json.next'),JSON.stringify(manifest,null,2)+'\n');await rename(join(directory,'latest.json.next'),join(directory,'latest.json'));
 const receipt={version,platform,sourceCommit:commit,artifact:name,bytes:bytes.length,sha256};
 await writeFile(join(directory,name+'.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [artifact,platform,directory,commit]=process.argv.slice(2),{version}=JSON.parse(await readFile(new URL('../desktop/package.json',import.meta.url),'utf8'));
 console.log(JSON.stringify(await prepareDesktopUpdate({artifact,platform,directory,version,commit})));
}
