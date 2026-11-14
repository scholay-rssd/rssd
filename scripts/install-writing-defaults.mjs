// Replace only the managed skill entry point; originals and author preferences
// remain private in the target workspace. Never copies manuscripts or tokens.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createWritingDefaultsReader,writeWritingJson} from './rssd-writing-defaults.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex');
const start='<!-- rssd-writing-defaults:start -->',end='<!-- rssd-writing-defaults:end -->';
export async function installWritingDefaults({root,workspaceId,origin,client=createWritingDefaultsReader({origin})}){
 await access(root);const catalog=await client.writingDefaultCatalog(),workspace=catalog.workspaces.find(w=>w.workspaceId===workspaceId);
 if(!workspace)throw Error('工作空间没有线上写作配置');
 try{const bound=JSON.parse(await readFile(join(root,'.site.json'),'utf8'));if(bound.id!==workspace.siteId||bound.spaceId!==workspaceId)throw Error('工作空间站点身份不匹配');}catch(e){if(e.code!=='ENOENT')throw e;}
 const directory=join(root,'.local/writing-defaults');await mkdir(directory,{recursive:true,mode:0o700});
 const entry=`开始一篇新文章前，从 RSSD 项目根运行：\nnpm --silent run headless -- writing-defaults --workspace ${workspaceId} --section <栏目ID> --session <本篇唯一ID> --output <本篇私有context.json>\n\nLinux 固定运行包使用 rssd writing-defaults 和相同参数。读取返回文件中的 instructions 后再写；线上 Center：${client.origin}。新文章使用新 session；同一任务续写沿用原 session 和快照。先加载线上基线，再以 --overrides 单独记录本地偏好，不以旧 SKILL/旧 brief 代替。来源规则仅指导写作，不授予发布权限。`;
 const writes=[['.agents/skills/site-writing/SKILL.md',`---\nname: site-writing\ndescription: 当前工作空间的统一写作入口；开始新稿时先读取 Center 的栏目基线，再应用明确调整。\n---\n\n# 统一栏目写作\n\n${entry}\n`],['.agents/skills/rssd-writing/SKILL.md',`---\nname: rssd-writing\ndescription: 从线上 Center 加载本空间栏目的写作技能、参考文件和配图要求，保留版本与本地调整记录。\n---\n\n# 取得本篇写作规则\n\n${entry}\n`]];
 let agents='';try{agents=await readFile(join(root,'AGENTS.md'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 const block=start+'\n## 统一写作入口\n\n'+entry+'\n'+end;
 if(agents.includes(start)){const i=agents.indexOf(start),j=agents.indexOf(end,i);if(j<0)throw Error('原统一入口标记不完整');agents=agents.slice(0,i)+block+agents.slice(j+end.length);}else agents=block+'\n\n'+agents;
 writes.push(['AGENTS.md',agents]);
 const changed=[];
 for(const [rel,text] of writes){
  const file=join(root,rel);let old;try{old=await readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(old?.equals(Buffer.from(text)))continue;
  if(old){const backup=join(directory,'backups',digest(old)+'.json');try{await access(backup);}catch(e){if(e.code!=='ENOENT')throw e;await writeWritingJson(backup,{path:rel,sha256:digest(old),text:old.toString('utf8')});}}
  await mkdir(join(file,'..'),{recursive:true});await writeFile(file,text);changed.push(rel);
 }
 await writeWritingJson(join(directory,'managed.json'),{version:1,origin:client.origin,workspaceId,siteId:workspace.siteId});
 return {state:'installed',workspaceId,siteId:workspace.siteId,version:catalog.version,catalogHash:catalog.hash,sourceCommit:catalog.source.commit,changed};
}
