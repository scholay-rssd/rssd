import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';

const hash=text=>createHash('sha256').update(text).digest('hex');
const SKIP=/^(?:node_modules|\.git|dist|build|target|vendor|\.next|coverage)\//;
const BINARY=/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|mp4|mp3|wasm|exe|dll|so|dylib)$/i;

export function parseRepoRef(input){
 const raw=String(input.repo||input.url||'').trim();
 const matched=raw.match(/github\.com[:/]([^/]+)\/([^/#?]+)/i)||raw.match(/^([^/]+)\/([^@#]+)$/);
 if(!matched)throw Error('请输入公开仓库，例如 owner/repo 或 GitHub 地址');
 const owner=matched[1],repo=matched[2].replace(/\.git$/,'');
 if(!/^[A-Za-z0-9_.-]+$/.test(owner)||!/^[A-Za-z0-9_.-]+$/.test(repo)||['.','..'].includes(owner)||['.','..'].includes(repo))throw Error('仓库名称无效');
 return {owner,repo,ref:String(input.ref||input.sha||'HEAD').trim()||'HEAD'};
}

async function githubGet(url,fetcher,headers={}){
 let response;
 try{response=await fetcher(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'scholay-today-writing-context',...headers},signal:AbortSignal.timeout(20000)});}
 catch{throw Error('无法连接 GitHub：'+url);}
 if(response.status===404)throw Error('公开仓库不存在或当前无法匿名读取');
 if(response.status===403)throw Error('GitHub 读取被限制，请稍后重试');
 if(!response.ok)throw Error('GitHub 接口不可用（'+response.status+'）');
 return response.json();
}

export async function resolveCommit(owner,repo,ref,fetcher=fetch){
 if(/^[0-9a-f]{40}$/i.test(ref))return {sha:ref,label:ref.slice(0,7)};
 const commit=await githubGet(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,fetcher);
 if(!commit?.sha)throw Error('无法解析仓库版本');
 return {sha:commit.sha,label:(commit.sha||'').slice(0,7),message:commit.commit?.message||'',html:commit.html_url};
}

async function readTree(owner,repo,sha,fetcher,cache,truncatedNotice){
 const cached=cache.get(sha);if(cached)return cached;
 const tree=await githubGet(`https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,fetcher);
 const entries=Array.isArray(tree.tree)?tree.tree:[];
 const files=[];
 if(tree.truncated){
  truncatedNotice.push(sha);
  const top=await githubGet(`https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}`,fetcher);
  for(const item of top.tree||[]){
   if(item.type==='tree'){
    const child=await readTree(owner,repo,item.sha,fetcher,cache,truncatedNotice);
    for(const file of child)files.push({...file,path:item.path+'/'+file.path});
   }else if(item.type==='blob')files.push({path:item.path,sha:item.sha,size:item.size,type:item.type});
  }
 }else{
  for(const item of entries)if(item.type==='blob')files.push({path:item.path,sha:item.sha,size:item.size,type:item.type});
 }
 cache.set(sha,files);
 return files;
}

export async function resolveGithubMount(input,fetcher=fetch){
 const {owner,repo,ref}=parseRepoRef(input);
 const commit=await resolveCommit(owner,repo,ref,fetcher);
 const truncated=[];
 const files=await readTree(owner,repo,commit.sha,fetcher,new Map(),truncated);
 const dirs=(input.dirs||input.directories||[]).map(d=>String(d).replace(/^\/+/,'').replace(/\/?$/,'/').replace(/^\.$/,'')).filter(Boolean);
 const selected=files.filter(file=>{
  if(SKIP.test(file.path))return false;
  if(!dirs.length)return /^(readme|license|copying|docs\/)/i.test(file.path);
  return dirs.some(dir=>dir.endsWith('/')?file.path.startsWith(dir)||file.path===dir.slice(0,-1):file.path===dir||file.path.startsWith(dir+'/'));
 });
 return {
  kind:'github',
  title:`${owner}/${repo}@${commit.label}`,
  locator:{owner,repo,ref,commit:commit.sha},
  version:{
   contentHash:commit.sha,
   label:commit.label,
   snapshot:{owner,repo,ref,commit:commit.sha,message:commit.message,html:commit.html,dirs,files:selected.map(f=>({path:f.path,sha:f.sha,size:f.size})),treeTruncated:truncated.length>0,completeTree:truncated.length===0,fileCount:files.length,selectedCount:selected.length},
   gaps:[truncated.length?'目录树曾截断，已按子树补取，不能把部分树标成全仓已读':'',!selected.length?'选定目录没有可读文件':''].filter(Boolean),
  },
  state:selected.length?'ready':'partial',
  scope:{dirs,commit:commit.sha},
 };
}

export function cachePath(store,taskId,owner,repo,sha){return join(store.dir(taskId),'resources','github',owner,repo,sha);}

export function validateGithubPath(path){
 if(typeof path!=='string'||!path||path.includes('\\')||path.includes('\0')||path.includes(':')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('仓库文件路径无效');
 return path;
}
export async function readGithubFile(store,taskId,mount,path,fetcher=fetch){
 const version=mount.version?.snapshot||{};
 const {owner,repo,commit}=version;
 if(!owner||!repo||!commit)throw Error('缺少固定 commit');
 validateGithubPath(path);
 const allowed=new Set((version.files||[]).map(f=>f.path));
 if(!allowed.has(path))throw Error('文件不在本篇挂载的目录范围内');
 if(BINARY.test(path))throw Error('大型二进制不默认读取');
 const local=join(cachePath(store,taskId,owner,repo,commit),path);
 try{return {path,text:await readFile(local,'utf8'),cached:true};}catch{}
 const encodedPath=path.split('/').map(encodeURIComponent).join('/');
 const meta=await (fetcher(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(commit)}`,{headers:{Accept:'application/vnd.github.raw','User-Agent':'scholay-today-writing-context'},signal:AbortSignal.timeout(20000)}).catch(()=>null));
 if(!meta||!meta.ok)throw Error('无法读取仓库文件：'+path);
 const text=await meta.text();
 if(text.length>400000)throw Error('文件过大，已停止读取');
 await mkdir(join(local,'..'),{recursive:true,mode:0o700});
 await writeFile(local,text,{mode:0o600});
 return {path,text,cached:false};
}

export function githubPermalink(owner,repo,commit,path,start,end){
 return `https://github.com/${owner}/${repo}/blob/${commit}/${path}`+(start?`#L${start}`+(end&&end!==start?`-L${end}`:''):'');
}
export function fileEvidence(owner,repo,commit,path,text,start=1){
 const lines=text.split(/\r?\n/);
 const end=start+lines.length-1;
 return {locator:{owner,repo,commit,path,startLine:start,endLine:end,url:githubPermalink(owner,repo,commit,path,start,end)},hash:hash(text),text};
}
