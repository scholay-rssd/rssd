#!/usr/bin/env node
import {resolve,join,dirname} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {authoringWritingDefaults,writingConnectionHome,configuredWritingDefaultsReader} from './rssd-writing-defaults.mjs';
import contract from '../contracts/writing-defaults-v1.cjs';
import {writeWritingJson} from './rssd-writing-defaults.mjs';
import {writingDraftRequest} from './writing-draft-request.mjs';

export async function writingDefaultsCommand(argv,{emit=value=>console.log(JSON.stringify(value))}={}){
 const options={};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(key==='--list'){options.list=true;continue;}if(key==='--file-draft'){options.fileDraft=true;continue;}
  if(!['--workspace','--section','--session','--overrides','--center-home','--origin','--output','--install','--check','--context','--assets','--request','--brief','--feedback','--topic-check','--topic-key'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--')||options[key]!==undefined)throw Error('Usage: writing-defaults --workspace <id> --section <id> [--session <id>] [--overrides <file.json>] [--output <context.json>] [--origin <https://center>] | --list | --install <workspace> --workspace <id> | --request <context.json> --brief <brief.txt> --output <request.txt> | --check <draft.json> --context <context.json> --assets <assets.json> | --feedback <raw-output.txt> --file-draft --context <context.json> --brief <brief.txt> --assets <assets.json> --output <feedback.txt> | --topic-check <title> --workspace <id> --section <id> [--topic-key <key>]');
  options[key]=argv[++i];
 }
 if(options['--feedback']){
  if(!options['--context']||!options['--brief']||!options['--assets']||!options['--output']||options['--request']||options['--check']||options.list||options['--install'])throw Error('--feedback requires --file-draft, --context, --brief, --assets and --output as a separate operation');
  const {writingFeedback}=await import('./writing-feedback.mjs');const result=await writingFeedback({draftFile:resolve(options['--feedback']),contextFile:resolve(options['--context']),briefFile:resolve(options['--brief']),assetsFile:resolve(options['--assets']),outputFile:resolve(options['--output']),fileDraft:options.fileDraft});emit(result);return result;
 }
 if(options['--request']){
  if(!options['--brief']||!options['--output']||options['--check']||options.list||options['--install'])throw Error('--request requires --brief and --output as a separate operation');
  const input=resolve(options['--request']),briefFile=resolve(options['--brief']),output=resolve(options['--output']);
  if(output===input||output===briefFile)throw Error('Request output must differ from the context and brief files');
  const context=JSON.parse(await readFile(input,'utf8')),prompt=writingDraftRequest({context,brief:await readFile(briefFile,'utf8')});
  await mkdir(dirname(output),{recursive:true});await writeFile(output,prompt,{mode:0o600});
  const result={state:'ready',file:output,baselineHash:context.baselineHash,requestHash:contract.textHash(prompt)};emit(result);return result;
 }
 if(options['--topic-check']){
  // Read-only. Listing works needs a Center device credential (RSSD_CENTER_TOKEN or the saved connection).
  if(!options['--workspace']||!options['--section']||options['--check']||options['--request']||options.list||options['--install']||options['--session']||options['--overrides'])throw Error('--topic-check "<title>" requires --workspace and --section and is a separate read');
  const {loadCenterConnection}=await import('./rssd-center-client.mjs'),{topicRepeatCheck}=await import('./rssd-topic-repeat.mjs');
  const home=options['--center-home']?resolve(options['--center-home']):await writingConnectionHome();
  const {client}=await loadCenterConnection(home);
  const result=await topicRepeatCheck({client,workspaceId:options['--workspace'],sectionId:options['--section'],title:options['--topic-check'],topicKey:options['--topic-key']});
  emit(result);return {...result,ok:result.state==='new'};
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
