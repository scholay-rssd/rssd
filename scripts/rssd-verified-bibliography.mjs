// A separate proof for new tasks only. Never rewrite a source snapshot or an
// already-created model output, image plan, packet, or submission request.
import {access,lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import MarkdownIt from 'markdown-it';
import protocol from '../contracts/rssd-v1.cjs';
import {writeCenterJson} from './rssd-center-client.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {notebookMarkdown} from '../desktop/scripts/agent/notebook.mjs';
import {extractJatsBibliography,verifyJatsBibliography} from './rssd-jats-bibliography.mjs';

const pending=message=>Object.assign(Error(message),{code:'source_pending'});
const blockId='rssd-verified-bibliography-v1',field='rssdVerifiedBibliography';
const heading=new Set(['参考文献','参考资料','来源','资料来源','references','sources']);
const markdown=new MarkdownIt({html:false,linkify:true});
const esc=value=>String(value).replace(/[\\`*_{}\[\]<>]/g,'\\$&').replace(/[\r\n]/g,' ').trim();
async function readProof(directory){
 const file=join(directory,'source-evidence','bibliography-v1.json');let info;
 try{info=await lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid()||info.size>200000)throw pending('Saved bibliography evidence is unsafe');
 try{return JSON.parse(await readFile(file,'utf8'));}catch{throw pending('Saved bibliography evidence is invalid');}
}
async function exists(path){try{await access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function started(directory){
 for(const locale of ['zh-CN','en'])for(const suffix of ['prompt.txt','agent-output.txt','image-plan.json','result.json','packet.json'])if(await exists(join(directory,locale+'.'+suffix)))return true;
 return false;
}
/** Freeze only for a wholly new task; existing outputs never acquire proof. */
export async function prepareVerifiedBibliography({snapshot,directory,signal}={}){
 if(!snapshot||!directory)throw pending('Verified source snapshot is required for bibliography');
 const file=join(directory,'source-evidence','bibliography-v1.json');
 return withFileLock(file+'.lock',async()=>{
  const old=await readProof(directory);if(old)return verifyJatsBibliography(snapshot,old,{signal});
  if(await started(directory))return null;
  // A non-snapshot adapter cannot establish bibliographic fields. Keep its
  // existing title/link behavior; never treat model metadata as evidence.
  if(!Array.isArray(snapshot.records))return null;
  const proof=await extractJatsBibliography(snapshot,{signal});
  if(!proof.entries.some(entry=>entry.kind==='jats'))return null;
  await writeCenterJson(file,proof);return verifyJatsBibliography(snapshot,proof,{signal});
 });
}
function sourceEntry(source,proof){
 if(!source||typeof source.id!=='string'||typeof source.title!=='string'||typeof source.url!=='string')throw pending('Notebook bibliography source is invalid');
 const matches=proof.entries.filter(entry=>entry.sourceUrl===source.url||(entry.aliases||[]).includes(source.url));
 if(matches.length!==1||matches[0].title!==source.title)throw pending('Bibliography title or source identity differs from verified source');
 return matches[0];
}
function lines(notebook,proof,locale){
 if(!Array.isArray(notebook?.sources)||!notebook.sources.length)throw pending('Notebook bibliography has no verified sources');
 const lines=notebook.sources.map(source=>{
  const entry=sourceEntry(source,proof),title=esc(entry.title),url=source.url;
  if(!/^https:\/\/[^\s()<>]+$/.test(url))throw pending('Bibliography URL is not safe for Markdown');
  if(entry.kind==='link-only')return '- ['+title+']('+url+')';
  if(entry.kind!=='jats'||!Array.isArray(entry.authors)||!entry.authors.length)throw pending('Verified JATS bibliography is incomplete');
  const authors=entry.authors.map(author=>esc(author.given)+' '+esc(author.family)).join(', ');
  const location=entry.location?.kind==='article-number'?esc(entry.location.value):entry.location?.kind==='page-range'?esc(entry.location.first)+'–'+esc(entry.location.last):'';
  if(!authors||!entry.year||!entry.journal||!entry.volume||!location)throw pending('Verified JATS bibliography is incomplete');
  return '- '+authors+' ('+esc(entry.year)+'). ['+title+']('+url+'). *'+esc(entry.journal)+'*, '+esc(entry.volume)+', '+location+'.';
 });
 return '### '+(locale==='en'?'References':'参考文献')+'\n\n'+lines.join('\n');
}
function hasBibliography(notebook){
 for(const block of notebook.blocks||[]){
  if(block?.type==='heading'&&heading.has(String(block.text||'').trim().toLowerCase()))return true;
  if(!['paragraph','markdown'].includes(block?.type))continue;
  const tokens=markdown.parse(block.text||'',{});
  if(tokens.some((token,index)=>token.type==='heading_open'&&heading.has(String(tokens[index+1]?.content||'').trim().toLowerCase())))return true;
 }
 return false;
}
/** Add only verified data to a newly generated, not-yet-saved edition. */
export function applyVerifiedBibliography(edition,proof,locale){
 if(!proof)return edition;
 const output=structuredClone(edition),notebook=output?.metadata?.notebook;
 if(!notebook||!Array.isArray(notebook.blocks)||notebook.blocks.some(block=>block.id===blockId)||hasBibliography(notebook))throw pending('Existing bibliography requires separate review');
 const text=lines(notebook,proof,locale);
 notebook.blocks.push({id:blockId,type:'markdown',state:'ready',text,sourceIds:notebook.sources.map(source=>source.id)});
 output.bodyMarkdown=notebookMarkdown(notebook,{site:null,locale});output.metadata.notebookBodyHash=protocol.hash(output.bodyMarkdown);
 output.metadata[field]={version:1,metadataHash:proof.metadataHash};return output;
}
/** A new proof, if present, is re-derived from frozen bytes before use. */
export async function verifyVerifiedBibliography({snapshot,directory,edition,signal}={}){
 const marker=edition?.metadata?.[field],saved=await readProof(directory);
 if(!marker&&!saved)return {status:'legacy'};
 if(!marker||marker.version!==1||!saved||marker.metadataHash!==saved.metadataHash)throw pending('Original bibliography evidence is missing or differs');
 const proof=await verifyJatsBibliography(snapshot,saved,{signal}),notebook=edition?.metadata?.notebook;
 const blocks=notebook?.blocks?.filter(block=>block.id===blockId)||[];
 if(blocks.length!==1||blocks[0].type!=='markdown'||blocks[0].state!=='ready'||blocks[0].text!==lines(notebook,proof,edition.locale)||protocol.canonical(blocks[0].sourceIds)!==protocol.canonical(notebook.sources.map(source=>source.id)))throw pending('Bibliography differs from verified source evidence');
 if(edition.bodyMarkdown!==notebookMarkdown(notebook,{site:null,locale:edition.locale})||edition.metadata.notebookBodyHash!==protocol.hash(edition.bodyMarkdown))throw pending('Bibliography and notebook output differ');
 return {status:'verified',metadataHash:proof.metadataHash};
}
export const VERIFIED_BIBLIOGRAPHY_INSTRUCTIONS='参考文献将由程序根据冻结、独立核验的来源在交稿后确定性生成。本次不要自行新增参考文献或来源列表，也不要从原稿复制其参考文献内容行；正文和引用所需的 sources 与 sourceIds 仍须完整填写。';
