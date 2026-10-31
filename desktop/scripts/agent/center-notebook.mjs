import {createHash} from 'node:crypto';
import {formatErrors,publicUrl} from './notebook-model.mjs';
import {notebookMarkdown} from './notebook.mjs';
import {headingFormatErrors} from './notebook-headings.mjs';
import {appendInternalNotes,privateEditorialData} from '../../../contracts/article-internal-notes.mjs';

export const CENTER_NOTEBOOK_OUTPUT=`只返回一个 JSON 对象（不要围栏或解释），使用现有 notebook v2 结构，不直接生成 bodyMarkdown。程序从公开内容行生成 Markdown，内部备注始终私有。本接口通过一次 JSON 交稿，不提供 task_read/task_update 工具；把同一次写作的正文与备注放在下面结构中即可。
{"notebook":{"version":2,"kind":"article","title":"文章标题","skills":[],"fields":{},"groups":[],"blocks":[{"id":"intro","type":"paragraph","state":"ready","text":"完整正文段落","sourceIds":[]}],"sources":[],"blockNotes":{},"internalNotes":{}},"summary":"面向读者的摘要","metadata":{}}
blocks 保持完整正文和顺序，可用 paragraph、markdown、heading（含 level 1–3）、image（text 为真实公开图片 URL 或原稿已有中心图片 URL，填写 alt）、annotation（role=caption/endnote）。caption.targetId 指向图片。所有正式行 state=ready；不能用占位、摘要替代全文。列表、表格、代码可放在 markdown 行。
sources 每条包含 id、title、url、summary、acquiredVia（rss/web/record）、reviewed=false；正文行 sourceIds 引用实际来源 ID。blockNotes[行ID].notes 和 internalNotes 使用写作协议规定的五类字段。不要填写 modelSignatures、meta 或运行记录，由服务记录真实智能体与会话信息。
metadata.platformContent 按本单平台要求填写；没有中心媒体 ID 时不要伪造 media，已有图片保持真实链接。`;

export function notebookEdition(result,{source,signature,sectionId}={}){
 const input=result?.notebook;
 if(!input||input.version!==2)throw Error('智能体结果缺少 notebook v2 正文与私有备注结构；输出已保留');
 const n=structuredClone(input),previous=source?.payload?.metadata?.notebook;
 delete n.meta;delete n.modelSignatures;
 const errors=formatErrors(n,{imageReference:publicUrl});
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
 const bodyMarkdown=notebookMarkdown(n,{site:null});
 const metadata={...source?.payload?.metadata,...result.metadata,notebook:n,notebookBodyHash:createHash('sha256').update(bodyMarkdown).digest('hex')};
 delete metadata.modelSignatures;
 return {title:n.title,bodyMarkdown,summary:typeof result.summary==='string'?result.summary:'',sources:n.sources.map(s=>({title:s.title,url:s.url})),media:[],metadata};
}
