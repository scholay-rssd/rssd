import type {Notebook} from './notebook.mjs';
export type CompletionTarget={panel:'title'|'body'|'properties'|'section'|'sources'|'conflict';blockId?:string;field?:string};
export type CompletionCheck={id:string;label:string;ok:boolean;target:CompletionTarget};
export function notebookPreparation(n:Notebook):CompletionCheck[];
export function completionTargets(n:Notebook):string[];
export function completionIssueTarget(n:Notebook,issue:string):CompletionTarget;
export const COMPLETION_PROMPT:string;
