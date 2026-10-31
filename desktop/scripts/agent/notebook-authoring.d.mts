import type {Notebook,NoteBlock,NoteGroup} from './notebook.mjs';
export function templateSection(material:{name?:string;prompt?:string},makeId:()=>string):{group:NoteGroup;blocks:NoteBlock[]};
export function headingsFromBody(n:Notebook):string[];
export const HEADING_PROMPT:string;
