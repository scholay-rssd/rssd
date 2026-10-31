import type {Location} from './contentLibrary';
import { tr } from "../uiText";

export type LibrarySourceNames=Record<Location,string>;

export function librarySourceNames(computerName:string,origin:string):LibrarySourceNames{
 const local=computerName.replace(/[\u0000-\u001f\u007f]/g,'').trim()||tr('本机');
 let cloud=tr('未连接云端');
 try{const url=new URL(origin);if(['https:','http:'].includes(url.protocol)&&url.hostname)cloud=url.host;}catch{}
 return {local,cloud};
}
