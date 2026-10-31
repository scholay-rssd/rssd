import {optionalJson} from '../../../../scripts/editorial-sync.mjs';
import {join} from 'node:path';
import {readDraft} from '../../../../scripts/editorial-workspace.mjs';

function kindOf(entry){
 if(entry.recordKind==='year'||entry.archiveCategory&&/日历|日程|情报/.test(entry.archiveCategory))return 'calendar';
 if(entry.recordKind==='history'||entry.archiveCategory&&/历史|昔日/.test(entry.archiveCategory))return 'history';
 if(entry.recordKind==='openSource'||entry.archiveCategory&&/开源|资源/.test(entry.archiveCategory))return 'works';
 return 'works';
}

export async function listExistingMaterials(root,{query='',mode}={}){
 const index=await optionalJson(join(root,'_ops/inventory/article-index.json'));
 const articles=Object.entries(index?.articles||{}).map(([id,meta])=>({id,...meta,mode:kindOf({...meta,id})}));
 const q=String(query||'').toLowerCase();
 return articles.filter(item=>{
  if(mode&&item.mode!==mode&&!(mode==='works'&&item.mode==='works'))return false;
  if(!q)return true;
  return [item.id,item.title,item.shortTitle,item.archiveCategory,item.sectionId].join(' ').toLowerCase().includes(q);
 }).slice(0,80);
}

export async function readExistingWork(root,id){
 const draft=await readDraft(id,root);
 return {id:draft.id,title:draft.title,markdown:draft.markdown,sha256:draft.sha256,sectionId:draft.sectionId,type:draft.type,writingSkills:draft.writingSkills,canonicalPath:draft.canonicalPath};
}

export async function resolveExistingMount(root,input){
 if(input.id){
  const work=await readExistingWork(root,input.id);
  return {
   kind:'existing',title:work.title||work.id,locator:{id:work.id,mode:'works'},
   version:{contentHash:work.sha256,label:'work',snapshot:{id:work.id,title:work.title,sha256:work.sha256,sectionId:work.sectionId,type:work.type}},
   state:'ready',role:'background',scope:{id:work.id,readOnly:true},work,
  };
 }
 const mode=input.mode||input.collection||'works';
 if(!['works','calendar','history'].includes(mode))throw Error('已有资料只支持 works、calendar 或 history');
 const items=await listExistingMaterials(root,{query:input.query,mode});
 return {
  kind:'existing',
  title:mode==='calendar'?'学术日历':mode==='history'?'历史记录':'已有作品',
  locator:{mode,query:input.query||null},
  version:{contentHash:items.map(i=>i.id+':'+(i.sha256||'')).join('|').slice(0,64)||mode,label:mode,snapshot:{mode,items:items.map(i=>({id:i.id,title:i.title,archiveCategory:i.archiveCategory,sectionId:i.sectionId}))}},
  state:'ready',role:'background',scope:{mode,readOnly:true,query:input.query||null},
 };
}
