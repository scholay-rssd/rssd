import {createHash} from 'node:crypto';
import {cp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const staging=join('/tmp','rssd-t575-isolated-stage');
const adapterSpec='@agentclientprotocol/codex-acp@2.2.2';
const trees=['contracts','scripts','desktop/scripts/agent','desktop/scripts/runtime'];
const files=['desktop/runtime/package.json','tests/fixtures/rssd-translate-center.mjs','sites/profiles.json','docs/rssd-translate-isolated-acceptance.md'];

async function listFiles(dir,out=[]){
  for(const name of await readdir(dir)){
    if(name==='.git'||name.endsWith('.map')||name==='.package-lock.json')continue;
    const path=join(dir,name),info=await stat(path);
    if(info.isDirectory())await listFiles(path,out);
    else out.push(path);
  }
  return out;
}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
async function main(){
  await rm(staging,{recursive:true,force:true});
  await mkdir(staging,{recursive:true,mode:0o700});
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  for(const tree of trees)await cp(join(root,tree),join(staging,tree),{recursive:true});
  for(const file of files){
    await mkdir(dirname(join(staging,file)),{recursive:true});
    await cp(join(root,file),join(staging,file));
  }
  await cp(join(root,'docs/rssd-translate-isolated-acceptance.md'),join(staging,'README.md'));
  const runtime=join(staging,'desktop/runtime');
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--prefix',runtime,adapterSpec],{cwd:root,stdio:'inherit'});
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--prefix',staging,'markdown-it@14.1.0'],{cwd:root,stdio:'inherit'});
  const entries=[];
  for(const path of (await listFiles(staging)).sort()){
    const rel=relative(staging,path);
    if(rel.includes('node_modules/.package-lock.json'))continue;
    entries.push({path:rel,sha256:sha256(await readFile(path)),bytes:(await stat(path)).size});
  }
  const manifest={
    authorization:'t575',head,packedAt:new Date().toISOString(),
    producer:'desktop/scripts/agent/center-producer.mjs',producerExport:'produceCenterEdition',
    adapter:adapterSpec,writingPolicy:'private-notes-first-pass-v2',
    workId:'work-t575-isolated-acceptance',liveCenter:false,credentialsPacked:false,
    files:entries,
  };
  await writeFile(join(staging,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
  const artifactDir='/opt/cursor/artifacts';
  await mkdir(artifactDir,{recursive:true});
  const tar=join(artifactDir,'rssd-t575-isolated-acceptance.tar.gz');
  execFileSync('tar',['-czf',tar,'-C',staging,'.'],{stdio:'inherit'});
  const sum=sha256(await readFile(tar));
  await writeFile(join(artifactDir,'rssd-t575-isolated-acceptance.sha256'),sum+'  rssd-t575-isolated-acceptance.tar.gz\n');
  await cp(join(staging,'README.md'),join(artifactDir,'rssd-t575-isolated-acceptance.md'));
  await cp(join(staging,'MANIFEST.json'),join(artifactDir,'rssd-t575-isolated-acceptance.manifest.json'));
  console.log(JSON.stringify({tar,sha256:sum,head,files:entries.length},null,2));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
