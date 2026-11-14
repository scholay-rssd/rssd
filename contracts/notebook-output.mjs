// One complete Notebook object avoids a second JSON envelope whose closing
// brace can strand the summary. The wire adapter wraps only valid JSON; it
// never repairs malformed output or edits prose, captions, alt or signatures.
export const NOTEBOOK_V2_FLAT_OUTPUT=`只返回一个完整 JSON 对象，不加围栏、前言或结语。直接返回现有 notebook version=2 对象，把 summary 也放在这个同一个最外层对象内；不要再套 notebook 外壳，不生成 bodyMarkdown。
{"version":2,"kind":"article","title":"文章标题","summary":"面向读者的摘要","skills":[],"fields":{},"groups":[],"blocks":[{"id":"intro","type":"paragraph","state":"ready","text":"完整正文段落","sourceIds":[]}],"sources":[],"blockNotes":{},"internalNotes":{}}
summary、blocks、sources、blockNotes、internalNotes 都属于同一个最外层对象；最后只关闭这个对象，不在对象外续写 summary。JSON 字符串中的双引号、反斜杠与换行按 JSON 转义。先完整写正文，来源清单和私有说明另计预算，不以摘要或备注补正文篇幅。
每个 image 块都直接填写 alt；目标28–45个Unicode码点，范围20–60，描述可见画面，数值细节放图注。annotation(role=caption).targetId 指向该 image.id。参考文献段落标 purpose=reference，或放在“参考文献/参考资料”标题后。
title 须为不超过120字的字符串；合法原作标题不得截断凑长度。blocks 按正文顺序使用 paragraph、markdown、heading（level 1–3）、image、annotation（role=caption/endnote）；每行有唯一 id、state=ready、text、sourceIds 数组。列表、表格和代码可用 markdown 行。正文须完整，不能用摘要替代全文。
image.text 使用真实公开图片URL，或本任务已经登记的 /api/rssd/v1/media/<id>/raw；本地文件草稿按任务给出的实际图片路径及资产清单交付。翻译须按原顺序保留原稿已登记图片，不伪造媒体ID。
sources 每条含 id、title、url、summary、acquiredVia（rss/web/record）、reviewed=false；正文 sourceIds 引用真实来源ID。blockNotes[行ID].notes 与 internalNotes 使用项目协议的五类私有字段。需要平台内容时保留 metadata.platformContent。
不填写 modelSignatures、meta 或运行记录。发布/模型身份仍由程序维护。`;

export function normalizeNotebookResult(value){
 if(value&&typeof value==='object'&&!Array.isArray(value)&&value.version===2&&value.kind==='article'&&Array.isArray(value.blocks)&&Array.isArray(value.sources)&&!Object.hasOwn(value,'notebook')){
  const {summary,metadata,...notebook}=value;
  return {notebook,...(summary===undefined?{}:{summary}),...(metadata===undefined?{}:{metadata})};
 }
 return value;
}
