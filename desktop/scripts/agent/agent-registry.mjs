// AionUi-style external-agent discovery: each agent keeps its own credentials
// and runtime; Today supplies an ACP host and workspace-scoped tools.
import {existsSync,statSync,readFileSync} from 'node:fs';
import {join,dirname,delimiter,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {cursorCommand,cursorEnvironment} from '../runtime/cursor-command.mjs';
import {atomicJson,optionalJson} from '../../../scripts/editorial-sync.mjs';
import {withFileLock} from '../../../scripts/editorial-lock.mjs';

export const AGENTS = [
 {id:'cursor',name:'Cursor',command:'cursor-agent',args:['acp'],docs:'https://cursor.com/docs/cli/installation',loginArgs:['login'],authHosts:['cursor.com','cursor.sh']},
 {id:'codex',name:'Codex',command:'codex',adapter:'@agentclientprotocol/codex-acp',docs:'https://developers.openai.com/codex/cli/',loginArgs:['login','--device-auth'],authHosts:['openai.com','chatgpt.com']},
 {id:'claude',name:'Claude Code',command:'claude',adapter:'@agentclientprotocol/claude-agent-acp',docs:'https://code.claude.com/docs/en/setup',loginCommand:'claude auth login',authNote:'沿用本机 Claude Code 配置；第三方产品的订阅授权受厂商限制，亦可配置官方 API。'},
 {id:'hermes',name:'Hermes',command:'hermes',args:['acp'],docs:'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/',loginCommand:'hermes setup'},
 {id:'gemini',name:'Gemini CLI',command:'gemini',args:['--acp'],docs:'https://geminicli.com/docs/get-started/authentication/',loginCommand:'gemini'},
 {id:'copilot',name:'GitHub Copilot',command:'copilot',args:['--acp','--stdio'],docs:'https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started',loginCommand:'copilot login'},
 {id:'opencode',name:'OpenCode',command:'opencode',args:['acp'],docs:'https://opencode.ai/docs/acp/',loginCommand:'opencode auth login'},
 {id:'kimi',name:'Kimi CLI',command:'kimi',args:['acp'],docs:'https://moonshotai.github.io/kimi-cli/en/',loginCommand:'kimi login'},
 {id:'qwen',name:'Qwen Code',command:'qwen',args:['--acp'],docs:'https://qwenlm.github.io/qwen-code-docs/',loginCommand:'qwen'},
];
const requires=[createRequire(import.meta.url),createRequire(new URL('../../runtime/package.json',import.meta.url))];
function packageFile(name){for(const r of requires){try{return r.resolve(name+'/package.json');}catch{try{const entry=r.resolve(name);let dir=dirname(entry);for(let i=0;i<5;i++,dir=dirname(dir)){const file=join(dir,'package.json');if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).name===name)return file;}}catch{}}}return null;}
export function packageCommand(name,bin,args=[]){const file=packageFile(name);if(!file)return null;const pkg=JSON.parse(readFileSync(file,'utf8')),entry=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.[bin]||Object.values(pkg.bin||{})[0];return entry?{command:process.execPath,args:[join(dirname(file),entry),...args]}:null;}
export function agentEnvironment(extra={}){const env=cursorEnvironment(extra);env.PATH=[dirname(process.execPath),join(homedir(),'.local/bin'),...(process.platform==='win32'?[join(process.env.APPDATA||join(homedir(),'AppData/Roaming'),'npm')]:['/usr/local/bin']),env.PATH].filter(Boolean).join(delimiter);return env;}
export function executableCommand(command,args=[],{env=agentEnvironment(),platform=process.platform}={}){
 const dirs=isAbsolute(command)?['']:String(env.PATH||'').split(delimiter).filter(Boolean);
 const suffixes=platform==='win32'&&!/\.(exe|cmd|bat|js|cjs|mjs)$/i.test(command)?['.exe','.cmd','.bat','']:[''];
 for(const dir of dirs)for(const suffix of suffixes){const path=dir?join(dir,command+suffix):command+suffix;try{if(!statSync(path).isFile())continue;}catch{continue;}
  if(platform==='win32'&&/\.(cmd|bat)$/i.test(path)){
   // npm's Windows shims cannot be spawned without a shell. Resolve their JS
   // entry instead; do not interpolate user-controlled strings into cmd.exe.
   const text=readFileSync(path,'utf8'),match=text.match(/(?:%dp0%|%~dp0)[\\/]([^"\r\n]+\.(?:c?js|mjs))/i);
   if(match){const entry=join(dirname(path),match[1]);if(existsSync(entry))return {command:process.execPath,args:[entry,...args]};}continue;
  }
  return /\.(c?js|mjs)$/i.test(path)?{command:process.execPath,args:[path,...args]}:{command:path,args};
 }
 return null;
}
export function agentConfigFile(){return join(process.env.SCHOLAY_GLOBAL_APP_DATA||process.env.SCHOLAY_AGENT_HOME||join(homedir(),'.config','scholay-today'),'agents.json');}
export class AgentRegistry{
 constructor(file=agentConfigFile()){this.file=file;}
 async config(){return await optionalJson(this.file)||{version:1,agents:[]};}
 async definitions(){const saved=(await this.config()).agents||[];return [...AGENTS.map(a=>({...a,...saved.find(s=>s.id===a.id)})),...saved.filter(a=>!AGENTS.some(b=>b.id===a.id))];}
 async get(id='cursor'){const agent=(await this.definitions()).find(a=>a.id===id);if(!agent)throw Error('智能体配置不存在：'+id);return agent;}
 async save(p){
  if(!p||typeof p.id!=='string'||!/^[a-z][a-z0-9-]{1,60}$/.test(p.id))throw Error('无效智能体 ID');
  const builtin=AGENTS.find(a=>a.id===p.id);
  if(!builtin&&(!p.id.startsWith('custom-')||!String(p.name||'').trim()||!String(p.command||'').trim()))throw Error('请填写自定义智能体名称和启动命令');
  if(p.command!==undefined&&(typeof p.command!=='string'||p.command.length>1000||/[\r\n\0]/.test(p.command)))throw Error('启动命令需要一个可执行文件路径');
  if(p.args!==undefined&&(!Array.isArray(p.args)||p.args.length>50||p.args.some(a=>typeof a!=='string'||a.length>2000||/[\r\n\0]/.test(a))))throw Error('参数需要字符串数组');
  const value={id:p.id,...(!builtin?{name:String(p.name).trim().slice(0,80)}:{}),...(p.command?.trim()?{command:p.command.trim()}:{}),...(p.args?{args:p.args}:{}),enabled:p.enabled!==false};
  return withFileLock(this.file+'.lock',async()=>{const config=await this.config();config.agents=[...(config.agents||[]).filter(a=>a.id!==p.id),value];await atomicJson(this.file,config);return {ok:true};});
 }
 async remove(id){if(AGENTS.some(a=>a.id===id))throw Error('内置智能体可以停用，不能删除');return withFileLock(this.file+'.lock',async()=>{const c=await this.config();c.agents=(c.agents||[]).filter(a=>a.id!==id);await atomicJson(this.file,c);return {ok:true};});}
 async launch(id,{login=false}={}){
  const a=await this.get(id);if(a.enabled===false)throw Error(a.name+' 已停用，请在设置中启用');
  if(login&&!a.loginArgs)throw Error('请在终端完成授权：'+(a.loginCommand||a.command));
  const customCommand=a.command!==AGENTS.find(b=>b.id===id)?.command;
  let launch;
  if(id==='cursor'&&!customCommand)launch=cursorCommand(login?a.loginArgs:a.args||['acp']);
  else if(login&&id==='codex')launch=executableCommand(a.command,a.loginArgs)||packageCommand('@openai/codex','codex',a.loginArgs);
  else if(a.adapter){
   launch=packageCommand(a.adapter,id==='codex'?'codex-acp':'claude-agent-acp');
   if(!launch)throw Error('安装包缺少 '+a.name+' ACP 适配器，请重新安装 Today');
   if(id==='codex'){
    const cli=executableCommand(a.command);
    if(cli){if(cli.args.length)throw Error('请指定原生 Codex 可执行文件路径');launch.env={...launch.env,CODEX_PATH:cli.command};}
    else if(customCommand)throw Error('未找到配置的 Codex 可执行文件');
   }
   if(customCommand&&id==='claude'){const cli=executableCommand(a.command);if(!cli||cli.args.length)throw Error('请指定原生 Claude Code 可执行文件路径');launch.env={CLAUDE_CODE_EXECUTABLE:cli.command};}
  }else launch=executableCommand(a.command,login?a.loginArgs:a.args||[]);
  if(!launch)throw Error('未找到 '+a.name+'，请安装官方 CLI 或在设置中指定路径');
  return {...launch,agent:a};
 }
 async list(){return Promise.all((await this.definitions()).map(async a=>{let available=false,detail='';try{await this.launch(a.id);available=true;}catch(e){detail=e.message;}return {...a,available,detail,enabled:a.enabled!==false,custom:a.id.startsWith('custom-')};}));}
}
export function validAuthUrl(value,agent){try{const u=new URL(value);return u.protocol==='https:'&&(agent.authHosts||[]).some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;}catch{return null;}}
