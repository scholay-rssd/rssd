import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {unzip} from './zip.mjs';

const hash=buf=>createHash('sha256').update(buf).digest('hex');
const textOf=html=>String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();

function headingsFromMarkdown(text){
 const chapters=[];
 const lines=text.split(/\r?\n/);
 let current={id:'intro',title:'正文',level:0,startLine:1,text:''};
 for(let i=0;i<lines.length;i++){
  const match=lines[i].match(/^(#{1,6})\s+(.+)$/);
  if(match){
   if(current.text.trim()||chapters.length)chapters.push({...current,text:current.text.trim()});
   current={id:'h'+(chapters.length+1),title:match[2].trim(),level:match[1].length,startLine:i+1,text:''};
  }else current.text+=(current.text?'\n':'')+lines[i];
 }
 if(current.text.trim()||!chapters.length)chapters.push({...current,text:current.text.trim()});
 return chapters;
}

export function parsePlainText(bytes,kind='txt',name='document'){
 const text=Buffer.from(bytes).toString('utf8');
 const chapters=kind==='markdown'?headingsFromMarkdown(text):[{id:'body',title:name,level:0,startLine:1,text}];
 return {kind,name,contentHash:hash(bytes),chapters,pages:null,needsOcr:false,coverage:'full',locationKind:'line'};
}

function decodePdfString(raw){
 return raw.replace(/\\n/g,'\n').replace(/\\r/g,'\r').replace(/\\t/g,'\t').replace(/\\\(/g,'(').replace(/\\\)/g,')').replace(/\\\\/g,'\\').replace(/\\(\d{1,3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)));
}
function extractPdfOperators(content){
 const chunks=[];
 const tj=/(\((?:\\.|[^\\)])*\))\s*Tj/g;
 const TJ=/\[(.*?)\]\s*TJ/gs;
 let match;
 while((match=tj.exec(content)))chunks.push(decodePdfString(match[1].slice(1,-1)));
 while((match=TJ.exec(content))){
  const inner=match[1];
  for(const part of inner.match(/\((?:\\.|[^\\)])*\)/g)||[])chunks.push(decodePdfString(part.slice(1,-1)));
 }
 return chunks.join('');
}
function inflatePdfStream(raw){
 try{return inflateSync(raw).toString('latin1');}catch{return raw.toString('latin1');}
}
export function parsePdf(bytes,name='document.pdf'){
 const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
 if(!data.subarray(0,5).toString().startsWith('%PDF'))throw Error('不是 PDF 文件');
 const source=data.toString('latin1');
 const pages=[];
 const streamRe=/stream\r?\n([\s\S]*?)\r?\nendstream/g;
 let match,index=0;
 while((match=streamRe.exec(source))){
  const headerStart=source.lastIndexOf('obj',match.index);
  const header=source.slice(Math.max(0,headerStart-80),match.index);
  const payload=Buffer.from(match[1],'latin1');
  const decoded=/\/FlateDecode/.test(header)?inflatePdfStream(payload):payload.toString('latin1');
  const text=extractPdfOperators(decoded).replace(/\s+/g,' ').trim();
  if(text)pages.push({id:'p'+(++index),page:index,title:'第 '+index+' 页',text});
 }
 const pageCount=(source.match(/\/Type\s*\/Page[^s]/g)||[]).length||pages.length||1;
 const joined=pages.map(p=>p.text).join('\n');
 const needsOcr=joined.replace(/\s/g,'').length<40&&data.length>4000;
 return {
  kind:'pdf',name,contentHash:hash(data),
  chapters:pages.map(p=>({id:p.id,title:p.title,level:1,startLine:p.page,text:p.text})),
  pages:pages.map(p=>({page:p.page,text:p.text})),
  needsOcr,coverage:needsOcr?'none':(pages.length<pageCount?'partial':'full'),
  locationKind:'page',pageCount,
 };
}

