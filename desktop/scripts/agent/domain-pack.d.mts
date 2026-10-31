import type {TaskTypeId} from './task-types.mjs';
/** [name, column title, retrieval direction] */
export type DomainCard=[string,string,string];
export type DomainType={skill:string;subject:string;cards:DomainCard[];illustrations?:[string,string];
 /** Ready-made board columns as [title, card indexes]; without it every card is its own column. */
 columns?:[string,number[]][];
 /** Default retrieval window of this type's cards, in days. */
 cardDays?:number;
 /** The field keeps a library of existing records of this type that a task can start from. */
 recordShelf?:boolean};
export type DomainPack={id:string;name:string;scope?:string;references:{board:string[];article:string[];required:string[]};imageStyle:{match:string;files:string[]};galleryPresets:string[];types:Record<TaskTypeId,DomainType>;discovery:DomainType};
export const ACADEMIC:DomainPack;
export function domainType(mode:string|undefined,pack?:DomainPack):DomainType|null;

export const CURRENT_DOMAIN:DomainPack;
