#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {updateRuntime,updateCommand,runtimeLease,installationRoot} from './update.mjs';
import {ARTICLE_WRITING_POLICY,ARTICLE_WRITING_INSTRUCTIONS} from '../../../../contracts/article-writing-policy.mjs';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const [cmd,...rest]=process.argv.slice(2);
if(cmd==='writing-policy'){
 // Read-only onboarding: no automatic update, runtime lease, auth or workspace writes.
 if(rest.length){console.error('Usage: npm run headless -- writing-policy');process.exitCode=1;}
 else console.log(JSON.stringify({version:ARTICLE_WRITING_POLICY,source:'contracts/article-writing-policy.mjs',sha256:createHash('sha256').update(ARTICLE_WRITING_INSTRUCTIONS).digest('hex'),instructions:ARTICLE_WRITING_INSTRUCTIONS}));
}else if(cmd==='center'){
 // Center production is pinned to this installed runtime, not a private Git pull.
 const release=await runtimeLease();
 try{const {centerCommand}=await import('./center.mjs');await centerCommand(rest);}
 catch(error){console.error('中心任务：'+error.message);process.exitCode=1;}
 finally{await release();}
}else if(cmd==='update'){
 try{console.log(JSON.stringify(await updateCommand(rest)));}catch(error){console.error('更新失败：'+error.message);process.exitCode=1;}
}else{
const scripts={
 agents:join(here,'agents.mjs'),
 produce:join(here,'produce.mjs'),
 spaces:join(here,'spaces.mjs'),
 verify:join(here,'verify.mjs'),
 briefs:join(here,'briefs.py'),
 queue:join(here,'queue.sh'),
 recover:join(here,'recover.mjs'),
 flow:join(here,'../../../../scripts/publishing-flow-cli.mjs'),
 jobs:join(here,'jobs.mjs'),
};
if(!cmd||cmd==='-h'||cmd==='--help'||!scripts[cmd]){
 console.log('Usage: npm run headless -- <center|produce|spaces|verify|briefs|queue|recover|agents|flow|jobs|update|writing-policy> ...');
 console.log('  center connect|status|registry|demands|enqueue-translate|claim|submit|recover|work — shared RSSD center production');
 console.log('  writing-policy — read the current project writing protocol; no initialization or mutations');
 console.log('  jobs <site> list|status <articleId>|resume <articleId>|enqueue <articleId> --confirmed — durable asynchronous publication');
 console.log('  flow <site> configure <policy.json>|enqueue <articleId>|tick|drain|status — opt-in language/link handoff');
 console.log('  update [check|apply|on|off|status] — idle-only private repository updates');
 console.log('  produce <site> <sectionId> <mode> <briefFile> [--no-publish] [--resume <taskId>] [--agent <agentId>] [--allow-network] [--mount spec] [--mounts file.json]');
 console.log('  agents <siteId> [list|check|default|login] [agentId]');
 console.log('  spaces <siteId> [siteId...]');
 console.log('  verify <siteId>');
 console.log('  briefs');
 console.log('  queue <siteId> <section:mode> [section:mode...]');
 console.log('  recover <siteId> <sectionId>');
 process.exit(cmd&&cmd!=='-h'&&cmd!=='--help'?1:0);
}
let updated=false;
if(process.env.SCHOLAY_HEADLESS_SKIP_UPDATE!=='1'){
 try{updated=(await updateRuntime({apply:true,automatic:true})).status==='updated';}
 catch(error){console.error('自动更新暂不可用，保留现有版本：'+error.message);if(error.updated)process.exit(1);}
}
const release=await runtimeLease();
try{
 const command=updated?[process.execPath,fileURLToPath(import.meta.url),cmd,...rest]:cmd==='briefs'?['python3',scripts[cmd],...rest]:cmd==='queue'?['bash',scripts[cmd],...rest]:[process.execPath,scripts[cmd],...rest];
 const env={...process.env,SCHOLAY_HEADLESS_NODE:process.execPath,SCHOLAY_HEADLESS_HOME:process.env.SCHOLAY_HEADLESS_HOME||join(installationRoot,'.local/headless'),SCHOLAY_HEADLESS_SKIP_UPDATE:'1'};
 const child=spawn(command[0],command.slice(1),{stdio:'inherit',env});
 const interrupt=()=>child.kill('SIGINT'),terminate=()=>child.kill('SIGTERM');process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
 process.exitCode=await new Promise((ok,fail)=>{child.on('error',fail);child.on('exit',code=>ok(code??1));});
 process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
}finally{await release();}
}
