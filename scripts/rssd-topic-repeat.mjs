// Check a proposed topic against what its column already has in Center, using the
// shared rules in contracts/topic-repeat.mjs. Read-only: it lists works and never
// creates, claims or changes anything.
import {readFileSync} from 'node:fs';
import {findRepeat} from '../contracts/topic-repeat.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';

const PAGE=200;

/** Every work of one column, with its title (zh-CN edition first). Pages until a short page. */
export async function columnWorks(client,{workspaceId,sectionId,maximumPages=5000}={}){
 if(typeof client?.works!=='function')throw Error('A Center client that can list works is required');
 const out=[];
 for(let page=0,offset=0;;page++,offset+=PAGE){
  if(page>=maximumPages)throw Error('Works list did not end within '+maximumPages+' pages');
  const response=await client.works({workspaceId,limit:PAGE,offset});
  const rows=Array.isArray(response)?response:response?.works||response?.items;
  if(!Array.isArray(rows))throw Error('Unexpected works list shape');
  for(const work of rows){
   if(work.sectionId!==sectionId)continue;
   const editions=Array.isArray(work.editions)?work.editions:[];
   const edition=editions.find(e=>e.locale==='zh-CN')||editions[0];
   const title=edition?.title||edition?.payload?.title||work.title||null;
   if(title)out.push({workId:work.id||work.workId,title});
  }
  if(rows.length<PAGE)return out;
 }
}

/** The labels that lead a column's titles without being their subject: the column's own name. */
export function columnPrefixes(workspaceId,sectionId,profiles=JSON.parse(readFileSync(new URL('../sites/profiles.json',import.meta.url),'utf8'))){
 const site=profiles.find(p=>p.spaceId===workspaceId);
 const section=site?sectionsForSite(site).find(s=>s.id===sectionId):null;
 return section?.name?[section.name]:[];
}

/** Whether `title` (and optionally `topicKey`) repeats a work of the column. Returns {state,repeat,compared}. */
export async function topicRepeatCheck({client,workspaceId,sectionId,title,topicKey,reserved=[],profiles}){
 if(typeof title!=='string'||!title.trim())throw Error('Give the proposed title');
 const works=await columnWorks(client,{workspaceId,sectionId});
 const repeat=findRepeat({title,topicKey},{works,reserved},{prefixes:profiles?columnPrefixes(workspaceId,sectionId,profiles):columnPrefixes(workspaceId,sectionId)});
 return {state:repeat?'repeat':'new',workspaceId,sectionId,title,...(topicKey?{topicKey}:{}),repeat,compared:{works:works.length,demands:reserved.length}};
}
