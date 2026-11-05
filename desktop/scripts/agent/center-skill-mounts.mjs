// Resolve only the author's configured workspace skill files. Their complete
// contents are frozen in a private per-claim snapshot, never public output.
import {readFile,realpath,lstat,access} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {profiles} from '../../../scripts/site-config.mjs';
import {sectionsForSite} from '../../../contracts/site-sections.mjs';
import {writeCenterJson} from '../../../scripts/rssd-center-client.mjs';
import protocol from '../../../contracts/rssd-v1.cjs';

const sha=text=>createHash('sha256').update(text).digest('hex');
const own=(base,path)=>path.startsWith(base+sep);
const academicModes={xiwen:'scholay-xiwen',observation:'scholay-scholar-observation',opensource:'scholay-academic-opensource',calendar:'scholay-academic-calendar',history:'scholay-academic-history'};
// These are explicit links in the selected skills. Old file workflows, asset
// templates, product promotion and independent QA are deliberately excluded.
const sourceSkills=new Set(['scholay-xiwen','scholay-scholar-observation','scholay-academic-opensource']);
function selectedReferences(skills,scope){
 const selected=new Map();
 for(const skill of skills){
  const links=[...skill.content.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]);
  const required=skill.id==='scholay-seo-writing'?['references/voice.md','references/column-quality.md',...(['xiwen','observation','history'].includes(scope.mode)?['references/science-story.md']:scope.mode==='opensource'?['references/tool-review.md']:[])]:sourceSkills.has(skill.id)?['../scholay-xiwen/references/source-preprocessing.md','../scholay-seo-writing/references/column-quality.md']:[];
  if(required.some(link=>!links.includes(link)))throw Error('写作技能的参考资料选择已变化，需先核对：'+skill.id);
  for(const link of links){
   if(!/^(?:references\/|\.\.\/[^/]+\/references\/)/.test(link))continue;
   let target=null,ignored=false;
   if(skill.id==='scholay-seo-writing'){
    if(link==='references/voice.md'||link==='references/column-quality.md')target='scholay-seo-writing/'+link;
    else if(link==='references/science-story.md'){if(['xiwen','observation','history'].includes(scope.mode))target='scholay-seo-writing/'+link;else ignored=true;}
    else if(link==='references/tool-review.md'){if(scope.mode==='opensource')target='scholay-seo-writing/'+link;else ignored=true;}
    else if(['references/research-method.md','references/product-capabilities.md','references/link-policy.md'].includes(link))ignored=true;
   }else if(sourceSkills.has(skill.id)){
    if(link==='../scholay-xiwen/references/source-preprocessing.md')target='scholay-xiwen/references/source-preprocessing.md';
    else if(link==='../scholay-seo-writing/references/column-quality.md')target='scholay-seo-writing/references/column-quality.md';
    else if(link==='references/legacy-workflow.md')ignored=true;
   }
   if(target)selected.set(target,{path:target});else if(!ignored)throw Error('写作技能引用了尚未确认的本地参考资料：'+skill.id);
  }
 }
 return [...selected.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
export function centerWritingScope(claim,requested){
 const profile=profiles.find(p=>p.spaceId===claim?.workspaceId);if(!profile)throw Error('当前空间缺少站点配置，不能挂载写作技能');
 const section=sectionsForSite(profile).find(s=>s.id===claim.sectionId);if(!section)throw Error('当前栏目缺少写作技能配置');
 if(requested&&(requested.siteId!==profile.id||requested.workspaceId!==profile.spaceId||requested.sectionId!==section.id))throw Error('写作技能与生产范围不匹配');
 const mode=requested?.mode??section.defaultMode;
 if(!['xiwen','observation','opensource','calendar','history','documentation','design','essay','encyclopedia'].includes(mode))throw Error('栏目写作模式未确认');
 return {siteId:profile.id,workspaceId:profile.spaceId,sectionId:section.id,mode};
}
export function centerSkillIds(scope){
 // Existing workspace task snapshots show site-writing across sites; research
 // statistics and experiment examples additionally select these subject skills.
 const ids=['site-writing'];
 if(scope.siteId==='scholay-today'){
  const method=academicModes[scope.mode];if(!method)throw Error('学术站当前栏目缺少领域写作技能映射');
  ids.push(method,'scholay-seo-writing');
 }
 if(scope.siteId==='metho'&&scope.sectionId==='statistics')ids.push('statistics-explainer');
 if(scope.siteId==='metho'&&scope.sectionId==='experiments')ids.push('experiment-design','statistics-explainer');
 return [...new Set(ids)];
}
async function workspaceFor({home,scope,env}){
 const data=resolve(env.SCHOLAY_GLOBAL_APP_DATA||dirname(home));let path;
 const preference=scope.siteId==='scholay-today'?join(data,'editorial-workspace.json'):join(data,'spaces',scope.workspaceId,'editorial-workspace.json');
 try{const ref=await readJson(preference);if(typeof ref.path!=='string'||!ref.path.startsWith('/'))throw Error('invalid');path=ref.path;}
 catch(error){
  // Linux headless workspaces are explicitly configured; never fall back to
  // another site's workspace or a generic template when a binding is absent.
  if(error.code!=='ENOENT')throw Error('已配置的稿件空间不可读取');
  if(env.SCHOLAY_SPACES_ROOT&&scope.siteId!=='scholay-today')path=join(resolve(env.SCHOLAY_SPACES_ROOT),scope.workspaceId,'workspace');
  else if(scope.siteId==='scholay-today'&&env.SCHOLAY_EDITORIAL_ROOT)path=resolve(env.SCHOLAY_EDITORIAL_ROOT);
  else throw Error('当前站点没有配置稿件空间，不能挂载写作技能');
 }
 const root=await realpath(path).catch(()=>{throw Error('当前稿件空间不可读取');});
 try{await access(join(root,'_ops/inventory/article-index.json'));}catch{throw Error('当前稿件空间缺少文章索引');}
 try{const bound=await readJson(join(root,'.site.json'));if(bound.id!==scope.siteId||bound.spaceId!==scope.workspaceId)throw Error('wrong');}
 catch(error){if(!(error.code==='ENOENT'&&scope.siteId==='scholay-today'))throw Error('稿件空间与站点身份不匹配');}
 return root;
}
async function readSkill(root,id){
 const base=await realpath(join(root,'.agents/skills')).catch(()=>{throw Error('站点缺少写作技能目录');});if(!own(root,base))throw Error('站点技能目录越过了稿件空间');
 const file=join(base,id,'SKILL.md');let canonical,info;
 try{info=await lstat(file);canonical=await realpath(file);}catch{throw Error('站点缺少必需写作技能：'+id);}
 if(!info.isFile()||info.isSymbolicLink()||canonical!==file||!own(base,canonical))throw Error('写作技能路径无效：'+id);
 const bytes=await readFile(canonical);if(!bytes.length||bytes.length>60000)throw Error('写作技能内容无效：'+id);
 const content=bytes.toString('utf8');if(Buffer.from(content,'utf8').compare(bytes)!==0)throw Error('写作技能编码无效：'+id);
 const front=content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]||'';
 const name=front.match(/^name:\s*([^\n\r]+)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'')||id;
 const hash=sha(content),version=front.match(/^\s*version:\s*([^\n\r]+)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'')||hash.slice(0,12);
 if(name!==id||!version||version.length>120)throw Error('站点技能标识或版本不匹配：'+id);
 return {id,name,version,contentHash:hash,content};
}
async function readReference(root,path){
 const base=await realpath(join(root,'.agents/skills')).catch(()=>{throw Error('站点缺少写作技能目录');});
 if(!own(root,base)||!/^[-a-z0-9]+\/references\/[-a-z0-9]+\.md$/.test(path))throw Error('写作技能参考资料路径无效');
 const file=join(base,path);let canonical,info;try{info=await lstat(file);canonical=await realpath(file);}catch{throw Error('站点缺少必需写作技能参考资料：'+path);}
 if(!info.isFile()||info.isSymbolicLink()||canonical!==file||!own(base,canonical))throw Error('写作技能参考资料路径无效：'+path);
 const bytes=await readFile(canonical);if(!bytes.length||bytes.length>60000)throw Error('写作技能参考资料内容无效：'+path);
 const content=bytes.toString('utf8');if(Buffer.from(content,'utf8').compare(bytes)!==0)throw Error('写作技能参考资料编码无效：'+path);
 return {path,contentHash:sha(content),content};
}
export function validateCenterSkillSnapshot(snapshot,{claim,scope,writingPolicy}){
 if(!snapshot||![1,2].includes(snapshot.version)||snapshot.demandId!==claim.id||snapshot.generation!==claim.generation||!protocol.canonical(snapshot.scope)||protocol.canonical(snapshot.scope)!==protocol.canonical(scope)||snapshot.policyVersion!==writingPolicy.version||snapshot.policyHash!==sha(writingPolicy.instructions)||!Array.isArray(snapshot.skills)||snapshot.skills.length!==centerSkillIds(scope).length)throw Error('原任务的写作技能快照不匹配');
 const ids=centerSkillIds(scope);for(let i=0;i<ids.length;i++){const s=snapshot.skills[i];if(s?.id!==ids[i]||s.name!==s.id||typeof s.version!=='string'||!s.version||typeof s.content!=='string'||Buffer.byteLength(s.content)>60000||s.contentHash!==sha(s.content))throw Error('原任务的写作技能快照损坏');}
 const expected=selectedReferences(snapshot.skills,scope);
 if(snapshot.version===1&&expected.length)throw Error('原任务的旧写作技能快照缺少必需参考资料，已保留等待核对');
 if(snapshot.version===2){if(!Array.isArray(snapshot.references)||snapshot.references.length!==expected.length)throw Error('原任务的写作技能参考资料快照不匹配');for(let i=0;i<expected.length;i++){const r=snapshot.references[i];if(r?.path!==expected[i].path||typeof r.content!=='string'||!r.content||Buffer.byteLength(r.content)>60000||r.contentHash!==sha(r.content))throw Error('原任务的写作技能参考资料快照损坏');}}
 const {snapshotHash,...value}=snapshot;if(snapshotHash!==protocol.hash(value))throw Error('原任务的写作技能校验失败');return snapshot;
}
export async function centerSkillSnapshot({claim,directory,writingPolicy,writingSkillScope,env=process.env}){
 const scope=centerWritingScope(claim,writingSkillScope),file=join(directory,'writing-skills.json');
 let old;try{old=await readJson(file);}catch(error){if(error.code!=='ENOENT')throw Error('原任务的写作技能快照无法读取');}
 if(old)return validateCenterSkillSnapshot(old,{claim,scope,writingPolicy});
 // A pre-migration result/packet cannot be retroactively represented as having
 // used a skill. Preserve it for a separate explicit editorial recovery.
 for(const locale of ['zh-CN','en'])for(const suffix of ['result.json','packet.json'])try{await access(join(directory,locale+'.'+suffix));throw Error('原任务已有旧版输出，不能补造技能快照');}catch(error){if(error.code!=='ENOENT')throw error;}
 const home=dirname(dirname(directory)),root=await workspaceFor({home,scope,env}),skills=[];
 for(const id of centerSkillIds(scope))skills.push(await readSkill(root,id));
 const references=[];for(const ref of selectedReferences(skills,scope))references.push(await readReference(root,ref.path));
 const value={version:2,demandId:claim.id,generation:claim.generation,scope,policyVersion:writingPolicy.version,policyHash:sha(writingPolicy.instructions),skills,references};const snapshot={...value,snapshotHash:protocol.hash(value)};
 await writeCenterJson(file,snapshot);return validateCenterSkillSnapshot(snapshot,{claim,scope,writingPolicy});
}
