// Syntax-check every tracked server, CLI and public script, so a new module is
// covered without editing package.json. Only the website and headless trees are
// scanned; the desktop app and Theme homepages keep their own toolchains.
import {execFileSync,execFile} from 'node:child_process';
import {availableParallelism} from 'node:os';
import {promisify} from 'node:util';

const roots=['admin','receiver','contracts','scripts','web/engine','web/modules','web/themes/academic','web/themes/journal','web/themes/structures.mjs','web/demo','desktop/scripts/agent'];
const files=execFileSync('git',['ls-files','-z','--',...roots],{encoding:'utf8'}).split('\0').filter(file=>/\.[mc]?js$/.test(file));
const run=promisify(execFile),failures=[];let next=0;
await Promise.all(Array.from({length:Math.min(8,availableParallelism())},async()=>{
  while(next<files.length){
    const file=files[next++];
    try{await run(process.execPath,['--check',file]);}catch(error){failures.push(file+'\n'+String(error.stderr||error.message).trim());}
  }
}));
if(failures.length){console.error(failures.join('\n\n'));process.exit(1);}
console.log('Syntax OK: '+files.length+' files');
