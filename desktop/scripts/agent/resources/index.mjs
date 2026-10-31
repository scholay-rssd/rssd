import {listRssLibrary,browseRss,resolveRssMount,searchRssMount,readRssArticle} from './rss.mjs';
import {resolveWebMount,readPublicPage,webSearchCandidate,knownUrlCandidate} from './web.mjs';
import {importLocalFile,loadImportedFile,resolveFileMount,searchFileChapters,readFileFragment} from './file.mjs';
import {resolveGithubMount,readGithubFile,fileEvidence} from './github.mjs';
import {loadSignals,resolveSignalsMount} from './signals.mjs';
import {listExistingMaterials,readExistingWork,resolveExistingMount} from './existing.mjs';

export const CONNECTORS=[
 {id:'rss',name:'RSS 资料库'},
 {id:'web',name:'联网搜索'},
 {id:'file',name:'本地文件'},
 {id:'github',name:'GitHub 仓库'},
 {id:'signals',name:'热榜与标签'},
 {id:'existing',name:'已有资料'},
];

export async function listConnectors(spaceId,root,{signals}={}){
 const rss=listRssLibrary(spaceId,root);
 const signal=signals||await loadSignals().catch(()=>({configured:false,reason:'无法读取热榜',items:[]}));
 return CONNECTORS.map(item=>{
  if(item.id==='rss')return {...item,available:rss.available,configured:rss.available,reason:rss.reason,folders:rss.folders,feeds:rss.feeds,starred:rss.starred};
  if(item.id==='signals')return {...item,available:signal.configured,configured:signal.configured,reason:signal.reason,count:signal.items?.length||0};
  if(item.id==='web')return {...item,available:true,configured:true,reason:'搜索结果进入候选；读取页面后才是证据'};
  if(item.id==='file')return {...item,available:true,configured:true};
  if(item.id==='github')return {...item,available:true,configured:true,reason:'第一版仅匿名读取公开仓库'};
  return {...item,available:true,configured:true,reason:'只读取材，不改原记录'};
 });
}

export async function browseConnector(kind,spaceId,root,query=''){
 if(kind==='rss')return browseRss(spaceId,root,query);
 if(kind==='existing')return {items:await listExistingMaterials(root,{query})};
 if(kind==='signals')return loadSignals();
 if(kind==='web')return {hint:'输入关键词得到候选，或粘贴已知网址'};
 if(kind==='file')return {hint:'导入 EPUB / PDF / Markdown / TXT'};
 if(kind==='github')return {hint:'owner/repo@ref，并选择目录'};
 throw Error('未知连接器');
}

export {
  resolveRssMount,searchRssMount,readRssArticle,
  resolveWebMount,readPublicPage,webSearchCandidate,knownUrlCandidate,
  importLocalFile,loadImportedFile,resolveFileMount,searchFileChapters,readFileFragment,
  resolveGithubMount,readGithubFile,fileEvidence,
  loadSignals,resolveSignalsMount,
  listExistingMaterials,readExistingWork,resolveExistingMount,
};
