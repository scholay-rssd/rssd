import {attachmentFromFile} from './agent-view';
import { tr } from "../uiText";

export type TurnAttachment={id:string;name:string;type:string;mimeType?:string;text?:string;data?:string;size?:number};
export const ATTACHMENT_ACCEPT='.md,.txt,.csv,.json,image/png,image/jpeg,image/webp';
export async function addTurnFiles(current:TurnAttachment[],files:File[]):Promise<TurnAttachment[]>{
 const added=await Promise.all(files.map(async file=>({...await attachmentFromFile(file),id:crypto.randomUUID(),size:file.size})));
 const next=[...current];
 for(const item of added)if(!next.some(old=>old.name===item.name&&old.type===item.type&&old.text===item.text&&old.data===item.data))next.push(item);
 if(next.length>6)throw Error(tr('每轮最多添加 6 个文件'));
 if(JSON.stringify(next).length>4000000)throw Error(tr('本轮文件总量过大，请减少附件'));
 return next;
}
// Conversation history keeps names; file payloads travel with this send only.
export function turnFileReferences(files:TurnAttachment[]=[]):TurnAttachment[]{return files.map(({id,name,type,mimeType,size})=>({id,name,type,mimeType,size}));}
