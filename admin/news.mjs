import {validateSectionId} from '../contracts/site-sections.mjs';
import {SITE} from '../scripts/site-config.mjs';
import {createHash} from 'node:crypto';
import {renderArticle,markdownImages} from '../scripts/article-format.mjs';
import {articleViewsFromMarkdown} from '../scripts/article-metadata.mjs';
import {languageFields} from '../contracts/language-editions.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bad=message=>{throw Object.assign(new Error(message),{statusCode:400});};
const field=(value,max)=>{if(typeof value!=='string'||value.length>max)bad('文章字段为空或超过长度限制');return value.trim();};
export function validateNews(input,previous=null,site=SITE){
  if(!input||typeof input!=='object'||Array.isArray(input))bad('文章数据无效');
  const id=field(previous?.id||input.id,100);
  if(!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))bad('文章 ID 仅支持小写字母、数字和横线');
  const title=field(input.title,500),summary=field(input.summary,4000),markdown=field(input.markdown,160000),author=field(input.author||SITE.author,100);
  if(!title||!summary||!markdown)bad('请填写标题、摘要与正文');
  try{articleViewsFromMarkdown(markdown);}catch(e){bad(e.message);}
  const date=field(input.date,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)bad('文章日期无效');
  const category=field(input.category||SITE.columns[0],80);
  if(!Array.isArray(input.assets||[])||(input.assets||[]).length>12)bad('文章最多包含 12 张图片');
  let total=0;
  const assets=(input.assets||[]).map(asset=>{
    if(typeof asset.data!=='string'||asset.data.length>1400000||!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data))bad('图片数据无效');
    const bytes=Buffer.from(asset.data,'base64');total+=bytes.length;
    const ext=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpg':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'webp':null;
    if(!ext||!bytes.length||total>2*1024*1024)bad('仅接收 PNG、JPEG、WebP；图片合计最多 2MB');
    const path='/article-media/'+hash(bytes)+'.'+ext;
    if(asset.path!==path)bad('图片路径与内容不匹配');
    return {path,data:bytes.toString('base64')};
  });
  const images=markdownImages(markdown);
  for(const src of images)if(!/^https?:\/\//i.test(src)&&!assets.some(a=>a.path===src))bad('正文含未打包的本地图片');
  renderArticle(markdown);
  const sectionId=validateSectionId(input.sectionId,site);
  return {id,title,summary,markdown,date,category,author,assets,...(sectionId?{sectionId}:{}),...languageFields({...input,id},previous,site)};
}

// No build clock or transport metadata participates in a content identity.
export const newsFingerprint=(data,site=SITE)=>hash(JSON.stringify(validateNews(data,null,site)));
