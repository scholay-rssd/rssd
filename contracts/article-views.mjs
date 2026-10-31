// Optional, declarative views owned by a single published article. No scripts,
// executable URLs or separate roadmap records are accepted here.
export const ROADMAP_STATES={planned:'计划中',active:'进行中',released:'已发布',paused:'暂缓'};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const keys=(value,allowed)=>Object.keys(value).every(k=>allowed.includes(k));
const text=(value,max=200)=>typeof value==='string'&&value.trim()&&value.length<=max;
export function githubUrl(value,{raw=false}={}){
  try{
    if(!text(value,1500)||/[\\\x00-\x20]/.test(value)||/%(?:2e|2f|5c)/i.test(value))return false;
    const u=new URL(value);
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&!u.search&&
      (raw?u.hostname==='raw.githubusercontent.com':['github.com','raw.githubusercontent.com','codeload.github.com'].includes(u.hostname))&&u.pathname.split('/').filter(Boolean).length>=2;
  }catch{return false;}
}
export function validateArticleViews(value){
  if(!object(value)||value.version!==1||!keys(value,['version','roadmap','inputScheme'])||(!value.roadmap&&!value.inputScheme))throw Error('文章展示配置无效');
  if(value.roadmap){
    const r=value.roadmap;
    if(!object(r)||!keys(r,['state','sourceUrl','targetDate','platforms'])||!Object.hasOwn(ROADMAP_STATES,r.state)||!githubUrl(r.sourceUrl))throw Error('路线图须注明状态与 GitHub 原始来源');
    if(r.targetDate!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.targetDate)||!Number.isFinite(Date.parse(r.targetDate))||new Date(r.targetDate).toISOString().slice(0,10)!==r.targetDate))throw Error('路线图日期无效');
    if(r.platforms!==undefined&&(!Array.isArray(r.platforms)||r.platforms.length>12||r.platforms.some(x=>!text(x,50))))throw Error('路线图平台无效');
  }
  if(value.inputScheme){
    const s=value.inputScheme;
    if(!object(s)||!keys(s,['schemaId','downloadUrl','files'])||!(/^[a-z][a-z0-9_]{0,79}$/).test(s.schemaId)||!githubUrl(s.downloadUrl)||!Array.isArray(s.files)||!s.files.length||s.files.length>80)throw Error('输入方案须注明方案编号、GitHub 下载地址及试输入文件');
    const paths=new Set();
    for(const f of s.files){
      if(!object(f)||!keys(f,['path','url','sha256'])||typeof f.path!=='string'||!(/^(?:build\/|opencc\/)?[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(yaml|bin|json|ocd2|txt)$/).test(f.path)||f.path.includes('..')||paths.has(f.path)||!githubUrl(f.url,{raw:true})||!(/^[a-f0-9]{64}$/).test(f.sha256))throw Error('输入方案文件路径、来源或 SHA-256 无效');
      paths.add(f.path);
    }
    if(!paths.has(s.schemaId+'.schema.yaml')&&!paths.has('build/'+s.schemaId+'.schema.yaml'))throw Error('输入方案缺少对应 schema 文件');
  }
  return structuredClone(value);
}
