// Restrict the Codex ACP session used for automatic topic production. This
// reads server names only; configuration values and credentials never enter
// CODEX_CONFIG. An unreadable or invalid TOML file stops the worker.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {access} from 'node:fs/promises';
const run=promisify(execFile);
const parseNames=String.raw`
import os,re,sys,json
try:
 import tomllib
except ImportError:
 sys.exit(42)
files=[]
for path in sys.argv[1:]:
 if path not in files: files.append(path)
names=set()
for path in files:
 try:
  try:
   with open(path,'rb') as f: doc=tomllib.load(f)
  except FileNotFoundError:
   continue
  servers=doc.get('mcp_servers',{})
  if not isinstance(servers,dict): raise ValueError('invalid servers')
  for name in servers:
   if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',name): raise ValueError('invalid server name')
   names.add(name)
 except Exception:
  print('invalid-config',file=sys.stderr);sys.exit(1)
print(json.dumps(sorted(names)))
`;

export async function configuredMcpNames(paths,{pythonCandidates=['/opt/homebrew/bin/python3','/usr/local/bin/python3','/usr/bin/python3'],environment={}}={}) {
  for(const python of pythonCandidates){
    try{await access(python);}catch{continue;}
    try{
      const {stdout}=await run(python,['-c',parseNames,...paths],{env:environment,timeout:10000,maxBuffer:100000});
      const names=JSON.parse(stdout);
      if(!Array.isArray(names)||names.some(x=>typeof x!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(x)))throw Error('Invalid server name list');
      return names;
    }catch(error){if(error.code===42)continue;throw Error('Unable to inspect Codex configuration safely');}
  }
  throw Error('Python 3.11 or newer is required to inspect Codex configuration');
}

export async function pilotCodexEnvironment(baseEnv,{cwd,inspect=configuredMcpNames}={}) {
  if(typeof cwd!=='string'||!cwd)throw Error('Codex working directory is required');
  const allowed=['HOME','USER','LOGNAME','PATH','SHELL','LANG','TMPDIR','CODEX_HOME','CODEX_PATH','SYSTEMROOT','WINDIR'];
  const env=Object.fromEntries(allowed.filter(k=>baseEnv[k]!==undefined).map(k=>[k,baseEnv[k]]));
  const configRoot=env.CODEX_HOME||join(homedir(),'.codex');
  const paths=[join(configRoot,'config.toml')];
  for(let current=resolve(cwd);;current=dirname(current)){
    paths.push(join(current,'.codex','config.toml'));
    if(current===dirname(current))break;
  }
  const names=await inspect([...new Set(paths)],{environment:env});
  env.CODEX_CONFIG=JSON.stringify({model:'gpt-6.1-terra',model_reasoning_effort:'max',notify:[],features:{hooks:false,plugins:false,apps:false,computer_use:false,browser_use:false,code_mode_host:false},mcp_servers:Object.fromEntries(names.map(name=>[name,{enabled:false}]))});
  return env;
}