function xmlAttr(tag,name){return (tag.match(new RegExp(name+'="([^"]+)"'))||[])[1]||(tag.match(new RegExp(name+"='([^']+)'"))||[])[1]||'';}
function resolveHref(base,href){
 if(!href)return href;
 if(/^[a-z]+:/i.test(href))return href;
 const root=base.replace(/[^/]+$/, '');
 const parts=(root+href.split('#')[0]).split('/');
 const out=[];
 for(const part of parts){if(part==='..')out.pop();else if(part&&part!=='.')out.push(part);}
 return out.join('/');
}
export function parseEpub(bytes,name='book.epub'){
 const files=unzip(bytes);
 const container=(files.get('META-INF/container.xml')||files.get('meta-inf/container.xml'))?.toString('utf8');
 if(!container)throw Error('EPUB 缺少 container.xml');
 const rootfile=xmlAttr(container.match(/<rootfile\b[^>]+>/)?.[0]||'','full-path');
 if(!rootfile||!files.has(rootfile))throw Error('EPUB 缺少 OPF 目录');
 const opf=files.get(rootfile).toString('utf8');
 const base=rootfile.replace(/[^/]+$/,'');
 const manifest=new Map();
 for(const tag of opf.match(/<item\b[^>]+\/?>/g)||[]){
  const id=xmlAttr(tag,'id'),href=xmlAttr(tag,'href');
  if(id&&href)manifest.set(id,{href:resolveHref(base,href),media:xmlAttr(tag,'media-type')});
 }
 const spine=[...opf.matchAll(/<itemref\b[^>]+>/g)].map(m=>xmlAttr(m[0],'idref')).filter(id=>manifest.has(id));
 const navItem=[...manifest.values()].find(item=>/xhtml|html|xml/i.test(item.media||'')&&/nav|toc/i.test(item.href));
 const titles=new Map();
 if(navItem&&files.has(navItem.href)){
  const nav=files.get(navItem.href).toString('utf8');
  for(const link of nav.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi)||[]){
   const href=resolveHref(navItem.href.replace(/[^/]+$/,''),xmlAttr(link,'href'));
   titles.set(href.split('#')[0],textOf(link));
  }
 }
 const chapters=[];
 for(const [index,id] of spine.entries()){
  const item=manifest.get(id);if(!item||!files.has(item.href))continue;
  if(!/html|xml|xhtml/i.test(item.media||item.href))continue;
  const raw=files.get(item.href).toString('utf8');
  const title=titles.get(item.href)||textOf(raw.match(/<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/i)?.[0]||'')||('第 '+(index+1)+' 章');
  chapters.push({id:'c'+(index+1),title:title.slice(0,200),level:1,startLine:index+1,path:item.href,text:textOf(raw)});
 }
 if(!chapters.length)throw Error('EPUB 没有可提取的章节文字');
 const bookTitle=textOf(opf.match(/<dc:title[^>]*>[\s\S]*?<\/dc:title>/i)?.[0]||'')||name;
 return {kind:'epub',name:bookTitle,contentHash:hash(Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes)),chapters,pages:null,needsOcr:false,coverage:'full',locationKind:'chapter'};
}

export function detectKind(name='',bytes=Buffer.alloc(0)){
 const lower=name.toLowerCase();
 if(lower.endsWith('.epub')||bytes.subarray(0,2).toString()==='PK')return lower.endsWith('.pdf')?'pdf':(lower.endsWith('.md')||lower.endsWith('.markdown')?'markdown':(lower.endsWith('.txt')?'txt':'epub'));
 if(lower.endsWith('.pdf')||bytes.subarray(0,5).toString()==='%PDF-')return 'pdf';
 if(lower.endsWith('.md')||lower.endsWith('.markdown'))return 'markdown';
 if(lower.endsWith('.txt'))return 'txt';
 if(bytes.subarray(0,5).toString()==='%PDF-')return 'pdf';
 return 'txt';
}

export function parseDocument(bytes,name='document'){
 const kind=detectKind(name,bytes);
 if(kind==='epub')return parseEpub(bytes,name);
 if(kind==='pdf')return parsePdf(bytes,name);
 return parsePlainText(bytes,kind==='markdown'?'markdown':'txt',name);
}

export function sliceDocument(parsed,scope={}){
 if(!parsed?.chapters?.length)return {chapters:[],coverage:'none',note:'没有可读取的文字'};
 if(parsed.kind==='pdf'&&(scope.pages||scope.pageFrom||scope.pageTo)){
  const from=Number(scope.pageFrom||scope.pages?.split('-')[0]||1);
  const to=Number(scope.pageTo||scope.pages?.split('-')[1]||parsed.pageCount||parsed.chapters.length);
  const chapters=parsed.chapters.filter(ch=>ch.startLine>=from&&ch.startLine<=to);
  return {chapters,coverage:chapters.length?'partial':'none',note:chapters.length?`第 ${from}–${to} 页`:'指定页码没有文字'};
 }
 if(scope.whole===true||scope.mode==='whole'||(!scope.chapters&&!scope.chapterIds))return {chapters:parsed.chapters,coverage:parsed.coverage,note:'整本'};
 const wanted=new Set((scope.chapterIds||[]).map(String));
 if(scope.chapters){
  const [a,b]=String(scope.chapters).split('-').map(n=>Number(n));
  parsed.chapters.forEach((ch,i)=>{if(i+1>=a&&i+1<=(b||a))wanted.add(ch.id);});
 }
 const chapters=parsed.chapters.filter((ch,i)=>wanted.has(ch.id)||wanted.has(String(i+1)));
 return {chapters,coverage:chapters.length?(chapters.length===parsed.chapters.length?'full':'partial'):'none',note:chapters.map(ch=>ch.title).join('、')||'未选章节'};
}
