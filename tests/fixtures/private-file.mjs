import {chmod} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';

// chmod(0644) cannot grant another user access on Windows. Exercise the actual
// ACL instead, using the language-independent Everyone SID on a fixture only.
export async function makePublic(file){
 if(process.platform==='win32'){
  await promisify(execFile)(join(process.env.SystemRoot,'System32/icacls.exe'),[file,'/grant','*S-1-1-0:R'],{windowsHide:true});
 }else await chmod(file,0o644);
}
