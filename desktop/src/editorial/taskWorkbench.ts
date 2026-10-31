import type {TurnContext,NotebookTurn} from './notebookTurns';
import type {Notebook} from '../../scripts/agent/notebook.mjs';
import {invoke} from '../lib/nativeCore';
import {TASK_MODE_NAMES,type TaskModeId} from '../../scripts/agent/task-types.mjs';
/** Display names of every task mode; the definitions live in scripts/agent/task-types.mjs. */
export const TASK_MODES=TASK_MODE_NAMES;
export type TaskMode=TaskModeId;
export type NewsItem={id:string;title:string;summary:string;url:string;sourceUrls?:string[];publisher?:string;date?:string;dateBasis?:string;publicationDate?:string;acquiredVia?:'rss'|'web'|'record';rssId?:string;recordId?:string;recordKind?:'year'|'history';datePrecision?:'day'|'month'|'unknown';eventKey?:string;locked?:boolean;selected?:boolean;excluded?:boolean};
export type WorkflowStep='brief'|'topic'|'outline'|'draft'|'review'|'deliver';
export type WorkflowAction='topic'|'section'|'append'|'item'|'outline'|'block'|'draft'|'image';
export type WorkflowCheck={ready:boolean;draftReady?:boolean;pendingCloudRequest?:null|{kind:'publication'|'action';requestKey:string;stage:'unknown'|'queued'|'running'|'verify'};images:number;fingerprint?:string;sha256?:string;reviewed:boolean;checks:{key:string;label:string;ok:boolean;detail:string}[]};
export type WorkflowPending={runId:string;previousRunId?:string;action:'outline'|'draft';source:WorkflowStep;target:'outline'|'draft';revision:number;confirmation?:string;generatedAt?:string};
export type TopicSlot={id:string;mode?:'manual'|'smart';prompt?:string;templateName?:string;enrichRecordId?:string};
export type TopicBoard={dismissed?:string[];gaps?:string[]|string;selectedTitle?:number|string;targetSections?:number;targetPerSection?:number;titles:string[];sections:{id:string;title:string;slotCount?:number;slots?:TopicSlot[];items:NewsItem[]}[]};
// Preserve legacy title-text selections without rewriting confirmed board hashes.
export function selectedTitleIndex(board:TopicBoard){return typeof board.selectedTitle==='string'?board.titles.indexOf(board.selectedTitle):(board.selectedTitle??0);}
export type OutlineBlock={id:string;type:string;text:string;sourceIds?:string[];locked?:boolean;stale?:boolean};
export type WorkbenchTab={id:string;kind:'notebook'|'board'|'outline'|'work'|'publish'|'web'|'images';title:string;workId?:string;url?:string;view?:{url?:string;mode?:'web'|'source';scrollTop?:number}};
export type CanvasDraft={revision:number;value:TopicBoard|{blocks:OutlineBlock[]}};
export type TaskUi={turnDraft?:TurnContext;firstSent?:boolean;flowPending?:WorkflowPending|null;flowCollapsed?:boolean;flowLogScroll?:number;flowLogFollow?:boolean;flowDraft?:{brief:string;days:number;sources:'combined'|'rss'|'web'}|null;flowStep?:WorkflowStep;canvasDrafts?:Partial<Record<'board'|'outline',CanvasDraft>>;tabs:WorkbenchTab[];activeTab?:string|null;composer?:string;scrollTop?:number;follow?:boolean;contexts?:{id:string;title:string;text:string}[];expansionOpen?:boolean;libraryQuery?:string;libraryScroll?:number;taskScroll?:number};
export type TaskAsset={id:string;articleId:string;name:string;path:string;originalPath:string;replaces?:string};
export type TaskDelivery={destination:'local'|'cloud';articleId:string;at:string;phase?:'retiring'|'cleanup_blocked'|'complete';error?:string;canonicalPath?:string;sha256?:string;fingerprint?:string;taskRevision?:number;requestKey?:string;revision?:number};
export type WorkbenchTask={agentId?:string;notebookTurns?:NotebookTurn[];notebookExport?:unknown;templateUndo?:{revision:number};templateNotice?:string;notebook?:Notebook;completedAt?:string;delivery?:TaskDelivery;generated?:{revision:number;sha:string;at:string};workflow?:{version:number;sources:'combined'|'rss'|'web';authorized:boolean;review?:{fingerprint:string;revision:number}|null};runtime?:TaskRunState;id:string;mode:TaskMode;title:string;brief:string;days:number;revision:number;stage:string;articleId:string;workIds:string[];board:TopicBoard;outline:{titleCandidates?:string[];selectedTitle?:number;blocks:OutlineBlock[]};assets:TaskAsset[];topicConfirmed?:string|null;outlineConfirmed?:string|null;draftStale?:boolean;ui:TaskUi;pinned?:boolean;archived?:boolean;deleted?:boolean;updatedAt:string};
export type TaskRunState={collection?:Record<string,{status:'queued'|'searching'|'missing'|'complete';detail?:string}>;runId?:string;lastAction?:{action:WorkflowAction;target?:string;notes?:string};pendingPrompt?:{text:string;context?:string}|null;busy?:boolean;queued?:boolean;pending?:number;connected?:boolean;status?:string;lastRunStatus?:string|null};
export const taskCall=<T,>(method:string,params:object={})=>invoke<T>('cursor_agent_call',{method,params});
export function tabFor(kind:WorkbenchTab['kind'],id:string,title:string,url?:string):WorkbenchTab{return {id:kind+':'+id,kind,title,...((kind==='work'||kind==='publish')?{workId:id}:{}),...(url?{url}:{})};}
export function addTaskTab(ui:TaskUi,tab:WorkbenchTab):TaskUi{return {...ui,tabs:ui.tabs.some(t=>t.id===tab.id)?ui.tabs:[...ui.tabs,tab],activeTab:tab.id,expansionOpen:true};}
export function removeTaskTab(ui:TaskUi,id:string):TaskUi{if(id==='notebook')return ui;const index=ui.tabs.findIndex(t=>t.id===id),tabs=ui.tabs.filter(t=>t.id!==id);return {...ui,tabs,activeTab:ui.activeTab===id?(tabs[Math.max(0,index-1)]?.id||null):ui.activeTab};}
