import {formatErrors} from './notebook-model.mjs';
import {editableHeading,headingFormatErrors} from './notebook-headings.mjs';

// Preparation checks ask for an actionable brief, not already-written AI output.
export function notebookPreparation(n){
 const checks=[],add=(id,label,ok,target)=>checks.push({id,label,ok,target});
 add('title',n.title.trim()?'文章标题已填写':n.titleTemplate?.requirement?.trim()?'标题占位已准备':'填写文章标题或选择标题模板',!!(n.title.trim()||n.titleTemplate?.requirement?.trim())&&n.title.length<=120,{panel:'title'});
 add('body',n.blocks.length?'文章结构已准备':'添加正文或内容占位',n.blocks.length>0,{panel:'body'});
 for(const [index,b] of n.blocks.entries()){
  if(b.state!=='placeholder')continue;
  const automaticHeading=editableHeading(n,b),caption=b.role==='caption'&&n.blocks.some(x=>x.id===b.targetId&&x.type==='image');
  const ready=!b.locked&&(automaticHeading||caption||!!b.requirement?.trim()||!!b.sourceIds.length);
  add('block:'+b.id,b.locked?`第 ${index+1} 行：完成或解除占位保护`:ready?`第 ${index+1} 行：${automaticHeading?'AI 整理子标题':b.type==='image'?'配图要求已准备':'写作要求已准备'}`:`第 ${index+1} 行：补充${b.type==='image'?'配图':'写作'}要求`,ready,{panel:'body',blockId:b.id});
 }
 const required=n.kind==='year'?[['start','开始日期'],['category','分类'],['dateBasis','日期依据'],['sourceName','来源名称'],['sourceUrl','来源网址']]:n.kind==='history'?[['year','发生年份'],['dateKey','月日'],['domain','领域'],['eventType','事件类型'],['importance','重要性']]:n.kind==='openSource'?[['date','显示日期'],['category','资源分类'],['url','官方网址']]:[];
 for(const [field,label] of required){const ok=n.fields[field]!==undefined&&String(n.fields[field]).trim()!=='';add('field:'+field,ok?label+'已填写':'填写'+label,ok,{panel:'properties',field});}
 for(const error of [...formatErrors(n),...headingFormatErrors(n)]){
  const parts=error.path.split('.'),block=parts[0]==='blocks'?n.blocks[Number(parts[1])]||n.blocks.find(b=>b.id===parts[1]):undefined;
  add(error.path,error.message,false,block?{panel:'body',blockId:block.id}:{panel:parts[0]==='title'?'title':'properties',field:parts[0]==='fields'?parts[1]:undefined});
 }
 return checks;
}

export function completionTargets(n){return n.blocks.filter(b=>!b.locked&&(b.state==='placeholder'||editableHeading(n,b))).map(b=>b.id);}
export function completionIssueTarget(n,issue){
 if(/作品库.*(?:变化|修改)|已有稿件无法读取/.test(issue))return {panel:'conflict'};
 const index=issue.match(/blocks\.(\d+)(?:[.：:]|$)/)?.[1],block=index!==undefined?n.blocks[Number(index)]:n.blocks.find(b=>issue.includes('blocks.'+b.id)||b.type==='image'&&b.text&&issue.includes(b.text));
 if(block)return {panel:'body',blockId:block.id};
 if(/来源.*(?:至少|填写)|至少.*来源/.test(issue))return {panel:'sources'};
 if(/titleTemplate|文章标题|标题占位|标题模板/.test(issue))return {panel:'title'};
 if(/二级标题|章节|结构化记录的导语|配图|占位/.test(issue))return {panel:'body'};
 if(/选择发布栏目|栏目.*(?:无效|不存在|不属于)|sectionId/.test(issue))return {panel:'section'};
 for(const [field,pattern] of [['year',/发生年份|\byear\b/],['dateKey',/历史日期|dateKey/],['end',/结束日期/],['start',/开始日期|\bstart\b/],['dateBasis',/日期依据|dateBasis/],['sourceName',/来源名称|sourceName/],['sourceUrl',/sourceUrl/],['domain',/领域|domain/],['eventType',/事件类型|eventType/],['importance',/重要性|importance/],['category',/分类|category/]])if(pattern.test(issue))return {panel:'properties',field};
 if(/日期/.test(issue))return {panel:'properties',field:n.kind==='year'?'start':n.kind==='history'?'dateKey':'date'};
 if(/链接|网址/.test(issue))return {panel:'properties',field:n.kind==='year'?'sourceUrl':'url'};
 return {panel:/title|文章标题|一级标题/.test(issue)?'title':'properties'};
}
export const COMPLETION_PROMPT='完成当前文章：按照占位要求和已选素材补全所有委派位置，之后根据全文整理子标题；文章标题为空时按照标题模板生成 title，保留已有标题。保留已写正文、人工保护内容、素材引用和文章顺序。遵循已选文章写法、写作技能和品牌信息。配图优先级：先用 notebook_image_search 检索有许可的网络原图（CC0/公有领域/CC BY/CC BY-SA 或机构明示可用），图注写明作者/机构、来源与许可；确实找不到合规原图时再用 Generate Image 生成示意图，生成方式与配图取舍写入内部备注 images；需要结构说明时才用代码绘制。每张图片填写 20–60 字 alt。没有足够依据时保留占位并说明缺少什么，不编造。结构化记录不要新增二级标题。一次成文：在同一写作过程中将正文和内部说明各自落入 notebook JSON 的 blocks 与 blockNotes；不安排写完后二次校对来迁走旁支。正文篇幅目标单独满足，内部备注另留预算，不挤占正文。正文集中回答本篇问题，保留准确的核心判断、方法、步骤和例子；附带概念解释、适用边界展开、例外与防误读提醒调用 notebook_notes，传对应 blockId，写进 supplement，收在该行旁供作者悬停查看，不在正文或单独的注意事项章节重复。若解释本身是本篇要回答的问题，保留主线答案。写作过程、配图解释和待办分别写入 writing/images/verification。完成后由程序检查格式并保存成稿。';
