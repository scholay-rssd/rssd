import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const exec=promisify(execFile);
// Node's Windows mode bits do not describe access control. Query SIDs instead
// of localized account names, and recheck on every read (including rotation).
// Use .NET directly so the bundled Windows PowerShell does not try to load
// incompatible modules from a parent PowerShell 7 session's PSModulePath.
const aclScript=`
$ErrorActionPreference = 'Stop'
$path = $env:SCHOLAY_PRIVATE_FILE_PATH
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
if ($env:SCHOLAY_PRIVATE_FILE_ACTION -eq 'protect') {
  $acl = [System.Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner($user)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in $trusted) {
    $identity = [System.Security.Principal.SecurityIdentifier]::new($sid)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow'))
  }
  [System.IO.File]::SetAccessControl($path, $acl)
  exit
}
$acl = [System.IO.File]::GetAccessControl($path)
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
$private = $trusted -contains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if (!$rules.Count) { $private = $false }
foreach ($rule in $rules) {
  if ($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value) { $private = $false }
}
if ($private) { 'private' } else { 'public' }
`;
async function windowsAcl(file,action){
 const shell=join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const {stdout}=await exec(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command',aclScript],{
  windowsHide:true,timeout:30000,maxBuffer:65536,
  env:{...process.env,SCHOLAY_PRIVATE_FILE_PATH:resolve(file),SCHOLAY_PRIVATE_FILE_ACTION:action},
 });
 return stdout.trim()==='private';
}
export async function isPrivateFile(file,info){
 info??=await stat(file);
 if(!info.isFile())return false;
 if(process.platform!=='win32')return !(info.mode&0o077);
 try{return await windowsAcl(file,'check');}catch{return false;}
}
// Call on a newly created, empty temporary file before writing credentials.
// POSIX callers create that file with mode 0600 already.
export async function protectPrivateFile(file){
 if(process.platform==='win32')await windowsAcl(file,'protect');
}
