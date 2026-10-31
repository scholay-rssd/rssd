import type {TopicBoard,TopicSlot} from './taskWorkbench';
import { tr } from "../uiText";
export type TopicSection=TopicBoard['sections'][number];
// Stable legacy IDs preserve empty slots across saves and progressive responses.
export function sectionSlots(s:TopicSection):TopicSlot[]{
 if(s.slots)return s.slots;
 const slots:TopicSlot[]=s.items.map(i=>({id:i.id}));
 const count=Math.max(s.items.length,s.slotCount??1);
 for(let i=slots.length;i<count;i++)slots.push({id:`${s.id}-slot-${i}`});
 return slots;
}
export function materialSections(board:TopicBoard,count:number,loading=false):TopicSection[]{
 return Array.from({length:Math.max(board.sections.length,Math.min(5,board.targetSections??(loading?count:board.sections.length||count)))},(_,i)=>board.sections[i]||{id:'pending-'+i,title:tr('分栏 {{n}}',{n:i+1}),items:[],slotCount:1});
}
export function hasSmartSlots(board:TopicBoard){return board.sections.some(s=>s.slots?.some(slot=>slot.mode==='smart'&&!s.items.some(i=>i.id===slot.id)));}
