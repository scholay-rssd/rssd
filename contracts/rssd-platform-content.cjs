'use strict';
// Guidance mirrors the pinned Postiz v2.25.1 providers and settings DTOs.
// Postiz sends text without HTML tags verbatim; any tag switches it to the
// provider editor's HTML conversion, which keeps only a few tags.
const MARKDOWN=new Set(['medium','devto','hashnode','discord','whop']);
const FORMAT={
 markdown:'text 用纯 Markdown（链接写 [文字](URL)）。不要写任何 HTML 标签或 <https://…> 尖括号链接：正文一旦含标签，中心会按 HTML 转换并删除标签，格式与链接会丢失。',
 wordpress:'text 用 HTML，不用 Markdown 语法。只用 <p>、<h1>、<h2>、<h3>、<ul>、<li>、<strong>、<u>、<a href="…">，以及 <img src="https://…" alt="…">（src 须为公开 https 地址）；其他标签（如 <ol>、<em>、<blockquote>、<code>）发布时会被删除，只留文字。',
 plain:'text 用纯文本，不要 Markdown 或 HTML 标记（会原样显示）。',
};
const SETTINGS={
 medium:'settings 必填 title（文章标题，至少 2 字）和 subtitle（至少 2 字）；可选 canonical、publication（仅限已知的 Medium 刊物 ID）、tags（最多 4 个，形如 {"value":"标签","label":"标签"}）。',
 devto:'settings 必填 title（至少 2 字）；可选 canonical、organization（仅限已知 ID）；tags 最多 4 个，value 必须是 dev.to 的数字标签 ID，不知道时写 []。',
 hashnode:'settings 必填 title（至少 6 字）、publication（此账号的 Hashnode 刊物 ID）和至少 1 个 tags（{"value":"Hashnode 标签 objectID","label":"名称"}）；可选 subtitle、canonical。刊物或标签 ID 无法从本单得到时不要编造，留空并说明缺项，中心会阻止这个目的地。',
 wordpress:'settings 必填 title（至少 2 字）和 type（通常为 "post"）；可选 status（publish、draft、pending 或 private）；categories 和 tags 是站点的数字 ID，未知时省略。',
};
const ARTICLE_RULES='canonical 只能填本单已知的原文公开 URL，不要编造。封面 main_image 需要中心媒体对象，设备无法提供，不要填写。';
function platformGuide(platform){
 const format=platform==='wordpress'?FORMAT.wordpress:MARKDOWN.has(platform)?FORMAT.markdown:FORMAT.plain;
 return SETTINGS[platform]?format+SETTINGS[platform]+ARTICLE_RULES:format;
}
function platformProductionInstructions(claim){
 const targets=(claim.payload?.destinations||[]).filter(d=>d.kind==='postiz');
 if(!targets.length)return '';
 const byPlatform=new Map();
 for(const target of targets){const key=target.platform||'';byPlatform.set(key,[...(byPlatform.get(key)||[]),target.destinationId]);}
 const guides=[...byPlatform].map(([platform,ids])=>'- '+(platform||'未知平台')+'（'+ids.join('、')+'）：'+platformGuide(platform)).join('\n');
 return '\n\n平台成品协议 v1：本单还包含以下社交平台目的地：'+JSON.stringify(targets)+
  '\n针对本次输出语言的每个目的地，在 metadata.platformContent[目的地的 destinationId] 中提供 {"text":"适合此平台且符合长度限制的完整发布文案","mediaUrls":["需要发布的公开配图 URL"],"settings":{}}。'+
  '平台设置应使用对应平台所需的选项；__type 由中心填写。可引用原稿中的已有图片，不能伪造媒体 ID 或图片。'+
  '平台要求的图片素材必须由生产设备准备好，中心不会代写或生图；无法提供时明确缺项。文章正文仍按本次写作协议完整保留。不要把其他语言的目的地写入本次成品。'+
  '\n各平台的正文格式与设置：\n'+guides;
}
module.exports={platformProductionInstructions,platformGuide};
