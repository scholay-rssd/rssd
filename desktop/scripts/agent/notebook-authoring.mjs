import {editableHeading} from './notebook-headings.mjs';
// Template labels are candidates; only an explicit heading plan exposes them.
export function templateSection(material,makeId){
 const groupId=makeId(),base={text:'',state:'placeholder',sourceIds:[],groupId};
 return {group:{id:groupId,kind:'section'},blocks:[
  {...base,id:makeId(),type:'heading',level:2,heading:{fixedText:material.name||''},requirement:'先完成正文，再根据全文用途与小节关系确定标题。'},
  {...base,id:makeId(),type:'paragraph',requirement:[material.name&&'写作方向（仅供规划）：'+material.name,material.prompt].filter(Boolean).join('\n')},
 ]};
}

// Only complete prose provides a basis for an optional heading pass. Required
// structured-record labels and author-protected headings are never selected.
export function headingsFromBody(n){
 return n.blocks.flatMap((heading,index)=>{
  if(!editableHeading(n,heading))return [];
  const section=[];
  for(const block of n.blocks.slice(index+1)){
   if(block.type==='heading'&&block.level<=heading.level)break;
   if(heading.groupId&&block.groupId!==heading.groupId)break;
   if(block.type==='paragraph'||block.type==='markdown')section.push(block);
  }
  return section.length&&section.every(b=>b.state==='ready'&&b.text.trim())?[heading.id]:[];
 });
}

export const HEADING_PROMPT='根据全文内容整理子标题，让各节关系清楚、表达简短。保留手写标题和正文。';
