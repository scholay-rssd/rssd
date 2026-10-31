import {spawnSync,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,lstat,chmod} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='linux'||process.arch!=='x64')throw Error('Build the Linux x64 runtime on a Linux x64 runner');
const version=process.env.RSSD_RELEASE_VERSION||JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version||''))throw Error('Set RSSD_RELEASE_VERSION to a release version');
const result=spawnSync(process.execPath,['desktop/scripts/prepare-workbench.mjs'],{cwd:root,stdio:'inherit',env:{...process.env,RSSD_HEADLESS_BUILD:'1'}});
if(result.status!==0)throw Error('Runtime preparation failed');
const source=join(root,'desktop/target/bundle-resources/workbench'),files={};
async function scan(folder,prefix=''){
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const name=prefix+entry.name,path=join(folder,entry.name);
    if(entry.isSymbolicLink())throw Error('Runtime contains a symlink: '+name);
    if(entry.isDirectory())await scan(path,name+'/');
    else if(entry.isFile()){const bytes=await readFile(path),mode=(await lstat(path)).mode;files[name]={sha256:createHash('sha256').update(bytes).digest('hex'),executable:name==='node'||Boolean(mode&0o111)};}
    else throw Error('Unsupported artifact entry: '+name);
  }
}
await chmod(join(source,'node'),0o755);await scan(source);
const manifest={version,protocol:1,platform:process.platform,arch:process.arch,source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files};
const bytes=JSON.stringify(manifest,null,2)+'\n';await writeFile(join(source,'runtime-manifest.json'),bytes);
const output=join(root,'artifacts');await mkdir(output,{recursive:true});const archive=`rssd-headless-${version}-linux-x64.tar.gz`;
const tar=spawnSync('tar',['-czf',join(output,archive),'-C',source,'.'],{stdio:'inherit'});if(tar.status!==0)throw Error('Headless packaging failed');
const hash=createHash('sha256').update(await readFile(join(output,archive))).digest('hex');
await writeFile(join(output,'SHA256SUMS.txt'),`${hash}  ${archive}\n`);
await writeFile(join(output,'runtime-manifest.sha256'),createHash('sha256').update(bytes).digest('hex')+'\n');
console.log(JSON.stringify({archive,sha256:hash,files:Object.keys(files).length,version}));
