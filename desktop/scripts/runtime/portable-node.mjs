import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
// Official standalone binary; Homebrew Node depends on host-specific dylibs.
export async function portableNode(cache){
 if(process.env.SCHOLAY_BUNDLED_NODE)return process.env.SCHOLAY_BUNDLED_NODE;
 const version='v24.14.0',platform=process.platform==='win32'?'win':process.platform;
 if(!['win','darwin','linux'].includes(platform))throw Error('Unsupported packaged Node platform');
 const stem=`node-${version}-${platform}-${process.arch}`,zip=platform==='win',name=stem+(zip?'.zip':'.tar.gz');
 const binary=join(cache,stem,zip?'node.exe':'bin/node');
 try{await access(binary);return binary;}catch{}
 await mkdir(cache,{recursive:true});
 const base=`https://nodejs.org/dist/${version}/`;
 const checks=await fetch(base+'SHASUMS256.txt');if(!checks.ok)throw Error('Node checksum download failed');
 const expected=(await checks.text()).split('\n').find(line=>line.endsWith('  '+name))?.split(' ')[0];
 if(!expected)throw Error('No Node checksum for '+name);
 const response=await fetch(base+name);if(!response.ok)throw Error('Node download failed');
 const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Node checksum mismatch');
 const archive=join(cache,name);await writeFile(archive,bytes);
 const args=zip?['-NoProfile','-NonInteractive','-Command',`$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${cache.replaceAll("'","''")}' -Force`]:['-xzf',archive,'-C',cache];
 const result=spawnSync(zip?'powershell.exe':'tar',args,{stdio:'inherit'});if(result.status!==0)throw Error('Node extraction failed');
 return binary;
}
