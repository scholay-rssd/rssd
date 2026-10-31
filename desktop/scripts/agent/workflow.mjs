import {publicationDirectory,siteForWorkspace} from '../../../scripts/site-config.mjs';
import {topicSlotInstructions} from './topic-slots.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readDraft,contained} from '../../../scripts/editorial-workspace.mjs';
import {markdownImages} from '../../../scripts/article-format.mjs';
import {recordFields,headingContract} from '../../../scripts/editorial-record.mjs';
import {validate} from '../../../admin/model.mjs';
import {cursorResultPermission} from './cursor-result-permission.mjs';
import {optionalJson} from '../../../scripts/editorial-sync.mjs';
import {taskType} from './task-types.mjs';
import {destinationRecord} from './destinations.mjs';
import {CURRENT_DOMAIN as ACADEMIC,domainType} from './domain-pack.mjs';

export const FLOW_VERSION=1;
export const sourceModes=['combined','rss','web'];
const kindModeForNotebook=kind=>({year:'calendar',history:'history',openSource:'opensource',article:'observation'}[kind]);
const localTools=new Set(['task_read','task_update','task_topic_progress','draft_read','draft_create','draft_save','draft_preview']);
const rssTools=new Set(['library_list','article_list','article_read']);
// Only recognized shipped defaults may fall back to the new client guide.
// Unmarked author/custom guides and frozen mounts must not be silently replaced.
const legacyNotebookGuides=new Set([
 '63cf114ebfe043ea4a72a95005ebd2c1285ce160b7359703908b184acf95567f',
 '8a19edc68a48b87a00b9fc8fdbbe589f4f0db51caafb71d254e6861ce0f65d5b',
 '8be66bfa4809ea5be469852734352367008b8dd6fdba6fced2083ea8f2b6aedd',
]);
const legacySiteGuide=domain=>`# 内容写作\n围绕${domain}采集已核实的原始来源。区分事实、观点和计划。新闻与历史保留出处；年度惯例须有月日依据，不把发布日期当作事件日期。通过 draft_create、draft_save 按稳定编号与 SHA 保存。公开前遵守工作台确认流程，不通过 shell 绕过。\n`;
export function flowOptions(task){return {version:FLOW_VERSION,sources:'combined',authorized:false,...task.workflow};}
export function autoConfiguration(configuration){
 const model=configuration.configOptions?.find(o=>o.category==='model');
 const auto=model?.options?.flatMap(o=>o.options||[o]).find(o=>o.name?.toLowerCase()==='auto');
 if(!model||!auto)throw Error('当前 Cursor 未提供 Auto，请更新或重新登录 Cursor 后重试');
 return {id:model.id,value:auto.value,current:model.currentValue};
}
export async function workflowInstructions(root,mode='xiwen',context={},pack=ACADEMIC){
 if(context.notebook){
  const rule=destinationRecord(kindModeForNotebook(context.notebook.kind));
  const mounted=new Set((context.notebook.mounts?.skills||[]).map(s=>s.id));
  const skills=[...new Set(context.notebook.skills.map(id=>domainType(id,pack)?.skill).filter(skill=>skill&&!mounted.has(skill)))],references=[];
  // Old workspaces retain their files. Use the shipped current method when
  // their automatic domain guide predates notebooks; explicit snapshots stay
  // preserved and emitted once by taskInstructions; the current project policy
  // resolves conflicting prose/notes rules without replacing their bytes.
  const template=process.env.SCHOLAY_TEMPLATE_ROOT||fileURLToPath(new URL('../../resources/workspace-template/',import.meta.url));
  for(const skill of skills){
   const path='.agents/skills/'+skill+'/SKILL.md';
   let content='';
   for(const base of [...new Set([root,template])]){
    try{
     const text=await readFile(await contained(base,path),'utf8'),normalized=text.replace(/\r\n/g,'\n');
     const legacy=legacyNotebookGuides.has(createHash('sha256').update(normalized).digest('hex'))||skill==='site-writing'&&normalized===legacySiteGuide(pack.name);
     if(/^\s+workflow: notebook-v1\s*$/m.test(text)||base===root&&!legacy){content=text;break;}
    }catch(e){if(e.code!=='ENOENT')throw e;}
   }
   if(content)references.push('\n'+path+'\n'+content);
  }
  return '以下当前写作方法已由工作台读取，无需重复读取文件。任务操作范围由本轮文章板协议给出。\n'+references.join('\n')+'\n当前领域：'+pack.name+'\n'+(pack.scope||'')+'\n'+(rule?'结构化字段：'+rule.fields+'。正文保持 '+headingContract(rule.kind)+'。':'');
 }
 if(mode==='image'){
  const scope='本地图库对话：先 task_read 获取当前对话要求与已有图片，使用 Cursor Generate Image 生成真实 PNG/JPEG/WebP；asset_register 将文件登记到本地图库。文章槽位、分栏、日期等引用仅作图片上下文，不授予文章修改权限。不创建文章，不操作云端，不运行 shell。失败时保留记录，不自动重试或重复生成。';
  if(!new RegExp(pack.imageStyle.match,'i').test([context.title,context.brief].join(' ')))return scope;
  const parts=[scope];
  for(const path of pack.imageStyle.files){
   try{parts.push('\n### '+path+'\n'+(await readFile(await contained(root,path),'utf8')).slice(0,24000));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return parts.join('\n');
 }
 // Which skill and references a type reads is the domain pack's choice; the engine only knows that a manuscript type needs the pack's required ones.
 const type=taskType(mode),skill=domainType(mode,pack)?.skill;
 if(!type||!skill)throw Error('历史会话只读，请新建任务');
 const own=`.agents/skills/${skill}/SKILL.md`,required=new Set(type.article?[own,...pack.references.required]:[]);
 const files=[...new Set(['AGENTS.md','README.md',own,`.agents/skills/${skill}/references/legacy-workflow.md`,...pack.references.board,...(type.article?pack.references.article:[])])];
 const parts=[];
 for(const path of files){try{parts.push(`\n### ${path}\n${(await readFile(await contained(root,path),'utf8')).slice(0,24000)}`);}catch(error){if(error.code==='ENOENT'&&!required.has(path)&&!['AGENTS.md','README.md'].includes(path))continue;throw Error('缺少写作规范：'+path+'；请在设置中更新工作目录模板');}}
 return (mode==='rss'?'RSS 来源发现只整理真实可访问的 RSS/Atom 订阅入口，逐槽回写 board；核验日期不是文章发布日期，不创建或订阅、不生成大纲、正文或图片。\n':'')+'以下是当前工作目录的规范，已由工作台读取，无需再运行文件读取或 shell 命令：\n'+parts.join('\n')+'\n'+(pack.scope||'');
}
// Every call receives allow_once; the application retains and checks the scoped
// grant. Never persist a broad allow_always rule in Cursor's account settings.
export function flowPermission(task,tool){
 const flow=flowOptions(task);if(!flow.authorized||task.completedAt||task.mode==='legacy')return false;
 if(tool.kind==='execute'||tool.kind==='delete'||tool.rawInput?.command)return false;
 const title=String(tool.title||'');
 const owned=title.match(/^scholay-workbench-([a-z_]+): \1$/);
 if(owned&&task.notebook)return ['task_read','task_update','notebook_patch','notebook_notes','notebook_heading_apply','draft_read','draft_preview','resource_list','resource_search','resource_read'].includes(owned[1])||(task.runtime?.notebookAction?.action==='image'&&['asset_register','notebook_image_search','notebook_image_apply'].includes(owned[1]))||(task.runtime?.notebookAction?.action==='complete'&&['notebook_image_search','notebook_image_apply'].includes(owned[1]));
 if(owned)return task.mode==='image'?['task_read','asset_register'].includes(owned[1]):taskType(task.mode)?.article===false?['task_read','task_update','task_topic_progress'].includes(owned[1]):localTools.has(owned[1]);
 const rss=title.match(/^(?:scholay-rss|scholay-today)-([a-z_]+): \1$/);
 if(rss){
  // Gallery prompts may refer to an existing manuscript. Native manuscript
  // reads still enforce the user's Agent access setting; all writes remain
  // behind task-scoped workbench tools and their hash/version checks.
  if(['draft_list','draft_read','draft_preview'].includes(rss[1]))return taskType(task.mode)?.article!==false;
  if(task.mode==='image')return false;
  // The native page bridge accepts only fixed read operations, validates the
  // source URL and rejects stale page instances. This grant never enables JS.
  if(['page_list','page_read','feed_read'].includes(rss[1]))return flow.allowNetwork===true||['combined','web'].includes(flow.sources);
  const kinds=flow.mountKinds||[];
  if(rssTools.has(rss[1]))return flow.sources!=='web'||kinds.includes('rss');
  return (flow.sources==='combined'||flow.allowNetwork===true)&&['article_clean','article_clean_status'].includes(rss[1]);
 }
 if(tool.kind==='other'&&title==='Generate Image'&&/^generateimage$/i.test(tool.rawInput?._toolName||''))return task.mode==='image'||!!(task.notebook&&task.runtime?.notebookAction?.action==='image'&&task.runtime.notebookAction.imageMethod==='generate');
 if(flow.sources==='rss'&&flow.allowNetwork!==true)return false;
 if(tool.kind==='fetch'&&/^Fetch https?:\/\//.test(title)){
  try{const u=new URL(title.slice(6));return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!/^(localhost|.*\.local|.*\.internal|.*\.localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/.test(u.hostname)&&u.hostname.includes('.');}catch{return false;}
 }
 // Search queries and generated-image prompts do not authorize shell commands.
 return (tool.kind==='search'&&title==='Web Search')||/^Web search: \S/.test(title);
}
// Cursor stores large MCP replies in its own result cache. Reading those
// replies is part of the granted task, even when Cursor uses a small terminal
// script to print JSON fields. The cache recognizer validates syntax and real
// file containment; arbitrary execute commands remain a separate request.
export async function taskToolPermission(task,tool,options){
 if(!flowOptions(task).authorized||task.completedAt||!(taskType(task.mode)||task.mode==='image'))return false;
 return flowPermission(task,tool)||await cursorResultPermission(tool,options);
}
export function workflowPrompt(task,{action,target,notes=''}){
 const f=flowOptions(task);if(task.completedAt||task.mode==='legacy')throw Error('对话已结束，请新建对话');if(!f.authorized)throw Error('请先授权本任务的资料检索与稿件操作');
 if(String(notes).length>4000)throw Error('补充要求过长');
 if(task.mode==='image'){if(action!=='image')throw Error('图片任务只支持生图');return `根据以下要求生成真实静态图片：${task.brief||task.title}。默认一张，用户明确要求数量时按要求逐张生成；每张完成后 asset_register 登记实际文件。使用 Cursor Generate Image；文件缺失不能声称成功，不重复已有结果。不创建或修改文章，不操作云端，不运行 shell。不要预加品牌水印。${notes}`;}
 if(action==='image')throw Error('图片生成请在本地图库的对话中进行，文章流程只安排占位图');
 if(task.mode==='rss'&&!['topic','append','section','item'].includes(action))throw Error('RSS 来源发现只整理素材，不生成大纲或稿件');
 const item=task.board.sections.flatMap(s=>s.items).find(x=>x.id===target),block=task.outline.blocks.find(x=>x.id===target);
 if(action==='topic'&&target&&!task.board.sections.some(s=>s.slots?.some(slot=>slot.id===target&&slot.mode==='smart'&&!s.items.some(i=>i.id===slot.id))))throw Error('该槽位不是待检索的智能槽位');
 if(action==='topic'&&!task.board.sections.some(s=>s.slots?.some(slot=>slot.mode==='smart'&&!s.items.some(i=>i.id===slot.id))))throw Error('请先为至少一个空卡片设置智能采集方向');
 const commands={
  topic:'检索材料并通过 task_update 保存完整选题板。保留所有锁定项；已有材料可复用，不重复计数。停在选题板等待人工确认。',
  append:`在分栏 ${target} 仅填充空智能槽位；保留所有已有卡片及勾选状态，不替换、不重复已删除材料。逐条核实，每完成一条立即 task_read 后 task_update 保存完整 board。`,
  section:`仅补充或替换分栏 ${target} 的未锁定材料，保留其他分栏。`,
  item:`仅替换新闻 ${target}，保留其他新闻和锁定项。`,
  outline:'基于已确认的选题生成结构化大纲，通过 task_update 保存 outline。保留人工锁定块，等待人工确认大纲。',
  block:`仅重新编排大纲块 ${target}，保留其余块和人工锁定内容。`,
  draft:'按已确认大纲生成正文。只使用 task_read 返回的 imageSlots 占位图片路径安排插图，不生成真实图片、不调用生图工具。已有正文保留人工修改，不重建作品。完成后 draft_preview，进入人工编辑。',
 };
 if(!Object.hasOwn(commands,action))throw Error('未知流程操作');
 if(['section','append'].includes(action)&&!task.board.sections.some(s=>s.id===target))throw Error('分栏不存在');
 if(action==='item'&&(!item||item.locked))throw Error('新闻不存在或已锁定');
 if(['outline','block'].includes(action)&&!task.topicConfirmed)throw Error('请先确认选题');
 if(action==='block'&&(!block||block.locked))throw Error('内容块不存在或已锁定');
 if(action==='draft'&&!task.outlineConfirmed)throw Error('请先确认大纲');
 const sources=f.sources==='combined'?'先从 scholay-rss 的 library_list/article_list/article_read 查询本地资料，再通过联网搜索与官方原文补充、核对。RSS 不足或不可用时继续联网，并在 board.gaps 记录实际缺口。':f.sources==='rss'?'仅使用本地 RSS 缓存，不联网抓取或清洗；没有正文时明确缺口。':'使用联网检索和机构原文，不读取本地 RSS。';
 const subject=domainType(task.mode)?.subject;
 const structure='使用 task_update 保存 board:{titles:[],sections:[{id,title,slotCount,slots:[{id,mode,prompt}],items:[{id,title,summary,url,publisher,date,acquiredVia,selected:false,locked:false,excluded:true}]}]}；选题阶段不定文章标题。以人工设置的分栏及各栏 slotCount（默认 1）为准，保留分栏 ID、名称与 slotCount，最多 5 栏、每栏最多 5 条，每核实一条先 task_read 再保存完整 board，让对应宫格逐条显示。已勾选和 dismissed 中的材料不可覆盖或重新添加。'+(task.mode==='rss'?'RSS 来源发现只保存 board；每条 url 为核实可访问的订阅入口，publisher 为原站，date 为本次实际核验日，dateBasis 明确“订阅可访问性核验日期”，summary 说明内容范围与原站。不编排标题和大纲，不创建文章，不自动订阅。':'确认选题后仅使用 selected=true 的素材（旧数据为非 excluded），保存 outline:{titleCandidates:[三个标题候选],selectedTitle:0,blocks:[{id,type,text,sourceIds:[],locked:false}]}；大纲必须有正文 paragraph 块，等待用户确认。确认前不创建稿件；draft_create 使用固定 articleId，结构化类型另传本类型 Skill 的 fields，稿件的存放位置与栏目由工作台决定。');
 const record=destinationRecord(task.mode),recordStructure=record?`本类型为结构化稿件：draft_create 的 fields 完整保留 ${record.fields}。${taskType(task.mode).rules||''}大纲与正文保留${headingContract(record.kind)}，${record.placement}，一级标题后不能另放导语。`:'';
 const state=JSON.stringify({revision:task.revision,days:task.days,topicConfirmed:!!task.topicConfirmed,outlineConfirmed:!!task.outlineConfirmed,selectedMaterials:task.board.sections.flatMap(s=>s.items).filter(i=>i.selected??!i.excluded),outline:task.outline,workIds:task.workIds});
 const stages=task.mode==='rss'?'只整理订阅入口；本次核验日期不表示内容发布日期。不生成文章或图片。':'大纲逐块保存：每写好一个新块，重新 task_read，使用最新 expectedRevision 保存完整 outline；保留已有块和锁定内容，不把完整结果只留在聊天中。正文仅由已确认的大纲生成，不在文章任务中调用 GenerateImage 或 asset_register。';
 const pageSources=f.sources==='rss'?'本次只读 RSS 缓存，不调用 page_read 或联网清洗。':'需要完整原文时使用 scholay-rss 的 page_list 查看桌面已打开的公网页面，只选择与当前来源 URL 相符的页面；page_read 带 url、view_id 和同次 page_list 的 request_id，读取真实 DOM 的结构化正文。没有对应页面时仅带 url 使用公开网页预处理，按返回的 sourceKind、warnings、truncated 判断覆盖范围，不把静态抓取说成浏览器完整页面。page_read 可携带当前 task_id/run_id，不执行自定义脚本；不读取其他页面或登录、付费、附件缺口，不绕过限制。RSS article_read 返回 not_cleaned 时，combined 模式可用 article_clean 清洗当前少量条目，再 article_clean_status 与 article_read 读回；失败保留缺口，不循环重复采集。';
 return `当前任务类型：${subject}。${structure}\n${recordStructure}\n${topicSlotInstructions(task,action==='topic'?target:undefined)}\n当前板子状态：${state}\n这是固定业务流程的一步，使用 Agent 执行，不创建额外计划审批或追问。先 task_read 获取最新状态，写作规范已随本次运行提供。${sources}\n${pageSources}\n${commands[action]}\n${stages}\n每条新采集材料记录 acquiredVia: rss 或 web；从本地 RSS 读取的条目记录 rssId。已有学术记录素材 acquiredVia: record，保留原 recordId、recordKind、datePrecision 和 dateBasis，不将月精度或未知日期补造为某日，也不直接改原资料库；增补仅填对应新智能槽位；enrichRecordId 关联的原记录与该增补结果可共用原文证据，但不能当两条独立新闻，成稿仍需核实完整日期。原文 URL、publisher、date、dateBasis 必须可核对。同事件去重；可标记 gaps，不能编造填满。只通过工作台工具更新选题、大纲和当前作品 ${task.articleId}。不运行通用 shell。工具结果过长而保存在 Cursor 自己的 agent-tools/*.txt 时，可用 Read/Read File 或只读 JSON 打印脚本读取该结果，不需额外询问。不得写入、执行缓存内容或读取其他私人文件。不直接改文件或索引，不操作云端、不公开；交稿由界面执行。找不到信息就保留结果并说明缺口。\n补充要求：${notes||'沿用任务设置'}`;
}
// Read the original request journals only. Resolving these states remains an
// explicit cloud-status operation; this check never retries or sends a request.
export async function pendingCloudDelivery(root,articleId){
 const dir=join(publicationDirectory(root),articleId),receipt=await optionalJson(join(dir,'receipt.json')),action=await optionalJson(join(dir,'cloud-action.json'));
 if(receipt&&!['draft_saved','not_submitted','rejected'].includes(receipt.status)){
  const stage=['queued','running'].includes(receipt.job?.status)?receipt.job.status:['submit_intent','unknown'].includes(receipt.status)?'unknown':receipt.status==='submitted'&&!receipt.job?'unknown':receipt.job?.status==='success'&&!receipt.publicReadback&&receipt.status!=='draft_saved'?'verify':null;
  if(stage)return {kind:'publication',requestKey:receipt.requestKey,stage};
 }
 if(action?.status==='success'&&(action.action==='publish'&&!action.publicReadback||action.action==='withdraw'&&!action.withdrawnReadback))return {kind:'action',requestKey:action.requestKey,stage:'verify'};
 if(action&&!['success','failed','rejected','not_submitted'].includes(action.status)){const stage=['unknown','queued','running'].includes(action.status)?action.status:['queued','running'].includes(action.job?.status)?action.job.status:null;if(stage)return {kind:'action',requestKey:action.requestKey,stage};}
 return null;
}
export async function workflowCheck(root,task){
 const pendingCloudRequest=await pendingCloudDelivery(root,task.articleId);
 const checks=[],add=(key,label,ok,detail='')=>checks.push({key,label,ok:!!ok,detail});
 if(task.notebook){add('notebook','文章板已成稿',!!task.notebook.exportedSha&&!task.draftStale);}else{add('topic','选题已确认',task.topicConfirmed);add('outline','生成已确认',task.outlineConfirmed&&!task.draftStale);}
 let draft;try{draft=await readDraft(task.articleId,root);}catch{add('body','正文已保存',false,'尚未生成正文');return {checks,ready:false,draftReady:false,images:0,reviewed:false,pendingCloudRequest};}
 const record=destinationRecord(task.mode),kind=record?.kind,hash=createHash('sha256').update(draft.sha256);let fields=null;
 if(kind&&task.articleId.startsWith('record-')){
  try{
   const bound=JSON.parse(await readFile(join(publicationDirectory(root),task.articleId,'record.json'),'utf8'));
   if(bound.kind!==kind||bound.documentId!==task.articleId.slice(7))throw Error('稿件与任务类型或稳定 ID 不一致');
   fields=validate(kind,recordFields(kind,bound.fields,draft.markdown),bound.fields);
   record.verify?.(fields);
   hash.update(JSON.stringify({documentId:bound.documentId,kind,fields}));add('record','结构化字段完整',true);
  }catch(error){add('record','结构化字段完整',false,error.message);}
 }
 const prose=draft.markdown.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]*)\]\(https?:\/\/[^)]*\)/g,'$1').replace(/^#{1,6}\s+.*$/gm,'').trim();
 add('body','正文已保存',kind&&task.articleId.startsWith('record-')?!!fields:prose.length>120&&!/IMAGE_[A-Z_]+/.test(prose));
 const paths=[...new Set(markdownImages(draft.markdown))],missing=[];let images=0;
 for(const path of paths){try{if(path.startsWith('assets/placeholders/'))throw Error('尚未替换占位图');const file=await contained(dirname(join(root,draft.canonicalPath)),path);const bytes=await readFile(file);const sharp=(await import('sharp')).default;await sharp(bytes).metadata();hash.update(path).update(bytes);images++;}catch{missing.push(path);}}
 add('images','配图文件完整',(task.notebook?true:images>=2)&&!missing.length,`${images} 张可读取图片${missing.length?'；缺失 '+missing.join('、'):''}`);
 add('sources','来源链接完整',/\]\(https?:\/\//.test(draft.markdown)||!!(fields?.sourceUrl||fields?.url||fields?.sources?.length));
 const fingerprint=hash.digest('hex');return {checks,ready:checks.every(c=>c.ok),draftReady:checks.filter(c=>['notebook','topic','outline','body','record'].includes(c.key)).every(c=>c.ok),images,fingerprint,sha256:draft.sha256,reviewed:task.workflow?.review?.fingerprint===fingerprint&&task.workflow.review.revision===task.revision,pendingCloudRequest};
}
