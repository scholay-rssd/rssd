#!/usr/bin/env node
// Supplement pictures for an existing work: Codex places the picture slots (typesetting), then draws each one.
// Writes a proposal only: <out>/<work>/note.md, the pictures, and record.json. Nothing is synced or published.
//
//   node scripts/rssd-image-supplement.mjs --out <dir> <note.md> [...]
//
// The public caption gets only the site's AI disclosure. The drawing agent and model go to record.json,
// which is the internal record (and later the work's private notes), never into the article.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createCodexImageProvider} from './rssd-codex-image-provider.mjs';
import {generatedCaption} from './rssd-image-disclosure.mjs';

const MIN_PICTURES=2;
// One look for every picture on the site, so a work never mixes a painting with a photo-like picture.
export const HOUSE_STYLE='Soft hand-painted watercolour and coloured-pencil natural-history illustration on warm off-white paper texture; '+
 'muted natural palette (sage green, oat, warm brown, soft terracotta); gentle diffuse daylight; calm, uncluttered background fading to paper; '+
 'delicate fine linework; anatomically accurate animals and plants. Not a photograph, not photorealistic, not a 3D render; no hard shadows.';
const charCount=value=>[...String(value)].length;

/** Split a note into front matter and body blocks (paragraphs, headings, pictures), keeping each block's text. */
export function parseNote(content){
 const match=/^---\n([\s\S]*?)\n---\n?/.exec(content);
 const front=match?match[0]:'',body=content.slice(front.length);
 const blocks=body.split(/\n{2,}/).map(text=>text.replace(/^\n+|\n+$/g,'')).filter(Boolean).map((text,index)=>({index,text,
  kind:/^!\[/.test(text)?'image':/^#{1,6}\s/.test(text)?'heading':'paragraph'}));
 const meta=key=>(new RegExp('^'+key+':\\s*(.*)$','m').exec(match?.[1]||'')?.[1]||'').replace(/^["']|["']$/g,'').trim();
 return {front,blocks,meta:{title:meta('title'),locale:meta('rssd-locale')||'zh-CN',id:meta('rssd-id'),kind:meta('rssd-kind')}};
}

/** Blocks a picture may follow: not inside the references, not right after another picture or its caption. */
export function placeable(blocks){
 const refs=blocks.findIndex(b=>b.kind==='heading'&&/参考文献|参考资料|References|Sources/i.test(b.text));
 const end=refs<0?blocks.length:refs;
 return blocks.slice(0,end).filter(b=>{
  const next=blocks[b.index+1],prev=blocks[b.index-1];
  return b.kind!=='image'&&next?.kind!=='image'&&prev?.kind!=='image'&&b.kind!=='heading';
 }).map(b=>b.index);
}

export const PLAN_SCHEMA={type:'object',additionalProperties:false,required:['slots'],properties:{slots:{type:'array',items:{type:'object',additionalProperties:false,
 required:['after','role','requirement','alt','caption'],properties:{after:{type:'integer'},role:{type:'string',enum:['title','body']},requirement:{type:'string'},alt:{type:'string'},caption:{type:'string'}}}}}};

export function planPrompt({meta,blocks,count,allowed}){
 const zh=meta.locale!=='en';
 return 'You are the picture editor for a pet-care article. Decide where '+count+' new picture'+(count>1?'s go':' goes')+' and what each shows. Do not draw anything and do not run commands; only answer with JSON.\n'+
  'Rules:\n- "after" is the number of the block the picture follows; choose only from: '+allowed.join(', ')+'.\n'+
  (blocks.some(b=>b.kind==='image')?'- The article already has a picture; place new ones in other sections.\n':'- The first picture is the title picture (role "title"): place it after the opening paragraph. Any other is role "body", after the paragraph it illustrates best, in a different section.\n')+
  '- requirement: an English brief for the illustrator describing content only (subject, setting, composition, viewpoint; accurate anatomy and husbandry). Do not describe the art style or medium; one house style is applied to every picture.\n'+
  '- alt: '+(zh?'Chinese, 20–60 characters,':'English, 20–60 characters,')+' saying what the picture shows.\n'+
  '- caption: '+(zh?'one short Chinese sentence ending with 。':'one short English sentence')+', stating what the reader should notice; no source or AI label (added later).\n'+
  '- Show only what the article supports; do not invent products, brands or people.\n\n'+
  'Article title: '+meta.title+'\n\n'+blocks.map(b=>'['+b.index+'] '+(b.kind==='image'?'(existing picture)':b.text.slice(0,600))).join('\n\n');
}

function validatePlan(plan,{count,allowed}){
 const slots=plan?.slots;
 if(!Array.isArray(slots)||slots.length!==count)throw Error('Plan must have exactly '+count+' slots');
 if(new Set(slots.map(s=>s.after)).size!==slots.length)throw Error('Two pictures follow the same block');
 for(const s of slots){
  if(!allowed.includes(s.after))throw Error('Picture placed after block '+s.after+', which is not allowed');
  if(charCount(s.alt)<20||charCount(s.alt)>60)throw Error('Alt text must be 20–60 characters: '+s.alt);
  if(!s.requirement.trim()||!s.caption.trim()||/AI|生成|来源|Source/i.test(s.caption))throw Error('Caption is empty or carries a label: '+s.caption);
 }
 return slots.sort((a,b)=>a.after-b.after);
}

/** Ask Codex (text only) for the picture plan, constrained to PLAN_SCHEMA. */
export function askCodexPlan({prompt,directory,command=['npx','-y','@openai/codex']}){
 return new Promise((resolvePlan,reject)=>{
  const schema=join(directory,'plan-schema.json'),out=join(directory,'plan.json');
  writeFile(schema,JSON.stringify(PLAN_SCHEMA)).then(()=>{
   const child=spawn(command[0],[...command.slice(1),'exec','--skip-git-repo-check','--sandbox','read-only','-C',directory,'--output-schema',schema,'-o',out,'-'],{stdio:['pipe','ignore','pipe']});
   let errors='';child.stderr.on('data',c=>{errors=(errors+c).slice(-2000);});child.on('error',reject);
   child.on('close',async code=>{if(code!==0)return reject(Error('Codex planning failed: '+errors.trim().slice(-400)));try{resolvePlan(JSON.parse(await readFile(out,'utf8')));}catch(e){reject(e);}});
   child.stdin.end(prompt);
  },reject);
 });
}

export async function supplementNote(file,{out,provider,plan:planner=askCodexPlan,disclosures,style}){
 const content=await readFile(file,'utf8'),{front,blocks,meta}=parseNote(content);
 const existing=blocks.filter(b=>b.kind==='image').length,count=Math.max(0,MIN_PICTURES-existing);
 const workDir=join(out,meta.id||basename(file,'.md'));await mkdir(workDir,{recursive:true});
 if(!count)return {file,skipped:'already has '+existing+' pictures'};
 const allowed=placeable(blocks),saved=join(workDir,'plan.json');
 // A plan already made for this same note is kept, so changing the style redraws pictures without moving them.
 let planned=null;try{planned=validatePlan(JSON.parse(await readFile(saved,'utf8')),{count,allowed});}catch{}
 const slots=planned||validatePlan(await planner({prompt:planPrompt({meta,blocks,count,allowed}),directory:workDir}),{count,allowed});
 const pictures=[];
 for(const [i,slot] of slots.entries()){
  const requestId='supplement-'+createHash('sha256').update(JSON.stringify([meta.id,meta.locale,slot,style||HOUSE_STYLE])).digest('hex').slice(0,40);
  const scope={workspaceId:'pets',jobId:meta.id,blockId:'supplement-'+i,requirement:slot.requirement,style:style||HOUSE_STYLE,alt:slot.alt,caption:slot.caption};
  const result=await provider.start({requestId,scope});
  if(result.status!=='ready')throw Error('Picture '+(i+1)+' for '+meta.title+' is not ready: '+(result.reason||'pending'));
  // WebP for the article; re-encoding also drops the signed metadata, so the file itself does not show the model.
  const webp=await sharp(result.bytes).resize({width:1600,withoutEnlargement:true}).webp({quality:84}).toBuffer();
  const sha=createHash('sha256').update(webp).digest('hex'),name=sha+'.webp';
  await writeFile(join(workDir,name),webp);await writeFile(join(workDir,result.registration.sha256+'.original.png'),result.bytes);
  const caption=generatedCaption(slot.caption,disclosures?{disclosures}:{},meta.locale);
  pictures.push({...slot,requestId,file:name,sha256:sha,originalSha256:result.registration.sha256,publicCaption:caption,
   drawnBy:{agent:result.provenance.agent,model:result.provenance.model,service:result.provenance.service,threadId:result.provenance.threadId,drawnAt:result.provenance.drawnAt}});
 }
 const byAfter=new Map(pictures.map(p=>[p.after,p]));
 const body=blocks.flatMap(b=>{const p=byAfter.get(b.index);return p?[b.text,'!['+p.alt+'](../article-media/'+p.file+')',p.publicCaption]:[b.text];}).join('\n\n')+'\n';
 await writeFile(join(workDir,'note.md'),front+body);
 const record={version:1,workId:meta.id,locale:meta.locale,title:meta.title,source:resolve(file),sourceSha256:createHash('sha256').update(content).digest('hex'),pictures};
 await writeFile(join(workDir,'record.json'),JSON.stringify(record,null,2)+'\n');
 return {file,workDir,pictures:pictures.length};
}

/** The work's private record for these pictures: one completed `image` run per drawing and a line in 配图说明. */
export function privateAddition(record){
 const runs=record.pictures.map(p=>({runId:'codex-image-'+p.drawnBy.threadId,agentId:'codex',agentName:p.drawnBy.agent||'Codex',
  modelId:p.drawnBy.model||null,modelName:p.drawnBy.model||null,action:'image',status:'completed',startedAt:p.drawnBy.drawnAt||new Date().toISOString()}));
 const lines=record.pictures.map(p=>(p.role==='title'?'题图':'正文图')+'「'+p.alt+'」由 '+(p.drawnBy.agent||'Codex')+' · '+(p.drawnBy.model||'模型未标明')+' 绘制，素材 SHA-256：'+p.sha256+'。');
 return {modelSignatures:runs,internalNotes:{images:'Codex 补图：\n'+lines.join('\n')}};
}

/**
 * Put an approved proposal into the vault: the pictures into article-media, the note in place of the original
 * (only if the original is unchanged since the proposal), and the private record where Obsidian sends it with
 * the next draft save. Obsidian, not this script, talks to the Center.
 */
export async function applyProposal(workDir,vault){
 const record=JSON.parse(await readFile(join(workDir,'record.json'),'utf8'));
 const current=await readFile(record.source,'utf8');
 if(createHash('sha256').update(current).digest('hex')!==record.sourceSha256)throw Error(record.title+' changed in the vault since the pictures were planned; plan it again');
 if(!resolve(record.source).startsWith(resolve(vault)+'/'))throw Error('The work is outside this vault');
 await mkdir(join(vault,'article-media'),{recursive:true});
 for(const p of record.pictures)await writeFile(join(vault,'article-media',p.file),await readFile(join(workDir,p.file)),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 const additions=join(vault,'.rssd','private-additions');await mkdir(additions,{recursive:true});
 await writeFile(join(additions,record.workId+'.'+record.locale+'.json'),JSON.stringify(privateAddition(record),null,2)+'\n');
 await writeFile(record.source,await readFile(join(workDir,'note.md'),'utf8'));
 return {title:record.title,pictures:record.pictures.length};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 const args=process.argv.slice(2),at=args.indexOf('--out');
 if(args[0]==='--apply'){
  const vault=resolve(args[1]);if(!args[2])throw Error('Usage: rssd-image-supplement.mjs --apply <vault> <proposal dir> [...]');
  for(const dir of args.slice(2))console.log(JSON.stringify(await applyProposal(resolve(dir),vault)));
  process.exit(0);
 }
 if(at<0||!args[at+1])throw Error('Usage: rssd-image-supplement.mjs --out <dir> <note.md> [...]');
 const out=resolve(args[at+1]),files=args.filter((_,i)=>i!==at&&i!==at+1);
 const provider=createCodexImageProvider({stateDirectory:join(out,'.codex-requests'),enabled:true});
 for(const file of files){
  try{console.log(JSON.stringify(await supplementNote(resolve(file),{out,provider})));}
  catch(error){console.log(JSON.stringify({file,error:error.message}));process.exitCode=1;}
 }
}
