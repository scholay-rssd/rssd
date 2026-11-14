import {createHash} from 'node:crypto';
import {formatErrors,publicUrl} from './notebook-model.mjs';
import {centerImageReference,normalizeCenterImageText,parseCenterMediaRef} from '../../../scripts/rssd-center-media-ref.mjs';
import {notebookMarkdown} from './notebook.mjs';
import {headingFormatErrors} from './notebook-headings.mjs';
import {appendInternalNotes,privateEditorialData} from '../../../contracts/article-internal-notes.mjs';
import {cleanNotebookCitations} from '../../../scripts/clean-citation-urls.mjs';
import protocol from '../../../contracts/rssd-v1.cjs';

export const CENTER_NOTEBOOK_OUTPUT=`只返回一个 JSON 对象（不要围栏或解释），使用现有 notebook v2 结构，不直接生成 bodyMarkdown。程序从公开内容行生成 Markdown，内部备注始终私有。本接口通过一次 JSON 交稿，不提供 task_read/task_update 工具；把同一次写作的正文与备注放在下面结构中即可。
{"notebook":{"version":2,"kind":"article","title":"文章标题","skills":[],"fields":{},"groups":[],"blocks":[{"id":"intro","type":"paragraph","state":"ready","text":"完整正文段落","sourceIds":[]}],"sources":[],"blockNotes":{},"internalNotes":{}},"summary":"面向读者的摘要","metadata":{}}
notebook.title 须为不超过 120 字的字符串（现有文章板校验，不是写作协议）。合法原作标题不得截断凑长度。
blocks 保持完整正文和顺序，可用 paragraph、markdown、heading（含 level 1–3）、image（text 为真实公开图片 URL，或原稿已登记的中心图片相对/绝对 URL：/api/rssd/v1/media/<id>/raw，填写 alt）、annotation（role=caption/endnote）。翻译任务须按原顺序复用原稿已登记的中心图片，不要用未登记的公开图替代；原创或改写仍可用真实公开图片 URL。caption.targetId 指向图片。所有正式行 state=ready；不能用占位、摘要替代全文。列表、表格、代码可放在 markdown 行。
sources 每条包含 id、title、url、summary、acquiredVia（rss/web/record）、reviewed=false；正文行 sourceIds 引用实际来源 ID。blockNotes[行ID].notes 和 internalNotes 使用写作协议规定的五类字段。不要填写 modelSignatures、meta 或运行记录，由服务记录真实智能体与会话信息。
metadata.platformContent 按本单平台要求填写；没有中心媒体 ID 时不要伪造 media，已有图片保持真实链接。`;

export function notebookEdition(result,{source,signature,sectionId,locale,origin,workspaceId,strictRegisteredImages=false}={}){
 const input=result?.notebook;
 if(!input||input.version!==2)throw Error('智能体结果缺少 notebook v2 正文与私有备注结构；输出已保留');
 const n=cleanNotebookCitations(input),previous=source?.payload?.metadata?.notebook;
 delete n.meta;delete n.modelSignatures;
 const imageReference=origin?centerImageReference({origin,source,strictRegisteredImages}):publicUrl;
 const errors=formatErrors(n,{imageReference});
 if(!errors.length)errors.push(...headingFormatErrors(n));
 if(errors.length)throw Error(errors.map(e=>e.path+'：'+e.message).join('；'));
 if(!n.title.trim()||!n.blocks.length||n.blocks.some(b=>b.state!=='ready'||!b.text.trim()))throw Error('文章标题或正文未完成，输出已保留');
 for(const id of Object.keys(n.blockNotes||{}))if(!n.blocks.some(b=>b.id===id))throw Error('新增行间备注对应的内容行不存在：'+id);
 n.internalNotes=appendInternalNotes(previous?.internalNotes,n.internalNotes||{});
 const oldNotes=previous?privateEditorialData(previous).blockNotes||{}:{};
 n.blockNotes={...oldNotes,...Object.fromEntries(Object.entries(n.blockNotes||{}).map(([id,entry])=>[id,{...entry,notes:appendInternalNotes(oldNotes[id]?.notes,entry.notes)}]))};
 n.modelSignatures=[...(previous?.modelSignatures||[]),...(signature?[signature]:[])];
 // The frozen task owns placement. The agent cannot redirect its result.
 if(sectionId)n.sectionId=sectionId;
 if(origin){
  for(const block of n.blocks)if(block.type==='image'&&block.text)block.text=normalizeCenterImageText(block.text,origin);
 }
 const bodyMarkdown=notebookMarkdown(n,{site:null,locale});
 const metadata={...source?.payload?.metadata,...result.metadata,notebook:n,notebookBodyHash:createHash('sha256').update(bodyMarkdown).digest('hex')};
 if(signature?.writingDefaults)metadata.writingDefaults=structuredClone(signature.writingDefaults);
 else delete metadata.writingDefaults;
 delete metadata.modelSignatures;
 return {title:n.title,bodyMarkdown,summary:typeof result.summary==='string'?result.summary:'',sources:n.sources.map(s=>({title:s.title,url:s.url})),media:editionMedia(bodyMarkdown,n,source,origin),metadata};
}
function editionMedia(bodyMarkdown,notebook,source,origin){
 const prior=new Map((source?.payload?.media||[]).map(item=>[item.id,item])),media=new Map();
 for(const block of (notebook?.blocks||[]).filter(b=>b.type==='image'&&b.state==='ready')){
  const parsed=origin?parseCenterMediaRef(block.text,{origin}):String(block.text||'').match(/^(?:https?:\/\/[^/]+)?\/api\/rssd\/v1\/media\/([a-zA-Z0-9._:-]+)\/raw$/);
  const id=parsed?.id||parsed?.[1];
  if(id)media.set(id,{id,alt:block.alt||prior.get(id)?.alt||''});
 }
 for(const id of protocol.referencedMediaIds(bodyMarkdown))if(!media.has(id))media.set(id,{id,alt:prior.get(id)?.alt||''});
 return [...media.values()];
}
