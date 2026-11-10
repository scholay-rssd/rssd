// A narrow, recoverable notebook reference correction. Never accepts arbitrary
// body edits or any self-declared authorization in place of the current Center
// edition. The native caller supplies the authenticated, identity-bound client.
import {lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import MarkdownIt from 'markdown-it';
import protocol from '../contracts/rssd-v1.cjs';
import {cleanNotebookCitations,cleanCitationText,cleanCitationUrl} from './clean-citation-urls.mjs';
import {verifyAutomatedReferences} from './rssd-reference-gate.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {notebookMarkdown} from '../desktop/scripts/agent/notebook.mjs';
const markdown=new MarkdownIt({html:false,linkify:true});
const referenceNames=new Set(['参考文献','参考资料','资料来源','来源','references','sources']);
function referenceUrls(body){
 const tokens=markdown.parse(body,{}),found=new Set();let active=false,level=0,count=0;
 for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.type==='heading_open'){const next=Number(t.tag.slice(1));if(active&&next<=level)active=false;const name=(tokens[i+1]?.content||'').trim().toLowerCase();if(referenceNames.has(name)){if(count++)throw Error('参考文献段落不唯一');active=true;level=next;}}
  if(active&&t.type==='inline')for(const child of t.children||[])if(child.type==='link_open'){const href=child.attrGet('href');if(href&&/^https?:/i.test(href))found.add(cleanCitationUrl(href).replace(/\/$/,''));}}
 if(count!==1)throw Error('需要唯一的参考文献段落');return found;
}
// Compare the actual manuscript outside bibliography sections.  The
// correction is not authorized to repair other pre-existing divergence
// between Markdown and its structured notebook, including locked blocks.
function withoutReferences(body){
 const tokens=markdown.parse(body,{}),lines=body.split('\n'),sections=[];let active=null;
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];if(token.type!=='heading_open')continue;
  const level=Number(token.tag.slice(1)),name=(tokens[i+1]?.content||'').trim().toLowerCase();
  if(active&&level<=active.level){sections.push([active.start,token.map[0]]);active=null;}
  if(referenceNames.has(name)){if(active)throw Error('参考文献段落嵌套');active={start:token.map[0],level};}
 }
 if(active)sections.push([active.start,lines.length]);
 return lines.filter((_,i)=>!sections.some(([start,end])=>i>=start&&i<end)).join('\n').trimEnd();
}
// Preserve each pre-existing bibliography entry, including its title and
// other publication details, even when the notebook renderer changes order.
function referenceEntries(body){
 const tokens=markdown.parse(body,{}),lines=body.split('\n'),entries=[];let active=false,level=0;
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];if(token.type==='heading_open'){
   const next=Number(token.tag.slice(1)),name=(tokens[i+1]?.content||'').trim().toLowerCase();
   if(active&&next<=level)active=false;
   else if(active)throw Error('参考文献含嵌套标题，请人工核对');
   if(referenceNames.has(name)){active=true;level=next;}continue;
  }
  if(active&&token.level===0&&!['heading_close','ordered_list_open','ordered_list_close','bullet_list_open','bullet_list_close','paragraph_open','paragraph_close','inline'].includes(token.type))throw Error('参考文献含复杂结构，请人工核对');
  if(active&&((token.type==='list_item_open'&&token.level===1)||(token.type==='paragraph_open'&&token.level===0))&&token.map){
   // Nested lists contain independent details; retain them inside their
   // parent entry rather than comparing them as unrelated references.
   const value=lines.slice(...token.map).join('\n').replace(/^\s*(?:\d+[.)]|[-+*])\s+/,'').trim();
   if(value)entries.push(value.replace(/\s+/g,' '));
  }
 }
 return entries;
}
export function expectedReferenceRevision(current){
 const next=structuredClone(protocol.edition(current)),n=next.metadata?.notebook;
 if(!n||n.version!==2||!Array.isArray(n.blocks)||!Array.isArray(n.sources)||!n.sources.length||next.metadata.notebookBodyHash!==protocol.hash(next.bodyMarkdown))throw Error('原始 notebook 与正文不一致');
 const original=cleanCitationText(next.bodyMarkdown),originalUrls=referenceUrls(original),originalEntries=referenceEntries(original);
 next.metadata.notebook=cleanNotebookCitations(n);
 next.sources=next.sources.map(source=>({...source,url:cleanCitationUrl(source.url)}));
 next.bodyMarkdown=notebookMarkdown(next.metadata.notebook,{site:null,locale:next.locale});
 if(withoutReferences(original)!==withoutReferences(next.bodyMarkdown))throw Error('原稿正文与 notebook 不一致，请人工核对');
 const renderedUrls=referenceUrls(next.bodyMarkdown),renderedEntries=referenceEntries(next.bodyMarkdown);
 if([...originalUrls].some(url=>!renderedUrls.has(url)))throw Error('修订会遗漏原有参考文献');
 for(const entry of originalEntries){const index=renderedEntries.indexOf(entry);if(index<0)throw Error('修订会改变原有参考文献详情');renderedEntries.splice(index,1);}
 next.metadata.notebookBodyHash=protocol.hash(next.bodyMarkdown);verifyAutomatedReferences(next);return protocol.edition(next);
}
async function prepared(home){
 const path=join(home,'prepared-reference-revision.json'),st=await lstat(path);
 if(!st.isFile()||st.size>5*1024*1024||st.size<2||(process.platform!=='win32'&&((st.mode&0o077)!==0||(typeof process.getuid==='function'&&st.uid!==process.getuid()))))throw Error('预备修订包必须是本机私有文件');
 const input=JSON.parse(await readFile(path,'utf8'));
 if(input?.version!==1||input.state!=='prepared_not_submitted'||!input.binding||!input.source||!input.packet)throw Error('预备修订包无效');
 const packet=protocol.submission(input.packet);
 if(packet.demandId||packet.claimToken||packet.editions.length!==1||input.source.revision!==packet.baseRevisions[packet.editions[0].locale]||input.source.revision<1||!/^[a-f0-9]{64}$/.test(input.source.sourceContentHash||''))throw Error('预备修订身份无效');
 return {input,packet};
}
export async function preparedReferencePreview(home){
 try{const {input,packet}=await prepared(home);return {workId:packet.workId,workspaceId:packet.workspaceId,locale:packet.editions[0].locale,title:packet.editions[0].title,baseRevision:input.source.revision,requestId:packet.requestId};}
 catch(error){if(error.code==='ENOENT')return null;return {error:'预备修订包无效，请检查本机文件'};}
}
export async function submitPreparedReferenceRevision({home,client,identity,outbox}){
 if(!client||!identity||!outbox)throw Error('需要已连接的中心');
 return withFileLock(join(home,'daemon.lock'),()=>withFileLock(join(home,'worker.lock'),async()=>{
  let active;try{active=JSON.parse(await readFile(join(home,'active-claim.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}if(active?.claim)throw Error('本机仍有未完成认领，请先恢复');
  const {input,packet}=await prepared(home),binding=input.binding,live=await client.identity();
  if(binding.origin!==client.origin||binding.orgId!==identity.orgId||binding.workerId!==identity.workerId||live.orgId!==identity.orgId||live.workerId!==identity.workerId||!Array.isArray(live.workspaceIds)||!live.workspaceIds.includes(packet.workspaceId))throw Error('预备包与当前中心或设备不一致');
  const old=await outbox.list(),existing=old.find(x=>x.requestId===packet.requestId);
  if(existing&&protocol.hash(existing.packet)!==protocol.hash(packet))throw Error('原请求 ID 已绑定其他内容');
  if(old.some(x=>x.requestId!==packet.requestId&&x.state!=='accepted'))throw Error('请先恢复本机未确认请求');
  // First query a retained request; if already accepted, the original outbox
  // verifies its receipt and avoids falsely rejecting the now-new revision.
  if(existing){let found;try{found=await client.submission(packet.requestId);}catch(error){if(error.status!==404)throw error;}if(found){if(existing.state==='accepted'&&protocol.hash(found)!==protocol.hash(existing.receipt))throw Error('原请求回执与中心不一致');return outbox.flushOne(packet.requestId,{retry:true});}if(existing.state==='accepted')throw Error('中心无法确认原请求，请保留回执核对');}
  const work=await client.work(packet.workId),current=work?.editions?.find(e=>e.locale===packet.editions[0].locale);
  if(work?.id!==packet.workId||work.workspaceId!==packet.workspaceId||work.sectionId!==packet.sectionId||current?.revision!==input.source.revision||protocol.hash(current.payload)!==input.source.sourceContentHash)throw Error('中心原稿或版本已改变，请重新准备修订');
  const expected=expectedReferenceRevision(current.payload);
  if(protocol.hash(expected)!==protocol.hash(packet.editions[0]))throw Error('修订超出来源和追踪参数范围');
  const entry=await outbox.enqueue(packet);return outbox.flushOne(entry.requestId,{retry:true});
 },{timeout:100}),{timeout:100});
}
