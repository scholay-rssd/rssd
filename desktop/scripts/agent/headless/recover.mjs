import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSiteId,headlessHome,repoRoot} from './env.mjs';
import {headlessEntry} from './update.mjs';

export function recoveryPlan(home,site,section,mode='observation'){
 site=canonicalSiteId(site);
 if(!/^[a-z][a-z0-9-]{1,79}$/.test(section||''))throw Error('invalid section');
 const dir=join(home,'results'),prefix=site+'-'+section+'-';
 const names=existsSync(dir)?readdirSync(dir).filter(n=>n.startsWith(prefix)&&/^\d+\.result\.json$/.test(n.slice(prefix.length))).sort((a,b)=>Number(b.slice(prefix.length).split('.')[0])-Number(a.slice(prefix.length).split('.')[0])):[];
 const file=names.length?join(dir,names[0]):null;
 // Malformed receipts stop recovery; never silently start a second article.
 const saved=file?JSON.parse(readFileSync(file,'utf8')):null;
 if(saved?.site&&saved.site!==site||saved?.sectionId&&saved.sectionId!==section)throw Error('recovery result identity mismatch');
 const done=!!(saved?.publicReadback||saved?.noPublish===true&&saved.canonicalPath&&!saved.error);
 const brief=saved?.briefFile||join(home,'briefs',prefix.slice(0,-1)+'.txt');
 if(!done&&!saved?.taskId&&!existsSync(brief))throw Error('no brief and no task to resume');
 return {done,file,args:[site,section,saved?.mode||mode,brief,...(saved?.taskId?['--resume',saved.taskId]:[]),...(saved?.noPublish?['--no-publish']:[])]};
}

export async function recover([site,section,mode]=process.argv.slice(2)){
 const plan=recoveryPlan(headlessHome(),site,section,mode);
 if(plan.done){console.log('Already finished:',plan.file);return 0;}
 const child=spawn(process.execPath,[join(repoRoot,'desktop/scripts/agent/headless/produce.mjs'),...plan.args],{stdio:'inherit'});
 return new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))headlessEntry('recover',process.argv.slice(2),()=>recover()).then(code=>{process.exitCode=code;}).catch(e=>{console.error(e.message);process.exitCode=1;});
