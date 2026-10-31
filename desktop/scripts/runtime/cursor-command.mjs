import {existsSync,readdirSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,dirname,delimiter} from 'node:path';
import {homedir} from 'node:os';
export function cursorCommand(args=[]){
  if(process.platform==='win32'){
    const base=join(process.env.LOCALAPPDATA||join(homedir(),'AppData/Local'),'cursor-agent');
    const versions=join(base,'versions');
    const dirs=[base,...(existsSync(versions)?readdirSync(versions).sort().reverse().map(x=>join(versions,x)):[])];
    for(const dir of dirs)if(existsSync(join(dir,'node.exe'))&&existsSync(join(dir,'index.js')))return {command:join(dir,'node.exe'),args:[join(dir,'index.js'),...args]};
  }
  for(const dir of [join(homedir(),'.local/bin'),...(process.env.PATH||'').split(delimiter)])for(const name of process.platform==='win32'?['cursor-agent.exe','agent.exe']:['cursor-agent','agent']){const path=join(dir,name);if(existsSync(path)){
    if(process.platform!=='win32')return unixCursorCommand(path,args);
    return {command:path,args};
  }}
  throw Error('未找到 Cursor CLI，请在设置中打开官方安装说明，安装后重试');
}
// The official Unix launcher runs a version probe with inherited stdin. Keep
// that probe off the ACP pipe and give the protocol a single stdin consumer.
export function unixCursorCommand(path,args=[]){
  const dir=dirname(realpathSync(path)),node=join(dir,'node'),entry=join(dir,'index.js');
  if(!existsSync(node)||!existsSync(entry))return {command:path,args};
  const ca=spawnSync(node,['--use-system-ca','--version'],{stdio:'ignore',timeout:3000}).status===0;
  return {command:node,args:[...(ca?['--use-system-ca']:[]),entry,...args]};
}
export function cursorEnvironment(extra={}){
  const env={...process.env,...extra};
  // Website authorization belongs to the native workbench, not the model process.
  delete env.SCHOLAY_TODAY_TOKEN;delete env.SCHOLAY_TODAY_TOKEN_FILE;
  env.PATH=[join(homedir(),'.local/bin'),...(process.platform==='win32'?[]:['/opt/homebrew/bin','/opt/homebrew/opt/node@24/bin']),process.env.PATH].filter(Boolean).join(delimiter);
  return env;
}
