import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {basename,extname,join} from 'node:path';
import {parseDocument,sliceDocument} from './parse-document.mjs';

const hash=buf=>createHash('sha256').update(buf).digest('hex');
const ALLOWED=new Set(['.epub','.pdf','.md','.markdown','.txt']);

export function cacheDir(store,taskId){return join(store.dir(taskId),'resources','files');}

export async function importLocalFile(store,taskId,{path,name,data}){
 let bytes,filename;
 if(data){
  bytes=Buffer.from(data,'base64');
  filename=basename(name||'document.txt');
 }else{
  if(typeof path!=='string'||!path)throw Error('请提供本地文件路径');
  filename=basename(name||path);
  bytes=await readFile(path);
 }
 const ext=extname(filename).toLowerCase();
 if(!ALLOWED.has(ext))throw Error('第一版仅支持 EPUB、文本 PDF、Markdown 和 TXT');
 if(bytes.length>40*1024*1024)throw Error('文件过大，限 40 MB');
 const contentHash=hash(bytes);
 const dir=join(cacheDir(store,taskId),contentHash);
 await mkdir(dir,{recursive:true,mode:0o700});
 await writeFile(join(dir,'source'+ext),bytes,{mode:0o600});
 await writeFile(join(dir,'meta.json'),JSON.stringify({name:filename,originalPath:path||null,contentHash,bytes:bytes.length,importedAt:new Date().toISOString()}),{mode:0o600});
 let parsed;
 try{parsed=parseDocument(bytes,filename);}
 catch(error){return {contentHash,filename,bytes:bytes.length,parsed:null,state:'failed',error:error.message};}
 const state=parsed.needsOcr?'needs_ocr':parsed.coverage==='none'?'failed':'ready';
 return {contentHash,filename,bytes:bytes.length,parsed,state,error:parsed.needsOcr?'扫描 PDF 需文字识别，当前不能当作已可全文检索':undefined};
}

export async function loadImportedFile(store,taskId,contentHash,filenameHint='document'){
 const dir=join(cacheDir(store,taskId),contentHash);
 const ext=extname(filenameHint).toLowerCase()||'.txt';
 const candidates=['source'+ext,'source.epub','source.pdf','source.md','source.txt'];
 let bytes=null,name=filenameHint;
 for(const file of candidates){
  try{bytes=await readFile(join(dir,file));name=file.replace(/^source/,'document');break;}catch{}
 }
 if(!bytes)throw Error('本地副本不在当前空间，只能查看已有出处记录');
 return parseDocument(bytes,filenameHint||name);
}

export function resolveFileMount(imported,scope={}){
 if(!imported.parsed)return {kind:'file',title:imported.filename,locator:{contentHash:imported.contentHash,name:imported.filename},version:{contentHash:imported.contentHash,label:'import-failed',snapshot:{name:imported.filename}},state:'failed',error:imported.error,scope};
 const sliced=sliceDocument(imported.parsed,scope);
 const state=imported.parsed.needsOcr?'needs_ocr':sliced.chapters.length?(imported.state||'ready'):'failed';
 return {
  kind:'file',
  title:imported.parsed.name||imported.filename,
  locator:{contentHash:imported.contentHash,name:imported.filename,kind:imported.parsed.kind},
  version:{
   contentHash:imported.contentHash,
   label:sliced.note||imported.filename,
   snapshot:{kind:imported.parsed.kind,chapters:imported.parsed.chapters.map(ch=>({id:ch.id,title:ch.title,path:ch.path,startLine:ch.startLine})),pageCount:imported.parsed.pageCount,coverage:imported.parsed.coverage,needsOcr:imported.parsed.needsOcr,locationKind:imported.parsed.locationKind},
   gaps:[imported.parsed.needsOcr?'需文字识别':'',imported.parsed.coverage==='partial'?'部分页面没有可提取文字':''].filter(Boolean),
  },
  state,error:imported.error,scope:{...scope,selectedIds:sliced.chapters.map(ch=>ch.id)},
 };
}

export function searchFileChapters(parsed,scope,query){
 const sliced=sliceDocument(parsed,scope);
 const q=String(query||'').trim().toLowerCase();
 return sliced.chapters.filter(ch=>!q||ch.title.toLowerCase().includes(q)||ch.text.toLowerCase().includes(q)).map(ch=>({id:ch.id,title:ch.title,snippet:ch.text.slice(0,280),startLine:ch.startLine,path:ch.path}));
}

export function readFileFragment(parsed,scope,{chapterId,page,query,around=400}){
 const sliced=sliceDocument(parsed,scope);
 const chapter=chapterId?sliced.chapters.find(ch=>ch.id===chapterId):page?sliced.chapters.find(ch=>ch.startLine===Number(page)):sliced.chapters[0];
 if(!chapter)throw Error('读取范围不在本篇挂载的章节或页码内');
 let text=chapter.text,offset=0;
 if(query){
  const at=text.toLowerCase().indexOf(String(query).toLowerCase());
  if(at<0)throw Error('选定范围内没有这处文字');
  offset=Math.max(0,at-around);
  text=text.slice(offset,at+String(query).length+around);
 }
 const locator=parsed.locationKind==='page'?{page:chapter.startLine,offset}:{chapterId:chapter.id,title:chapter.title,path:chapter.path,offset};
 return {locator,text,title:chapter.title};
}
