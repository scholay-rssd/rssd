#!/usr/bin/env node
// Linux headless producer: notebook-v2 via the selected agent ACP bridge, then
// brand endnotes, alt text, export, metadata, check, publish and status.
import {spawn} from 'node:child_process';
import {appendFileSync,existsSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applySiteEnv,cursorPathEnv,repoRoot} from './env.mjs';
import {createBridgeClient} from './bridge-client.mjs';
import {confirmPublication} from './publication.mjs';
import {assertHeadlessTarget} from './target.mjs';
import {headlessEntry} from './update.mjs';
import {parseProduceMounts,loadMountList,parseBriefMounts} from '../resources/mount-spec.mjs';

export function parseArgs(argv){
 const parsed=parseProduceMounts(argv),rest=parsed.argv;
 const noPublish=rest.includes('--no-publish');
 const agentId=rest.includes('--agent')?rest[rest.indexOf('--agent')+1]:undefined;
 if(rest.includes('--agent')&&(!agentId||!/^[a-z][a-z0-9-]{1,60}$/.test(agentId)))throw Error('--agent requires an agent ID');
 const resume=rest.includes('--resume')?rest[rest.indexOf('--resume')+1]:null;
 if(rest.includes('--resume')&&(!resume||resume.startsWith('--')))throw Error('--resume requires a task ID');
 if(rest.some(x=>x.startsWith('--')&&!['--resume','--no-publish','--agent'].includes(x)))throw Error('unknown option');
 const positional=rest.filter((x,i)=>x!=='--no-publish'&&x!=='--resume'&&x!=='--agent'&&rest[i-1]!=='--resume'&&rest[i-1]!=='--agent');
 const [siteKey,sectionId,mode,briefFile]=positional;
 if(!siteKey||!sectionId||!mode||positional.length>4||(!resume&&!briefFile))throw Error('Usage: produce <site> <sectionId> <mode> <briefFile> [--no-publish] [--resume <taskId>] [--agent <agentId>] [--allow-network] [--mount spec] [--mounts file.json]');
 return {siteKey,sectionId,mode,briefFile,noPublish,resume,...(agentId?{agentId}:{}),mounts:parsed.mounts,allowNetwork:parsed.allowNetwork};
}

