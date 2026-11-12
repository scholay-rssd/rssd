import {readFile,writeFile,mkdir,readdir,cp,access} from 'node:fs/promises';
import {resolve,relative,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {packageWebEngine} from './package-web-engine.mjs';
import {portableNode} from '../desktop/scripts/runtime/portable-node.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function filesAt(directory,prefix=''){
 const files=[];for(const item of await readdir(directory,{withFileTypes:true})){
  const name=prefix+item.name;if(item.isSymbolicLink())throw Error('Unexpected artifact symlink: '+name);
  if(item.isDirectory())files.push(...await filesAt(join(directory,item.name),name+'/'));else if(item.isFile())files.push(name);
 }return files;
}
export async function packageReceiver(target){
 target=resolve(target);if(!target.startsWith(join(root,'.local')+sep))throw Error('Build into a new .local directory');
 try{await access(target);throw Error('Refusing to overlay an existing receiver artifact');}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(target,{recursive:true});await packageWebEngine(target,{academic:true});
 const copy=async name=>{if(!/^(receiver|contracts|scripts|admin|web|sites)(?:\/|$)/.test(name)||name.includes('..')||name.includes('/homepage/'))throw Error('Unexpected runtime input: '+name);await mkdir(dirname(join(target,name)),{recursive:true});await cp(join(root,name),join(target,name),{recursive:true});};
 for(const name of ['receiver','contracts','sites/profiles.json','sites/site-theme.css','sites/site-calendar.js','sites/branding','sites/organization','sites/about'])await copy(name);
 // Follow only literal relative module imports. Content seeds, editorial sources,
 // Next homepage projects, private configuration and repository metadata are never inputs.
 const checked=new Set();
 for(;;){
  const pending=(await filesAt(target)).filter(f=>/\.(?:cjs|mjs)$/.test(f)&&!checked.has(f));if(!pending.length)break;
  for(const name of pending){checked.add(name);const source=await readFile(join(target,name),'utf8');
   for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"\n]+)['"]/g)){
    const dependency=relative(root,resolve(dirname(join(root,name)),match[1].split(/[?#]/)[0])).replaceAll('\\','/');
    try{await access(join(target,dependency));}catch(error){if(error.code!=='ENOENT')throw error;await copy(dependency);}
   }
  }
 }
 for(const name of ['LICENSE','NOTICE.md','package-lock.json'])await cp(join(root,name),join(target,name));
 for(const name of ['web/themes/LICENSE','web/themes/NOTICE.md','sites/LICENSE','sites/NOTICE.md'])await cp(join(root,name),join(target,name));
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 await writeFile(join(target,'package.json'),JSON.stringify({...pkg,name:'rssd',scripts:{start:'node receiver/server.mjs'}},null,2)+'\n');
 const sourceFiles=await filesAt(target);if(sourceFiles.some(f=>/^(desktop|editorial|\.git|\.local)\/|(^|\/)\.env|^sites\/seeds\//.test(f)))throw Error('Non-runtime files reached the artifact');
 return {target,files:sourceFiles.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.platform!=='linux'||process.arch!=='x64')throw Error('Build the receiver on Linux x64 CI');
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),target=join(root,'.local','receiver-artifact-'+revision);
 await packageReceiver(target);
 const portable=await portableNode(join(root,'.local','receiver-node-runtime'));
 await cp(portable,join(target,'node'));await cp(join(dirname(portable),'../LICENSE'),join(target,'NODE-LICENSE'));
 const install=spawnSync('npm',['ci','--omit=dev','--bin-links=false','--no-audit','--no-fund'],{cwd:target,stdio:'inherit'});if(install.status!==0)throw Error('Receiver dependencies failed to install');
 const files={};for(const name of await filesAt(target))files[name]=hash(await readFile(join(target,name)));
 await writeFile(join(target,'artifact-manifest.json'),JSON.stringify({version:1,protocolVersion:1,revision,platform:'linux-x64',node:'24',files},null,2)+'\n');
 const smoke=spawnSync(join(target,'node'),['--input-type=module','-e',"await import('./receiver/server.mjs'); console.log('Receiver artifact imports successfully')"],{cwd:target,stdio:'inherit'});if(smoke.status!==0)throw Error('Receiver artifact cannot start');
 const output=join(root,'artifacts');await mkdir(output,{recursive:true});const archive='rssd-web-receiver-'+revision+'-linux-x64.tar.gz';
 const tar=spawnSync('tar',['-czf',join(output,archive),'-C',target,'.'],{stdio:'inherit'});if(tar.status!==0)throw Error('Receiver packaging failed');
 await writeFile(join(output,archive+'.sha256'),hash(await readFile(join(output,archive)))+'  '+archive+'\n');console.log(JSON.stringify({archive,files:Object.keys(files).length,revision}));
}
