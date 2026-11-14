#!/usr/bin/env node
import {resolve,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {authoringWritingDefaults,writingConnectionHome,configuredWritingDefaultsReader} from './rssd-writing-defaults.mjs';
import contract from '../contracts/writing-defaults-v1.cjs';
import {writeWritingJson} from './rssd-writing-defaults.mjs';

export async function writingDefaultsCommand(argv,{emit=value=>console.log(JSON.stringify(value))}={}){
 const options={};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(key==='--list'){options.list=true;continue;}
  if(!['--workspace','--section','--session','--overrides','--center-home','--origin','--output','--install','--check','--context','--assets'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--')||options[key]!==undefined)throw Error('Usage: writing-defaults --workspace <id> --section <id> [--session <id>] [--overrides <file.json>] [--output <context.json>] [--origin <https://center>] | --list | --install <workspace> --workspace <id> | --check <draft.json> --context <context.json> --assets <assets.json>');
  options[key]=argv[++i];
 }
 if(options['--check']){if(!options['--context'])throw Error('Provide --context');const {checkWritingDraft}=await import('./check-writing-draft.mjs');const result=await checkWritingDraft({draftFile:resolve(options['--check']),contextFile:resolve(options['--context']),assetsFile:options['--assets']?resolve(options['--assets']):undefined});emit(result);return result;}
 const home=options['--center-home']?resolve(options['--center-home']):await writingConnectionHome();
 const client=await configuredWritingDefaultsReader({home,origin:options['--origin']});
 if(options['--install']){const {installWritingDefaults}=await import('./install-writing-defaults.mjs');const result=await installWritingDefaults({root:resolve(options['--install']),workspaceId:options['--workspace'],origin:client.origin,client});emit(result);return result;}
 if(options.list){if(options['--workspace']||options['--section']||options['--session']||options['--overrides'])throw Error('--list is a separate read');const result=await client.writingDefaultCatalog();emit(result);return result;}
 const workspaceId=options['--workspace'],sectionId=options['--section'],session=options['--session'];
 if(!workspaceId||!sectionId||session&&!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(session))throw Error('Select a workspace, section and a valid writing session ID');
 const local=options['--overrides']?JSON.parse(await readFile(resolve(options['--overrides']),'utf8')):{};
 const binding={kind:'file-authoring',workspaceId,sectionId,...(session?{session}:{})};
 const result=await authoringWritingDefaults({client,workspaceId,sectionId,local,...(session?{directory:join(home,'writing-defaults',contract.hash(binding)),binding}:{})});
 if(options['--output']){await writeWritingJson(resolve(options['--output']),result);emit({state:'ready',file:resolve(options['--output']),version:result.baseline.version,baselineHash:result.baselineHash,catalogHash:result.baseline.catalogHash,sourceCommit:result.baseline.source.commit,adjustmentHash:contract.hash(result.adjustment)});}else emit(result);return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)writingDefaultsCommand(process.argv.slice(2)).then(result=>{if(result?.ok===false)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
