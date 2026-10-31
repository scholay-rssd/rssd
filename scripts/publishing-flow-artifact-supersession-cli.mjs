#!/usr/bin/env node
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {supersedeCloudContinuationArtifactFromFile} from './publishing-flow-artifact-supersession.mjs';
export async function run(args=process.argv.slice(2)){
 if(args.length!==1)throw Error('Use one exact reviewed artifact supersession JSON input');
 return supersedeCloudContinuationArtifactFromFile(args[0]);
}
if(process.argv[1]&&await realpath(process.argv[1])===await realpath(fileURLToPath(import.meta.url))){try{console.log(JSON.stringify(await run()));}catch(error){console.error(error.message);process.exitCode=1;}}
