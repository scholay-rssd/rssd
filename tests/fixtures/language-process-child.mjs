import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
const [mode,receipt]=process.argv.slice(2);
const worker=spawn(process.execPath,['-e',mode==='stubborn'?"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)":"console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','inherit']});
const ready=new Promise(resolve=>worker.stdout.once('data',()=>{
 writeFileSync(receipt,JSON.stringify({pid:process.pid,worker:worker.pid}));
 process.stdout.write('ready\n');
 resolve();
}));
if(mode==='stubborn'){process.on('SIGTERM',()=>{});process.stdin.resume();}
else{
 process.on('SIGTERM',()=>{writeFileSync(receipt+'.signal','SIGTERM');});
 process.stdin.resume();
 process.stdin.on('end',()=>{writeFileSync(receipt+'.eof','received');worker.kill();worker.once('close',()=>process.exit(0));});
 if(mode==='rpc-timeout'){
  createInterface({input:process.stdin}).on('line',async line=>{
   await ready;
   const request=JSON.parse(line);
   if(request.method==='session/prompt')return;
   process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:request.method==='session/new'?{sessionId:'fixture'}:{protocolVersion:1}})+'\n');
  });
 }
}
