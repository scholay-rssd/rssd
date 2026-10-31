import {homedir} from 'node:os';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {realpath,stat} from 'node:fs/promises';

const FILE_LIMIT=4*1024*1024;
const OUTPUT_LIMIT=200000;
const reserved=new Set(['json','open','print','JSON','console','process','require']);

// This is a positive grammar, not a shell or Python/JavaScript evaluator.
// Only a literal cache path and fixed read/print operations may reach approval.
function shellArguments(command){
 if(typeof command!=='string'||command.length>16000||command.includes('\0'))return null;
 const args=[];let i=0;
 while(i<command.length){
  while(command[i]===' '||command[i]==='\t')i++;
  if(i===command.length)break;
  let value='';const quote=command[i]==='"'||command[i]==="'"?command[i++]:null;
  if(quote){
   let ended=false;
   while(i<command.length){
    const char=command[i++];
    if(char===quote){ended=true;break;}
    if(quote==='"'&&(char==='$'||char==='`'))return null;
    if(quote==='"'&&char==='\\'&&['"','\\','$','`'].includes(command[i]))value+=command[i++];
    else value+=char;
   }
   if(!ended||i<command.length&&!/[ \t]/.test(command[i]))return null;
  }else{
   while(i<command.length&&!/[ \t]/.test(command[i])){
    if(/[\r\n"'\\$`|&;<>()[\]{}]/.test(command[i]))return null;
    value+=command[i++];
   }
  }
  args.push(value);
 }
 return args;
}

function scriptTokens(script){
 const tokens=[];let i=0,depth=0;
 while(i<script.length){
  const char=script[i];
  if(/\s/.test(char)){if(char==='\n'&&!depth)tokens.push({type:'sep',value:';'});i++;continue;}
  if(char==='"'||char==="'"){
   const quote=char;let value='';i++;let ended=false;
   while(i<script.length){
    const next=script[i++];if(next===quote){ended=true;break;}
    if(next==='\n'||next==='\r')return null;
    if(next==='\\'){
     const escaped=script[i++],map={'\\':'\\',"'":"'",'"':'"',n:'\n',r:'\r',t:'\t'};
     if(!Object.hasOwn(map,escaped))return null;value+=map[escaped];
    }else value+=next;
   }
   if(!ended)return null;tokens.push({type:'string',value});continue;
  }
  const id=script.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if(id){tokens.push({type:'id',value:id[0]});i+=id[0].length;continue;}
  const number=script.slice(i).match(/^\d+/);
  if(number){tokens.push({type:'number',value:Number(number[0])});i+=number[0].length;continue;}
  if(!'.[]()=,:;'.includes(char))return null;
  if(char==='('||char==='[')depth++;
  if(char===')'||char===']')depth--;
  if(depth<0)return null;
  tokens.push({type:char===';'?'sep':'symbol',value:char});i++;
 }
 return depth?null:tokens;
}

function parser(tokens){
 let i=0;
 return {
  peek:()=>tokens[i],
  take(value){if(tokens[i]?.value!==value)throw Error('grammar');return tokens[i++];},
  next(type){if(tokens[i]?.type!==type)throw Error('grammar');return tokens[i++].value;},
  optional(value){if(tokens[i]?.value!==value)return false;i++;return true;},
  separators(){let found=false;while(tokens[i]?.type==='sep'){i++;found=true;}return found;},
  end:()=>i===tokens.length,
 };
}
function name(p){const id=p.next('id');if(reserved.has(id))throw Error('grammar');return id;}
function key(p){const key=p.next('string');if(key.length>128||/[\0\r\n]/.test(key))throw Error('grammar');return key;}
function number(p){const value=p.next('number');if(value>OUTPUT_LIMIT)throw Error('grammar');return value;}
function separated(p){if(!p.separators()&&!p.end())throw Error('grammar');}

function pythonPath(script){
 const tokens=scriptTokens(script);if(!tokens)return null;
 try{
  const p=parser(tokens);p.separators();p.take('import');p.take('json');separated(p);
  const data=name(p);p.take('=');p.take('json');p.take('.');p.take('load');p.take('(');p.take('open');p.take('(');
  const path=p.next('string');
  if(p.optional(',')){
   if(p.peek()?.type==='string'){if(!['r','rt'].includes(p.next('string')))return null;if(p.optional(',')){p.take('encoding');p.take('=');if(!['utf-8','utf8'].includes(p.next('string')))return null;}}
   else{p.take('encoding');p.take('=');if(!['utf-8','utf8'].includes(p.next('string')))return null;}
  }
  p.take(')');p.take(')');separated(p);
  const expression=()=>{
   p.take(data);
   while(p.peek()?.value==='['||p.peek()?.value==='.'){
    if(p.optional('.')){
     p.take('get');p.take('(');key(p);
     if(p.optional(',')){if(p.peek()?.type==='string')p.next('string');else p.take('None');}
     p.take(')');
    }else{
     p.take('[');
     if(p.peek()?.type==='string')key(p);
     else{if(p.peek()?.type==='number')number(p);p.take(':');if(p.peek()?.type==='number')number(p);}
     p.take(']');
    }
   }
  };
  let outputs=0;
  while(!p.end()){
   p.take('print');p.take('(');
   if(p.optional('json')){
    p.take('.');p.take('dumps');p.take('(');expression();
    while(p.optional(',')){const option=p.next('id');p.take('=');if(option==='ensure_ascii'){if(!['True','False'].includes(p.next('id')))return null;}else if(option==='indent'){if(p.next('number')>8)return null;}else return null;}
    p.take(')');
   }else expression();
   p.take(')');separated(p);outputs++;
  }
  return outputs&&outputs<=8?path:null;
 }catch{return null;}
}

function nodePath(script){
 const tokens=scriptTokens(script);if(!tokens)return null;
 try{
  const p=parser(tokens);p.separators();let fs=null,path=null,data=null;
  const requireFs=()=>{p.take('require');p.take('(');if(!['fs','node:fs'].includes(p.next('string')))throw Error('grammar');p.take(')');};
  const read=()=>{
   if(fs)p.take(fs);else requireFs();
   p.take('.');p.take('readFileSync');p.take('(');const file=p.next('string');p.take(',');if(!['utf8','utf-8'].includes(p.next('string')))throw Error('grammar');p.take(')');
   if(path&&path!==file)throw Error('grammar');path=file;
  };
  // Optional builtin fs alias. No other require/import operation is supported.
  if(['const','let'].includes(p.peek()?.value)){
   p.next('id');const first=name(p);p.take('=');
   if(p.peek()?.value==='require'){requireFs();fs=first;separated(p);}
   else{data=first;if(p.optional('JSON')){p.take('.');p.take('parse');p.take('(');read();p.take(')');}else read();separated(p);}
  }
  if(!data&&['const','let'].includes(p.peek()?.value)){
   p.next('id');data=name(p);if(data===fs)throw Error('grammar');p.take('=');
   if(p.optional('JSON')){p.take('.');p.take('parse');p.take('(');read();p.take(')');}else read();separated(p);
  }
  const expression=()=>{
   if(!data){read();return;}
   p.take(data);
   while(p.peek()?.value==='.'||p.peek()?.value==='['){
    if(p.optional('[')){key(p);p.take(']');continue;}
    p.take('.');const property=p.next('id');
    if(property==='slice'&&p.peek()?.value==='('){p.take('(');number(p);if(p.optional(','))number(p);p.take(')');}
    // Property reads are allowed; no method except bounded slice is callable.
    else if(p.peek()?.value==='(')throw Error('grammar');
   }
  };
  let outputs=0;
  while(!p.end()){
   if(p.optional('console')){p.take('.');p.take('log');}else{p.take('process');p.take('.');p.take('stdout');p.take('.');p.take('write');}
   p.take('(');
   if(p.optional('JSON')){p.take('.');p.take('stringify');p.take('(');expression();if(p.optional(',')){p.take('null');p.take(',');if(p.next('number')>8)throw Error('grammar');}p.take(')');}
   else expression();
   p.take(')');separated(p);outputs++;
  }
  return outputs&&outputs<=8?path:null;
 }catch{return null;}
}

function candidatePath(tool,platform){
 const input=tool?.rawInput;if(!input||typeof input!=='object'||Array.isArray(input))return null;
 if(typeof input.command==='string'){
  if(tool.kind&&!['execute','read','other'].includes(tool.kind))return null;
  const allowed=new Set(['command','_toolName','description','timeout','timeout_ms','timeoutMs','block_until_ms']);
  if(Object.keys(input).some(k=>!allowed.has(k)))return null;
  // PowerShell/cmd quoting differs. The native Read tool remains supported on
  // Windows; command forms wait for an explicitly implemented shell grammar.
  if(platform==='win32')return null;
  const args=shellArguments(input.command);if(!args)return null;
  if(['cat','/bin/cat','/usr/bin/cat'].includes(args[0]))return args.length===2?args[1]:args.length===3&&args[1]==='--'?args[2]:null;
  if(['python','python3','/usr/bin/python3','/usr/local/bin/python3'].includes(args[0])){
   const flags=args.slice(1,-1);return (flags.length===1&&flags[0]==='-c'||flags.length===2&&flags[0]==='-I'&&flags[1]==='-c')?pythonPath(args.at(-1)):null;
  }
  if(['node','/usr/bin/node','/usr/local/bin/node','/opt/homebrew/bin/node','/opt/homebrew/opt/node@24/bin/node'].includes(args[0]))return args.length===3&&args[1]==='-e'?nodePath(args[2]):null;
  return null;
 }
 const label=String(input._toolName||tool.title||'').replace(/[ _-]/g,'').toLowerCase();
 if(!['read','readfile'].includes(label)||tool.kind&&tool.kind!=='read'&&tool.kind!=='other')return null;
 const allowed=new Set(['_toolName','path','file_path','filePath','offset','limit','start_line','end_line','startLine','endLine']);
 if(Object.keys(input).some(k=>!allowed.has(k)))return null;
 const paths=['path','file_path','filePath'].filter(k=>Object.hasOwn(input,k)).map(k=>input[k]);
 if(!paths.length||paths.some(p=>typeof p!=='string'||p!==paths[0]))return null;
 for(const [k,v]of Object.entries(input))if(!['_toolName','path','file_path','filePath'].includes(k)&&(!Number.isInteger(v)||v<0||v>OUTPUT_LIMIT))return null;
 return paths[0];
}

/** Approve fixed, read-only operations against a bounded Cursor result file.
 * Caller still verifies the active task/run and chooses ACP allow_once.
 * This never reads the result contents or grants a persistent Cursor rule.
 */
export async function cursorResultPermission(tool,{homeDirectory=homedir(),maxBytes=FILE_LIMIT,platform=process.platform}={}){
 const path=candidatePath(tool,platform);
 if(typeof path!=='string'||path.length>4096||/[\0\r\n]/.test(path)||!isAbsolute(path)||path!==resolve(path))return false;
 const projects=join(resolve(homeDirectory),'.cursor','projects'),parts=relative(projects,path).split(sep);
 if(parts.length!==3||!parts[0]||parts[0]==='..'||parts[1]!=='agent-tools'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}\.txt$/.test(parts[2]))return false;
 if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>FILE_LIMIT)return false;
 try{
  const realHome=await realpath(homeDirectory),expected=join(realHome,'.cursor','projects',...parts);
  const actual=await realpath(path);
  const equal=(a,b)=>platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  if(!equal(actual,expected))return false;
  const info=await stat(actual);return info.isFile()&&info.size<=maxBytes;
 }catch{return false;}
}
