import type {DomainPack} from './domain-pack.mjs';
export function isGuoxueSite(site:{id?:string;spaceId?:string}):boolean;
export const GUOXUE_SCOPE:string;
export const GUOXUE_WRITING_SKILLS:Record<string,{name:string;hint:string}>;
export const GUOXUE_SKILL_MATERIALS:Record<string,[string,string][]>;
export const GUOXUE_ANGLES:{names:string[];prompts:string[]};
export const GUOXUE_PROMPT_GROUPS:{label:string;items:[string,string][]}[];
export const GUOXUE:DomainPack;
