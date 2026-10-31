export type TaskTypeId='xiwen'|'observation'|'opensource'|'calendar'|'history';
/** Modes the board engine runs: the content types plus subscription-source discovery. */
export type EngineModeId=TaskTypeId|'rss';
export type TaskModeId=EngineModeId|'image'|'legacy';
export type TaskTypeDefinition={
 name:string;description:string;icon:string;article:boolean;days:number;sections:number;
 /** Station of the topic step: several materials in columns of cards, or exactly one material. */
 topic?:'matrix'|'single';
 /** recent: search window counts back from today; event: dates come from the sources, not the window; none: no date window. */
 dateRule:'recent'|'event'|'none';
 
 /** The post carries verified fields besides its prose; the destination profile says what they become. */
 structured?:boolean;
 /** Verification rules that belong to the type, wherever the post is used. */
 rules?:string;recordLabels?:string[];
};
export const TASK_TYPES:Record<TaskTypeId,TaskTypeDefinition>;
export const DISCOVERY_TASK:TaskTypeDefinition;
export const OTHER_TASK_MODES:{image:string;legacy:string};
export const TASK_TYPE_IDS:TaskTypeId[];
export const TASK_MODE_NAMES:Record<TaskModeId,string>;
export function taskType(mode:string|undefined):TaskTypeDefinition|null;
export function isArticleType(mode:string|undefined):boolean;
export function isSingleTopic(mode:string|undefined):boolean;
export function defaultDays(mode:string|undefined):number;
export function defaultSections(mode:string|undefined):number;
