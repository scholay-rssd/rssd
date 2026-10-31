import { trKey } from "../trKey";
export type WebsiteStage='draft_saved'|'local'|'prepared'|'unknown'|'queued'|'running'|'verify'|'published'|'cleanup'|'failed'|'rejected';
export type SyncState='unknown'|'unpublished'|'unlinked'|'synced'|'local_changed'|'remote_changed'|'conflict'|'publishing'|'invalid';
export const SYNC_LABELS:Record<SyncState,string>={unknown:trKey('待查询官网'),unpublished:trKey('未公开'),unlinked:trKey('需关联官网版本'),synced:trKey('已同步'),local_changed:trKey('待更新'),remote_changed:trKey('官网有新版'),conflict:trKey('需要合并'),publishing:trKey('发布中'),invalid:trKey('文件需检查')};
export type DraftSync={state:SyncState;fingerprint?:string;baseRevision:number|null;remoteRevision:number|null;publishedRevision?:number|null;error?:string};
export const WEBSITE_STAGES:Record<WebsiteStage,string>={draft_saved:trKey('已存云端 · 未公开'),local:trKey('本地稿件'),prepared:trKey('待确认推送'),unknown:trKey('提交结果待查询'),queued:trKey('服务器排队中'),running:trKey('服务器构建中'),verify:trKey('等待公开回读'),published:trKey('官网已公开'),cleanup:trKey('官网已公开 · 本地清理待处理'),failed:trKey('构建失败'),rejected:trKey('提交被拒绝')};
export type WebsiteMetadata={date:string;summary:string;author:string;category:string;sectionId?:string};
// What the publishing flow did after the Chinese page went live: English
// edition, translation and community steps. Cloud and local owners share it.
export type ContinuationState={status?:string;owner?:string;complete?:boolean;error?:string;english?:{status?:string;url?:string};translation?:{status?:string}};
export type WebsiteReceipt={publishingFlow?:ContinuationState;asyncQueue?:{continuationOwner?:string;continuation?:ContinuationState};duplicateOf?:string;requestKey:string;sourceSha256?:string;submittedAt?:string;checkedAt?:string;url?:string;revision?:number;publicReadback?:boolean;error?:string;readbackError?:string;job?:{id:string;status:string;error?:string;release?:string}};
export type WebsiteDraft={id:string;shortTitle:string;canonicalPath:string;batchDate:string|null;sectionId?:string;recordKind?:string|null;metadata?:Partial<WebsiteMetadata>;archiveCategory?:string;type?:string;writingSkills?:string[];stage:WebsiteStage;receipt:WebsiteReceipt|null;preparedAt:string|null;sync?:DraftSync;editCopy?:boolean};
export type WebsitePublishingSnapshot={connection:{configured:boolean;requiresCheck?:boolean;origin:string;message?:string};checkedAt?:string|null;articles:WebsiteDraft[]};
export type WebsiteDraftDetail={localReleased?:boolean;cleanupError?:string;id:string;title:string;canonicalPath:string;sourceSha256:string;metadata:WebsiteMetadata;metadataSha256:string;stage:WebsiteStage;stale:boolean;validation:string;receipt:WebsiteReceipt|null;html:string;warnings:string[];sync?:DraftSync;incoming?:{revision:number;html:string;markdown:string;metadata:WebsiteMetadata}|null;prepared:null|{requestKey:string;packetSha256:string;sourceSha256:string;preparedAt:string;intent?:'draft'|'publish';expectedVersion:number;title:string;metadata:WebsiteMetadata;assetCount:number}};

export type EnglishStatus={label:string;tone:'ok'|'busy'|'warn'|'off';url?:string};
const failed=(value?:string)=>value==='failed'||value==='rejected';
/** The English edition's state once the Chinese page is live; null before that.
 *  English never decides whether the Chinese push succeeded. */
export function englishStatus(receipt:WebsiteReceipt|null|undefined):EnglishStatus|null{
  if(!receipt?.publicReadback)return null;
  const flow=receipt.asyncQueue?.continuation||receipt.publishingFlow;
  // A Chinese news page with no English handoff is a gap to fill; structured
  // records have no English edition at all.
  if(!flow||flow.status==='disabled'||flow.status==='out_of_scope')return receipt.url?.startsWith('/news/')?{label:trKey('缺少英文版'),tone:'warn'}:{label:trKey('英文未启用'),tone:'off'};
  if(flow.english?.status==='verified')return {label:trKey('英文已上线'),tone:'ok',url:flow.english.url};
  if(flow.status==='needs_review'||failed(flow.translation?.status)||failed(flow.english?.status))return {label:trKey('英文需要处理'),tone:'warn'};
  if(flow.status==='deferred')return {label:trKey('英文交接待重试'),tone:'warn'};
  if(flow.status==='translation_review')return {label:trKey('英文待审核'),tone:'busy'};
  return {label:trKey('英文处理中'),tone:'busy'};
}
/** The record that already owns a resource link, from a rejected push's
 *  receipt or from the producer's duplicate-link error message. */
export function duplicateRecordOf(receipt:WebsiteReceipt|null|undefined,message=''):string|null{
  if(receipt?.duplicateOf&&/^record-[0-9a-f-]{36}$/.test(receipt.duplicateOf))return receipt.duplicateOf;
  return message.includes('该资源链接已有记录')?message.match(/（(record-[0-9a-f-]{36})）/)?.[1]||null:null;
}
