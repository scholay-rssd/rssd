import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recordHeadings} from '../../../scripts/editorial-record.mjs';
import {sectionsForSite} from '../../../contracts/site-sections.mjs';
import {siteBrandMounts} from './brand-library.mjs';
import {brandEndnoteText} from '../../../contracts/brand-endnotes.mjs';

export const IMAGE_PRIORITY='配图优先级：① 有许可的网络原图（CC0/公有领域/CC BY/CC BY-SA，或机构新闻稿明示可用），图注写明作者/机构、来源与许可；② 确实找不到合规原图时再用 Generate Image 生成示意图，生成方式与配图取舍写入对应行内部 images 备注，公开图注准确说明示意内容，保留必要署名；③ 需要结构说明时用代码绘制。每个图片位置在 requirement 写清画面内容。每张图片都必须填写 alt：用 20–60 字具体描述画面内容，不写“图片”“配图”这类空话。';

export function clipPlain(value,max){
 let s=String(value||'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[*_`#>]/g,'').replace(/\s+/g,' ').trim();
 if(s.length<=max)return s;
 const cut=s.slice(0,max);
 const i=Math.max(cut.lastIndexOf('。'),cut.lastIndexOf('；'),cut.lastIndexOf('，'));
 return (i>max*0.5?cut.slice(0,i):cut)+'。';
}
export function shanghaiDate(value=new Date()){
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(value);
}
export function imageAlt(block,notebook){
 if((block.alt||'').trim())return clipPlain(block.alt,60);
 const caption=(notebook?.blocks||[]).find(c=>c.role==='caption'&&c.targetId===block.id&&c.state==='ready');
 return clipPlain(caption?.text||block.requirement||notebook?.title||'',60);
}

function referenceHeading(block){
 return /参考文献|参考资料|来源/.test((block.requirement||'')+(block.text||''));
}

export function applySiteBrands(notebook,siteId,brands){
 const seeds=siteBrandMounts(siteId,brands);
 const have=new Set((notebook.blocks||[]).filter(x=>x.preset).map(x=>x.preset.id));
 const add=seeds.filter(s=>!have.has(s.endnotes[0].id)).map(s=>({id:randomUUID(),type:'annotation',role:'endnote',purpose:'marketing',text:brandEndnoteText(s,s.endnotes[0]),requirement:'',state:'ready',locked:true,sourceIds:[],preset:{brandId:s.id,id:s.endnotes[0].id,version:s.version}}));
 const ids=new Set(seeds.map(s=>s.id));
 const mounts={...(notebook.mounts||{}),brands:[...(notebook.mounts?.brands||[]).filter(m=>!ids.has(m.id)),...seeds]};
 return {notebook:{...notebook,blocks:[...(notebook.blocks||[]),...add],mounts},added:add.length};
}

export function finalizeNotebook(notebook,{siteId,brands,requireImage=true}={}){
 const n=structuredClone(notebook);
 const dropped=new Set((n.blocks||[]).filter(x=>x.type==='image'&&x.state==='placeholder').map(x=>x.id));
 let blocks=(n.blocks||[]).filter(x=>!dropped.has(x.id)&&!(x.role==='caption'&&(dropped.has(x.targetId)||x.state==='placeholder')));
 const protocol=new Set(recordHeadings(n.kind));
 blocks=blocks.flatMap(x=>{
  if(x.type!=='heading'||x.state!=='placeholder')return [x];
  if(referenceHeading(x)||(n.kind!=='article'&&x.level===2&&!protocol.has(x.text)))return [{...x,text:referenceHeading(x)?'参考文献':x.text||x.requirement||'说明',state:'ready',level:3}];
  return [];
 });
 blocks=blocks.map(x=>{
  if(n.kind!=='article'&&x.type==='heading'&&x.level===2&&!protocol.has(x.text))return {...x,level:3};
  if(x.type==='image'&&x.state==='ready'&&!(x.alt||'').trim())return {...x,alt:imageAlt(x,{...n,blocks})};
  return x;
 });
 const stuck=blocks.filter(x=>x.state==='placeholder');
 if(stuck.length)throw Error('unfilled placeholders: '+stuck.map(x=>x.type+':'+(x.requirement||x.text||'').slice(0,60)).join(' | '));
 n.blocks=blocks;
 const branded=siteId?applySiteBrands(n,siteId,brands):{notebook:n,added:0};
 const images=branded.notebook.blocks.filter(x=>x.type==='image'&&x.state==='ready');
 if(requireImage&&!images.length)throw Error('no images');
 return {...branded,images};
}

export function publicationMetadataFromNotebook(n,site,draft){
 const lede=(n.blocks||[]).find(x=>x.type==='paragraph'&&x.state==='ready'&&clipPlain(x.text,400).length>30);
 const summary=clipPlain(n.fields?.summary||n.fields?.factSummary||lede?.text||n.title,150);
 const composed=n.fields?.date||n.fields?.start||(n.fields?.year&&n.fields?.dateKey?String(n.fields.year).padStart(4,'0')+'-'+n.fields.dateKey:'');
 const date=composed||shanghaiDate();
 const sectionId=n.sectionId;
 const category=(sectionId&&sectionsForSite(site).find(s=>s.id===sectionId)?.name)||(sectionId?draft?.archiveCategory:undefined)||'未归栏';
 return {date,summary,author:site.author,category,...(sectionId?{sectionId}:{})};
}

export async function writeNotebookImageRights(root,articleId,notebook,images=[]){
 const dir=join(root,'_ops/inventory/image-rights',articleId);
 const records=[];
 for(const image of images){
  const path=image.path||image.text;
  const asset=notebook.assets?.[path];
  const block=(notebook.blocks||[]).find(b=>b.type==='image'&&(b.text===path||b.id===image.id));
  const caption=(notebook.blocks||[]).find(c=>c.role==='caption'&&c.targetId===block?.id&&c.state==='ready');
  const generated=asset?.origin==='generated'||asset?.acquiredVia==='generate';
  const record={
   articleId,
   origin:asset?.origin||(generated?'generated':'imported'),
   acquiredVia:asset?.acquiredVia||'',
   imageUrl:asset?.sourceUrl||'',
   author:asset?.creator||(generated?'AI generated':'') ,
   title:notebook.title||'',
   figureLabel:caption?.text||'',
   license:asset?.license||(generated?'AI generated schematic':''),
   licenseUrl:asset?.licenseUrl||'',
   licenseEvidence:generated?'Notebook image generated during authorized complete/image run.':(asset?.license||''),
   retrievedAt:asset?.createdAt||new Date().toISOString(),
   renderedPath:path,
   renderedSha256:asset?.sha256||'',
   originalSha256:asset?.originalSha256||asset?.sha256||'',
   caption:caption?.text||'',
   alt:block?.alt||'',
   thirdPartyExcluded:false,
  };
  await mkdir(dir,{recursive:true,mode:0o700});
  const key=(asset?.sha256||asset?.id||randomUUID()).replace(/[^a-f0-9]/g,'').slice(0,24)||randomUUID().slice(0,24);
  await writeFile(join(dir,key+'.json'),JSON.stringify(record,null,2)+'\n');
  records.push(record);
 }
 return records;
}
