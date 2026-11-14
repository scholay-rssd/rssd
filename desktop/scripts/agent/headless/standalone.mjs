#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {withRuntimeLease,installRuntime} from './artifact-runtime.mjs';
import {ARTICLE_WRITING_INSTRUCTIONS,ARTICLE_WRITING_POLICY} from '../../../../contracts/article-writing-policy.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const [command,...args]=process.argv.slice(2);
try{
  if(command==='version')console.log(await readFile(join(root,'runtime-manifest.json'),'utf8').then(text=>{const m=JSON.parse(text);return JSON.stringify({version:m.version,protocol:m.protocol,platform:m.platform,arch:m.arch,source:m.source});}));
  else if(command==='writing-policy')console.log(JSON.stringify({version:ARTICLE_WRITING_POLICY,sha256:createHash('sha256').update(ARTICLE_WRITING_INSTRUCTIONS).digest('hex'),instructions:ARTICLE_WRITING_INSTRUCTIONS}));
  else if(command==='writing-defaults'){const {writingDefaultsCommand}=await import('../../../../scripts/writing-defaults-cli.mjs');if((await writingDefaultsCommand(args))?.ok===false)process.exitCode=1;}
  else if(command==='install'||command==='update'){
    const source=args[0]&&!args[0].startsWith('--')?resolve(args[0]):root;
    const index=args.indexOf('--manifest-sha256'),expectedManifestHash=index<0?undefined:args[index+1];
    if(index>=0&&!/^[a-f0-9]{64}$/.test(expectedManifestHash||''))throw Error('Provide a complete manifest SHA-256');
    console.log(JSON.stringify(await installRuntime(source,{expectedManifestHash})));
  }else if(command==='center'){const {centerCommand}=await import('./center.mjs');await withRuntimeLease(()=>centerCommand(args));}
  else if(!command||['help','--help','-h'].includes(command))console.log('RSSD headless\n  install [extracted-runtime] [--manifest-sha256 SHA256]\n  update <extracted-runtime> [--manifest-sha256 SHA256] (idle only)\n  version | writing-policy\n  center connect|status|registry|demands|store-en|enqueue-translate|claim|submit|recover|work\nRun center --help for production options. Device state stays outside runtime releases.');
  else throw Error('Unknown command; use rssd --help');
}catch(error){console.error(error.message);process.exitCode=1;}
