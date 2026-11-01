import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'desktop/src/center/shared'),target=join(root,'center/rssd/ui');
const files=['CenterView.tsx','center-view.css','navigation.ts'];
const records=[];
for(const path of files){
  const bytes=await readFile(join(source,path));
  records.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(process.argv.includes('--check')){
    if(!(await readFile(join(target,path))).equals(bytes))throw Error('Center UI differs from its canonical source: '+path);
  }else{await mkdir(target,{recursive:true});await writeFile(join(target,path),bytes);}
}
const manifest={version:1,uiVersion:'0.16.8',source:'https://github.com/scholay-rssd/rssd/tree/main/desktop/src/center/shared',license:'MIT',files:records};
if(process.argv.includes('--check')){
  const existing=JSON.parse(await readFile(join(target,'manifest.json'),'utf8'));
  if(JSON.stringify(existing)!==JSON.stringify(manifest))throw Error('Center UI version manifest differs');
}else await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sharedUi:manifest.uiVersion,files:files.length,mode:process.argv.includes('--check')?'verified':'synced'}));
