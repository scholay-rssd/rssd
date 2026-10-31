import {ACTIVE_SITE,onActiveSiteChange} from '../../../scripts/site-profile.mjs';
import { tr, trKey, uiLocale } from "../uiText";
export type PublicationSection = "platforms" | "website";
export type Publication = {
  id:string; taskId:string; sourceId:string; title:string; platform:string; status:string; url:string;
  account?:string; language?:string; version?:string; managerUrl?:string; publishedAt?:string;
  submittedAt?:string; checkedAt?:string; modifiedAt?:string; evidenceUrl?:string; evidence?:string;
  issue?:string; next?:string; linkAttributes?:string; linkType?:string; blueLink?:string;
  domainResult?:string; indexStatus?:string;
};
export type Kind = "year" | "history" | "openSource" | "news";
const buildKindLabels=()=>( {year:ACTIVE_SITE.columns[3],history:ACTIVE_SITE.columns[4],openSource:ACTIVE_SITE.columns[2],news:"档案文章"});
export let KIND_LABELS:Record<Kind,string> =buildKindLabels();
export type WebsiteItem = {
  key:string; kind:Kind; title:string; summary:string; dateLabel:string; category:string;sectionId?:string;
  url:string; detailPage:boolean; lastmod:string|null; articleId?:string; revision?:number; version?:number;publishedVersion?:number|null;publicationState?:'published'|'withdrawn'|'unpublished';sourceUrls:{label:string;url:string}[];
  /** Published Chinese news only: whether its English page is live, being produced, or missing. Absent when unknown. */
  english?:'live'|'pending'|'missing';
};
export type FeishuSnapshot = {configured:boolean; updatedAt:string|null; records:Publication[]; baseUrl?:string; tableId?:string; warning?:string};
export type WebsiteSnapshot = {updatedAt:string|null; contentUpdatedAt?:string;scope?:'all'|'published';items:WebsiteItem[]};
export type Snapshot = {feishu:FeishuSnapshot;website:WebsiteSnapshot;drafts:{id:string;title:string;sourceIds?:string[]}[];bindings?:{id:string;title:string;sourceIds?:string[]}[]};
export const EMPTY:Snapshot = {feishu:{configured:false,updatedAt:null,records:[]},website:{updatedAt:null,items:[]},drafts:[]};
export type StatusFilter = "all" | "published" | "review" | "link" | "action";
export const STATUS_LABELS:Record<StatusFilter,string> = {all:trKey("全部记录"),published:trKey("已发布"),review:trKey("待审核"),link:trKey("待补链接"),action:trKey("需处理")};
export function matchesStatus(record:Publication,filter:StatusFilter):boolean {
  if(filter==="all")return true;
  if(filter==="published")return record.status==="已发布";
  if(filter==="review")return /待审核|审核中/.test(record.status);
  if(filter==="link")return /待补.*链接/.test(record.status)||(record.status==="已发布"&&!record.url);
  return /失败|异常|驳回|退回|待修复|受限|人工处理/.test(record.status)||Boolean(record.issue);
}
export function recordMatches(r:Publication,q:string,platform:string,status:StatusFilter):boolean {
  return (!platform||r.platform===platform)&&matchesStatus(r,status)&&
    [r.title,r.sourceId,r.platform,r.account,r.taskId].join(" ").toLowerCase().includes(q.trim().toLowerCase());
}
export type ArticleGroup = {key:string;sourceId:string;title:string;records:Publication[];latest:string};
export function groupRecords(records:Publication[]):ArticleGroup[] {
  const groups=new Map<string,ArticleGroup>();
  for(const r of records){
    // Titles are editable and are not identities. Missing source IDs stay separate.
    const key=r.sourceId?"source:"+r.sourceId:"record:"+r.id;
    const date=r.modifiedAt||r.checkedAt||r.publishedAt||r.submittedAt||"";
    const g=groups.get(key)||{key,sourceId:r.sourceId,title:r.title,records:[],latest:""};
    g.records.push(r);if(date>=g.latest){g.latest=date;g.title=r.title;}groups.set(key,g);
  }
  return [...groups.values()].sort((a,b)=>b.latest.localeCompare(a.latest)||a.title.localeCompare(b.title,"zh"));
}
export function dateText(value:string|null|undefined):string {
  if(!value)return tr("尚未刷新");
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return value;
  return new Intl.DateTimeFormat(uiLocale(),{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(date);
}
export function feishuLink(snapshot:FeishuSnapshot,recordId?:string):string {
  try{const url=new URL(snapshot.baseUrl||"");if(url.protocol!=="https:")return "";
    if(snapshot.tableId)url.searchParams.set("table",snapshot.tableId);
    if(recordId)url.searchParams.set("record",recordId);return url.href;
  }catch{return "";}
}

onActiveSiteChange(()=>{KIND_LABELS=buildKindLabels();});