export async function produce(argv=process.argv.slice(2)){
 const args=parseArgs(argv);
 const ctx=applySiteEnv(args.siteKey);
 // Heading/skill contracts bind at module load, after selecting the site.
 const {IMAGE_PRIORITY,finalizeNotebook,publicationMetadataFromNotebook}=await import('../notebook-finalize.mjs');
 const {brandSeeds}=await import('../brand-library.mjs');
 const {validateSectionId}=await import('../../../../contracts/site-sections.mjs');
 validateSectionId(args.sectionId,ctx.site);
 const {COMPLETION_PROMPT}=await import('../notebook-completion.mjs');
 const {createWebsitePublisher}=await import('../../../../scripts/website-publication.mjs');
 const {checkArticle}=await import('../../../../editorial/_ops/scripts/check-article.mjs');
 const {sha}=await import('../../../../scripts/editorial-workspace.mjs');
 const {publicationDirectory}=await import('../../../../scripts/site-config.mjs');
 const stamp=Date.now(),tag=`${ctx.siteId}-${args.sectionId}`,log=join(ctx.home,`${tag}-${stamp}.log`);
 const timing=[],result={site:ctx.siteId,sectionId:args.sectionId,mode:args.mode,noPublish:args.noPublish,...(args.briefFile?{briefFile:resolve(args.briefFile)}:{})};
 const out=join(ctx.home,'results',`${tag}-${stamp}.result.json`);
 const checkpoint=()=>{writeFileSync(out+'.tmp',JSON.stringify(result,null,1),{mode:0o600});renameSync(out+'.tmp',out);};
 const L=(...a)=>{const s=new Date().toISOString()+' ['+tag+'] '+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');console.log(s.slice(0,500));appendFileSync(log,s+'\n');};
 const env=cursorPathEnv({...process.env,SCHOLAY_EDITORIAL_ROOT:ctx.root,...(ctx.site.id!=='scholay-today'||process.env.SCHOLAY_SITE_CONFIG?{SCHOLAY_SITE_CONFIG:process.env.SCHOLAY_SITE_CONFIG,SCHOLAY_SITE_JSON:process.env.SCHOLAY_SITE_JSON,SCHOLAY_SITE_ID:process.env.SCHOLAY_SITE_ID}:{})});
 const b=spawn(process.execPath,[join(repoRoot,'desktop/scripts/agent/bridge.mjs')],{cwd:repoRoot,env,stdio:['pipe','pipe','pipe']});
 b.stderr.on('data',d=>appendFileSync(log,'STDERR '+d));
 const bridge=createBridgeClient(b,{onEvent:e=>{if(['progress','error','request'].includes(e.type))L(e.type,(e.text||e.title||'').slice(0,200));}});
 const {call,idleOf}=bridge;
 const target={siteId:ctx.siteId,sectionId:args.sectionId,mode:args.mode};
 const client=createWebsitePublisher({root:ctx.root,site:ctx.site,tokenFile:ctx.tokenFile});
 const recordReceipt=st=>{
  result.status=st?.status;result.publicReadback=!!st?.publicReadback;result.jobStatus=st?.job?.status;result.requestKey=st?.requestKey;
  if(st?.url)result.url=new URL(st.url,ctx.site.origin).href;
  checkpoint();
 };
 async function agent(tid,label,params){assertHeadlessTarget(await call('task_get',{taskId:tid}),target);const t0=Date.now();const r=await call('notebook_prompt',{taskId:tid,...params});L('RUN',label,r.runId);const st=await idleOf(tid,r.runId);timing.push({step:label,ms:Date.now()-t0,status:st.status});L('DONE',label,st.status,(Date.now()-t0)+'ms');return assertHeadlessTarget(await call('task_get',{taskId:tid}),target);}
 const T0=Date.now();let t;
 try{
  if(args.resume&&args.agentId){const saved=await call('task_get',{taskId:args.resume});if((saved.agentId||'cursor')!==args.agentId)throw Error('恢复任务时不能更换智能体');}
  if(!args.resume){
   const parsedBrief=parseBriefMounts(readFileSync(args.briefFile,'utf8'));
   const text=parsedBrief.text.trim();
   const brief=text.includes('配图优先级')?text:text+'\n'+IMAGE_PRIORITY;
   t=await call('task_create',{agentId:args.agentId,mode:args.mode,title:brief.replace(/\s+/g,' ').slice(0,48),brief:'',days:args.mode==='xiwen'?7:30});
   Object.assign(result,{taskId:t.id,articleId:t.articleId});checkpoint();
   t=await call('task_update',{taskId:t.id,patch:{ui:{composer:brief}}});t=await call('notebook_open',{taskId:t.id});
   t=await call('task_update',{taskId:t.id,patch:{notebook:{...t.notebook,sectionId:args.sectionId}},expectedRevision:t.revision});
   const mounts=await loadMountList([...(args.mounts||[]),...parsedBrief.mounts]);
   if(args.allowNetwork||parsedBrief.allowNetwork)await call('context_network',{taskId:t.id,allowNetwork:true});
   if(mounts.length){
    let signals;
    if(mounts.some(m=>m.kind==='signals')){
     const {loadSignals}=await import('../resources/signals.mjs');
     const loaded=await loadSignals();
     if(loaded.configured)signals=loaded.raw;
    }
    await call('context_mounts',{taskId:t.id,mounts,signals});
    L('mounts',mounts.map(m=>m.kind).join(','));
   }
   L('task',t.id,t.articleId,'kind',t.notebook.kind,'section',t.notebook.sectionId);
   t=await agent(t.id,'organize',{text:brief,sources:'combined',action:'organize',expectedRevision:t.revision});
   if(/异常/.test(timing.at(-1)?.status||'')){L('organize retry after agent error');t=await agent(t.id,'organize-retry',{text:'上一轮整理因智能体异常中断。请在现有文章板基础上继续完成整理（保留已有内容与来源）：\n'+brief,sources:'combined',action:'organize',expectedRevision:t.revision});}
   let pre=await call('notebook_check',{taskId:t.id,phase:'prepare'});L('preflight',pre.ready,pre.issues);
   for(let i=0;i<2&&!pre.ready;i++){t=await agent(t.id,'fix-'+i,{text:'补齐预检缺项（只补缺，不改已写内容）：'+pre.issues.join('；')+'。属性字段写入 notebook.fields，取值必须来自已核实来源；图片位置写清 requirement。结构化记录不要新增二级标题。',sources:'combined',action:'organize',expectedRevision:t.revision});pre=await call('notebook_check',{taskId:t.id,phase:'prepare'});L('preflight',pre.ready,pre.issues);}
   if(!pre.ready)throw Error('preflight: '+pre.issues.join('；'));
   t=await agent(t.id,'complete',{text:COMPLETION_PROMPT,action:'complete',sources:'combined',expectedRevision:t.revision});
  }else{
   t=await call('task_get',{taskId:args.resume});
   assertHeadlessTarget(t,target,{allowMissingNotebook:true});
   Object.assign(result,{taskId:t.id,articleId:t.articleId});checkpoint();
   const receiptFile=join(publicationDirectory(ctx.root),t.articleId,'receipt.json');
   if(existsSync(receiptFile)&&JSON.parse(readFileSync(receiptFile,'utf8')).requestKey){
    if(args.noPublish)throw Error('saved publication request exists; resume without --no-publish to query it before editing');
    // Query first; never rewrite or resubmit an uncertain publication.
    await confirmPublication(client,t.articleId,{onReceipt:recordReceipt});
    return result;
   }
   if(!t.completedAt){
    const brief=args.briefFile&&existsSync(args.briefFile)?parseBriefMounts(readFileSync(args.briefFile,'utf8')).text.trim():t.ui?.composer||t.brief||'';
    if(!t.notebook){
     if(!brief)throw Error('resume needs the original brief to initialize the saved task');
     t=await call('notebook_open',{taskId:t.id});
     t=await call('task_update',{taskId:t.id,patch:{notebook:{...t.notebook,sectionId:args.sectionId}},expectedRevision:t.revision});
     t=await agent(t.id,'resume-organize',{text:brief,sources:'combined',action:'organize',expectedRevision:t.revision});
    }
    let pre=await call('notebook_check',{taskId:t.id,phase:'prepare'});
    if(!pre.ready){
     t=await agent(t.id,'resume-prepare',{text:'继续原任务，只补齐预检缺项并保留已有内容：'+pre.issues.join('；')+'。原始要求：'+brief,sources:'combined',action:'organize',expectedRevision:t.revision});
     pre=await call('notebook_check',{taskId:t.id,phase:'prepare'});
    }
    if(!pre.ready)throw Error('preflight: '+pre.issues.join('；'));
    t=await agent(t.id,'resume-complete',{text:COMPLETION_PROMPT,action:'complete',sources:'combined',expectedRevision:t.revision});
   }
  }
  result.taskId=t.id;result.articleId=t.articleId;
  if(!t.completedAt){
   const open=t.notebook.blocks.filter(x=>x.type==='image'&&x.state==='placeholder');L('unfilled images',open.length);
   for(const im of open){t=await call('task_get',{taskId:t.id});t=await agent(t.id,'image-gen',{text:(im.requirement||'按占位要求生成示意图')+'。生成方式及配图与正文的关系写入对应行的内部 images 备注，公开图注只保留帮助读者识图的说明与必要署名，并填写 alt。',action:'image',targetIds:[im.id],imageMethod:'generate',expectedRevision:t.revision});}
   t=await call('task_get',{taskId:t.id});
   const left=t.notebook.blocks.filter(x=>x.state==='placeholder');
   if(left.length&&!t.completedAt){L('retry placeholders',left.map(x=>x.type+':'+(x.role||'')));t=await agent(t.id,'complete-retry',{text:'补全剩余占位：'+left.map(x=>x.id+'('+x.type+(x.role?'/'+x.role:'')+')').join('、')+'。图注写明图片来源与许可（AI 生成的写“AI 生成示意图”），不改已有正文。结构化记录不要新增二级标题。',action:'complete',sources:'combined',expectedRevision:t.revision});}
  }
  t=await call('task_get',{taskId:t.id});
  if(!t.notebook.blocks.some(x=>x.type==='image')){
   if(t.completedAt)t=await call('notebook_reopen',{taskId:t.id,expectedRevision:t.revision});
   L('no image blocks: adding slots');
   t=await agent(t.id,'add-image-slots',{text:'文章板缺少配图。请只新增图片位置：在标题后加 1 个题图位置、在正文中合适位置加 1 个配图位置（type=image，state=placeholder，requirement 写清画面内容），各配一个 caption 占位；不改已有正文，不要新增二级标题。',sources:'combined',action:'organize',expectedRevision:t.revision});
   t=await agent(t.id,'complete-images',{text:COMPLETION_PROMPT+' 每张图片填写 alt。',action:'complete',sources:'combined',expectedRevision:t.revision});
   const open2=t.notebook.blocks.filter(x=>x.type==='image'&&x.state==='placeholder');
   for(const im of open2){t=await call('task_get',{taskId:t.id});t=await agent(t.id,'image-gen',{text:(im.requirement||'按占位要求生成示意图')+'。生成方式及配图与正文的关系写入对应行的内部 images 备注，公开图注只保留帮助读者识图的说明与必要署名，并填写 alt。',action:'image',targetIds:[im.id],imageMethod:'generate',expectedRevision:t.revision});}
   t=await call('task_get',{taskId:t.id});
  }
  t=await call('task_get',{taskId:t.id});if(t.completedAt)t=await call('notebook_reopen',{taskId:t.id,expectedRevision:t.revision});
  const finalized=finalizeNotebook(t.notebook,{siteId:ctx.site.id,brands:brandSeeds()});
  t=await call('task_update',{taskId:t.id,patch:{notebook:finalized.notebook},expectedRevision:t.revision});
  L('finalize','images',finalized.images.length,'alts',finalized.images.map(x=>x.alt),'endnotes',finalized.added);
  const c=await call('notebook_check',{taskId:t.id});L('check',c.ready,c.issues);if(!c.ready)throw Error('check: '+c.issues.join('；'));
  assertHeadlessTarget(await call('task_get',{taskId:t.id}),target);
  t=await call('notebook_export',{taskId:t.id,expectedRevision:t.revision});result.articleId=t.articleId;result.canonicalPath=t.delivery?.canonicalPath;L('exported',t.delivery?.canonicalPath);
  const id=t.articleId;let cur=await client.inspect(id);
  const generated=publicationMetadataFromNotebook(t.notebook,ctx.site,cur);
  if(cur.metadata?.sectionId!==args.sectionId)throw Error('exported section does not match headless target');
  const meta={...cur.metadata,summary:cur.metadata.summary||generated.summary,date:cur.metadata.date||generated.date,author:cur.metadata.author||generated.author,category:cur.metadata.category||generated.category};
  if(meta.summary!==cur.metadata.summary||meta.date!==cur.metadata.date){
   await client.localAction(id,{action:'metadata',metadata:meta,expectedSourceSha256:cur.sourceSha256,expectedMetadataSha256:cur.metadataSha256});
  }
  result.title=t.notebook.title;result.summary=meta.summary;result.date=meta.date;
  const ck=await checkArticle(ctx.root,id);L('check-article',ck.issues);result.checkIssues=ck.issues;if(ck.issues.length)throw Error('check-article: '+ck.issues.join('; '));
  if(!args.noPublish){
   const prep=await client.prepare(id);result.url=prep.prepared?.url;L('prepared',prep.prepared?.url);
   await client.inspect(id);
   const packet=JSON.parse(readFileSync(join(publicationDirectory(ctx.root),id,'prepared.json'),'utf8'));
   const rc=(await client.publish(id,{packetSha256:sha(JSON.stringify(packet))})).receipt;L('published',rc?.status,rc?.url);
   const st=await confirmPublication(client,id,{onReceipt:recordReceipt});
   L('status',{status:st?.status,readback:st?.publicReadback,url:result.url,job:st?.job?.status});
  }
 }catch(e){L('FAIL',e.stack||e.message);result.error=e.message;process.exitCode=1;}
 finally{
  result.ms=Date.now()-T0;result.taskId??=t?.id;result.timing=timing;
  checkpoint();L('RESULT',result);
  await bridge.close();
 }
 return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=await headlessEntry('produce',process.argv.slice(2),async()=>{const r=await produce();return r?.error?1:0;});}
 catch(e){console.error(e);process.exitCode=1;}
}
