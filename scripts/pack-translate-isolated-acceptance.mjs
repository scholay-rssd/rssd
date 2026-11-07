import {createHash} from 'node:crypto';
import {cp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const staging=join('/tmp','rssd-t575-isolated-stage');
const adapterSpec='@agentclientprotocol/codex-acp@2.2.2';
const starts=[
  'scripts/rssd-translate-isolated-acceptance.mjs',
  'desktop/runtime/package.json',
  'docs/rssd-translate-isolated-acceptance.md',
];
const extensions=['','.mjs','.cjs','.js','.json'];
async function resolveImport(from,spec){
  if(!spec.startsWith('.'))return null;
  const base=join(dirname(from),spec);
  for(const ext of extensions){
    const candidate=base+ext;
    try{if((await stat(candidate)).isFile())return candidate;}catch{}
  }
  for(const ext of ['/index.mjs','/index.cjs','/index.js']){
    const candidate=base+ext;
    try{if((await stat(candidate)).isFile())return candidate;}catch{}
  }
  throw Error('Unresolved import '+spec+' from '+relative(root,from));
}
async function collect(start){
  const seen=new Set(),queue=[join(root,start)];
  while(queue.length){
    const file=queue.pop();
    if(seen.has(file))continue;
    seen.add(file);
    if(!/\.(mjs|cjs|js)$/.test(file))continue;
    const text=await readFile(file,'utf8');
    const specs=[...text.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g),...text.matchAll(/new URL\(['"](\.[^'"]+)['"]/g)].map(m=>m[1]);
    for(const spec of specs){const resolved=await resolveImport(file,spec);if(resolved)queue.push(resolved);}
  }
  return [...seen];
}

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
  const needed=new Set();
  for(const start of starts)for(const file of await collect(start))needed.add(file);
  for(const file of needed){
    const rel=relative(root,file);
    await mkdir(dirname(join(staging,rel)),{recursive:true});
    await cp(file,join(staging,rel));
  }
  await cp(join(root,'docs/rssd-translate-isolated-acceptance.md'),join(staging,'README.md'));
  const runtime=join(staging,'desktop/runtime');
  const adapterPrefix=join('/tmp','rssd-t575-adapter');
  await rm(adapterPrefix,{recursive:true,force:true});
  await mkdir(adapterPrefix,{recursive:true});
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--prefix',adapterPrefix,adapterSpec],{cwd:root,stdio:'inherit'});
  await mkdir(join(runtime,'node_modules'),{recursive:true});
  await cp(join(adapterPrefix,'node_modules','@agentclientprotocol'),join(runtime,'node_modules','@agentclientprotocol'),{recursive:true});
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--prefix',staging,'markdown-it@14.1.0'],{cwd:root,stdio:'inherit'});
  const inventory=[];
  for(const path of (await listFiles(staging)).sort()){
    const rel=relative(staging,path);
    if(rel.includes('node_modules/.package-lock.json'))continue;
    inventory.push({path:rel,sha256:sha256(await readFile(path)),bytes:(await stat(path)).size});
  }
  const manifest={
    authorization:'t575',head,packedAt:new Date().toISOString(),
    producer:'desktop/scripts/agent/center-producer.mjs',producerExport:'produceCenterEdition',
    adapter:adapterSpec,writingPolicy:'private-notes-first-pass-v2',
    workId:'work-t575-isolated-acceptance',liveCenter:false,credentialsPacked:false,
    files:inventory,
  };
  await writeFile(join(staging,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
  const artifactDir='/opt/cursor/artifacts';
  await mkdir(artifactDir,{recursive:true});
  const tarName='rssd-t575-isolated-acceptance.tar.gz';
  const tmpTar=join('/tmp',tarName);
  execFileSync('tar',['-czf',tmpTar,'-C',staging,'.'],{stdio:'inherit'});
  const tar=join(artifactDir,tarName);
  await cp(tmpTar,tar);
  const sum=sha256(await readFile(tar));
  await writeFile(join(artifactDir,'rssd-t575-isolated-acceptance.sha256'),sum+'  '+tarName+'\n');
  await cp(join(staging,'README.md'),join(artifactDir,'rssd-t575-isolated-acceptance.md'));
  await cp(join(staging,'MANIFEST.json'),join(artifactDir,'rssd-t575-isolated-acceptance.manifest.json'));
  console.log(JSON.stringify({tar,sha256:sum,head,files:inventory.length},null,2));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
