'use strict';
function platformProductionInstructions(claim){
 const targets=(claim.payload?.destinations||[]).filter(d=>d.kind==='postiz');
 if(!targets.length)return '';
 return '\n\n平台成品协议 v1：本单还包含以下社交平台目的地：'+JSON.stringify(targets)+
  '\n针对本次输出语言的每个目的地，在 metadata.platformContent[目的地的 destinationId] 中提供 {"text":"适合此平台且符合长度限制的完整发布文案","mediaUrls":["需要发布的公开配图 URL"],"settings":{}}。'+
  '平台设置应使用对应平台所需的选项；__type 由中心填写。可引用原稿中的已有图片，不能伪造媒体 ID 或图片。'+
  '平台要求的图片素材必须由生产设备准备好，中心不会代写或生图；无法提供时明确缺项。正文仍在 bodyMarkdown 中完整保留。不要把其他语言的目的地写入本次成品。';
}
module.exports={platformProductionInstructions};
