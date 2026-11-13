import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {validateDisplay} from '../contracts/display-modules.mjs';
import {validateNavigation} from '../contracts/site-navigation.mjs';
import {refreshSiteBrand} from '../contracts/site-branding.mjs';
import {createHash} from 'node:crypto';
import {sectionsForSite,activeSectionsForSite,validateSectionCatalog} from '../contracts/site-sections.mjs';
import {siteWithCachedSections} from './site-section-catalog.mjs';

export const profiles=JSON.parse(readFileSync(new URL('../sites/profiles.json',import.meta.url),'utf8'));
export const DEFAULT_SITE=profiles[0];
export function validateOrigin(value){
  let u;try{u=new URL(value);}catch{throw Error('站点地址无效');}
  if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('站点地址须为 HTTPS 根地址（本地测试允许 HTTP）');
  return u.origin;
}
export function validateSite(input){
  input=refreshSiteBrand(input);
  if(input?.sectionCatalog)validateSectionCatalog(input.sectionCatalog);
  if(input?.sections!==undefined)validateSectionCatalog({version:1,revision:'configured',sections:input.sections});
  if(!input||input.version!==1||!/^[a-z][a-z0-9-]{1,48}$/.test(input.id||'')||!/^[a-z][a-z0-9-]{1,48}$/.test(input.spaceId||''))throw Error('站点配置版本或编号无效');
  for(const key of ['name','domain','description','author','timezone'])if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>500)throw Error('站点配置缺少 '+key);
  for(const key of ['columns','yearCategories','sourceCategories'])if(!Array.isArray(input[key])||!input[key].length||input[key].some(x=>typeof x!=='string'||!x.trim()||x.length>80||/[\\/\x00-\x1f]/.test(x))||new Set(input[key]).size!==input[key].length)throw Error('站点栏目配置无效');
  if(input.columns.length!==5||!/^#[a-f0-9]{6}$/i.test(input.accent||'')||!['engine','existing'].includes(input.homeMode))throw Error('站点页面配置无效');
  if(input.themeId!==undefined&&!['academic','journal','docs','encyclopedia','portfolio','personal'].includes(input.themeId))throw Error('未知主题');
  if(input.slogan!==undefined&&(typeof input.slogan!=='string'||!input.slogan.trim()||input.slogan.length>200))throw Error('站点 slogan 无效');
  if(input.languages!==undefined&&(!Array.isArray(input.languages)||input.languages[0]!=='zh-CN'||new Set(input.languages).size!==input.languages.length||input.languages.some(x=>!['zh-CN','en'].includes(x))))throw Error('站点文章语言配置无效');
  if(input.publicColumns!==undefined&&(!Array.isArray(input.publicColumns)||!input.publicColumns.length||input.publicColumns.length>30||input.publicColumns.some(x=>typeof x!=='string'||!x.trim()||x.length>80)||new Set(input.publicColumns).size!==input.publicColumns.length))throw Error('公开栏目配置无效');
  if(input.navigation!==undefined)validateNavigation(input.navigation);
  if(input.layout!==undefined&&!['articles','showcase'].includes(input.layout))throw Error('未知内容布局');
  if(input.services!==undefined&&(!input.services||Object.keys(input.services).some(k=>k!=='guestbook')||typeof input.services.guestbook?.enabled!=='boolean'||Object.keys(input.services.guestbook).some(k=>k!=='enabled')))throw Error('站点服务配置无效');
  if(input.articleFeatures!==undefined&&(!input.articleFeatures||Object.keys(input.articleFeatures).some(k=>k!=='inputScheme')||typeof input.articleFeatures.inputScheme!=='boolean'))throw Error('文章功能配置无效');
  if(input.aliases!==undefined&&(!Array.isArray(input.aliases)||input.aliases.some(x=>validateOrigin(x)!==x||x===input.origin)||new Set(input.aliases).size!==input.aliases.length))throw Error('旧域名配置无效');
  // Default cover for outputs of articles with no image (contracts/output-package.mjs): a path on the site.
  if(input.cover!==undefined&&(typeof input.cover!=='string'||!/^\/[\w./-]+$/.test(input.cover)||input.cover.split('/').includes('..')))throw Error('站点默认封面无效');
  if(input.legacy&&input.id!==DEFAULT_SITE.id)throw Error('只有默认学术站能使用旧版兼容配置');
  try{new Intl.DateTimeFormat('en',{timeZone:input.timezone});}catch{throw Error('站点时区无效');}
  const keys=['version','id','spaceId','name','domain','description','author','timezone','columns','yearCategories','sourceCategories','accent','homeMode'];
  return {...Object.fromEntries(keys.map(key=>[key,input[key]])),...Object.fromEntries(['slogan','publicColumns','navigation','layout','services','articleFeatures','aliases','languages','sectionCatalog','sections','cover'].filter(key=>input[key]!==undefined).map(key=>[key,structuredClone(input[key])])),...(input.themeId?{themeId:input.themeId}:{}),...(input.display?{display:validateDisplay(input.display)}:{}),legacy:input.legacy===true,retainLocal:input.retainLocal!==false,origin:validateOrigin(input.origin)};
}
export function loadSite(file=process.env.SCHOLAY_SITE_CONFIG){return file?validateSite(JSON.parse(readFileSync(file,'utf8'))):DEFAULT_SITE;}
export let SITE=loadSite();
// Headless selects its site before loading workspace/record modules. Keep
// existing import bindings aligned with that explicit process-local context.
export function setSiteContext(site){SITE=validateSite(site);}
export function siteForWorkspace(root){
  const file=join(root,'.site.json');
  const site=existsSync(file)?validateSite(JSON.parse(readFileSync(file,'utf8'))):SITE;
  if(process.env.SCHOLAY_SITE_ID&&site.id!==process.env.SCHOLAY_SITE_ID)throw Error('稿件空间与当前站点不匹配，操作已停止');
  return siteWithCachedSections(root,site,{required:process.env.SCHOLAY_DESKTOP_RUNTIME==='1'});
}
export function publicationDirectory(root){const site=siteForWorkspace(root);return site.legacy?join(root,'.local/today'):join(root,'.local/sites',site.id);}
export function siteDescriptor(site=SITE){const sections=sectionsForSite(site).map((s,order)=>({order,enabled:true,writable:true,...s})),sectionCatalog=validateSectionCatalog({version:1,revision:createHash('sha256').update(JSON.stringify(sections)).digest('hex'),sections});return {protocol:'scholay-content',version:1,siteId:site.id,name:site.name,author:site.author,origin:site.origin,sectionCatalog,capabilities:['section-catalog-v1','catalog','drafts','publish','revision-conflicts','idempotent-requests','source-archives',...(site.languages?.includes('en')?['language-editions-v1','structured-language-editions-v1']:[])],...(site.languages?{languages:site.languages}:{}),columns:site.columns,articleCategories:activeSectionsForSite(site).map(s=>s.name),kinds:{news:'文章',year:site.columns[3],history:site.columns[4],openSource:site.columns[2]},limits:{requestBytes:12*1024*1024}};}
// Existing desktop connections can continue using a declared old domain.
// Never reflect an arbitrary Host header into a site's identity response.
export function siteDescriptorForHost(host,site=SITE){
  const alias=(site.aliases||[]).find(origin=>new URL(origin).host===host);
  return siteDescriptor(alias?{...site,origin:alias}:site);
}
