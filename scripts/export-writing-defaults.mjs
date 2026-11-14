#!/usr/bin/env node
// Export only reviewed public rule inputs, never workspace files or secrets.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildWritingDefaultsCatalog,WRITING_RULE_PATHS} from '../contracts/writing-defaults.mjs';
export const WRITING_DEFAULT_INPUTS=['contracts/writing-defaults-v1.cjs','contracts/writing-defaults.mjs','contracts/writing-column-families.json','contracts/article-writing-policy.mjs','contracts/editorial-column-policy.mjs','contracts/site-sections.mjs','sites/profiles.json',...WRITING_RULE_PATHS];
const root=fileURLToPath(new URL('../',import.meta.url));
export function exportWritingDefaults(directory){
 const git=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
 const inputs=WRITING_DEFAULT_INPUTS.filter(x=>!x.startsWith('sites/'));
 git(['ls-files','--error-unmatch',...inputs]);
 git(['diff','--exit-code','HEAD','--',...inputs,'sites']);
 const source={repository:'scholay-rssd/rssd',commit:git(['rev-parse','HEAD']),files:WRITING_DEFAULT_INPUTS.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}))};
 const catalog=buildWritingDefaultsCatalog({source});
 mkdirSync(directory,{recursive:true});
 writeFileSync(join(directory,'writing-defaults.catalog.json'),JSON.stringify(catalog,null,2)+'\n');
 writeFileSync(join(directory,'writing-defaults-v1.cjs'),readFileSync(join(root,'contracts/writing-defaults-v1.cjs')));
 const manifest={...source,catalogHash:catalog.hash,version:catalog.version,files:['writing-defaults.catalog.json','writing-defaults-v1.cjs'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(directory,path))).digest('hex')}))};
 writeFileSync(join(directory,'writing-defaults.source.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{if(process.argv.length!==3)throw Error('Usage: node scripts/export-writing-defaults.mjs <output-directory>');console.log(JSON.stringify(exportWritingDefaults(resolve(process.argv[2])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
