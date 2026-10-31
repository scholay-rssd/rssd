#!/usr/bin/env node
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {prepareReviewedTranslationCorrectionFromFile} from './publishing-flow-translation-correction.mjs';

if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===await realpath(fileURLToPath(import.meta.url))){
 try{if(process.argv.length!==3)throw Error('Usage: publishing-flow-translation-correction-cli.mjs <exact-reviewed-correction.json>');console.log(JSON.stringify(await prepareReviewedTranslationCorrectionFromFile(process.argv[2])));}catch(error){console.error(error.message);process.exitCode=1;}
}
