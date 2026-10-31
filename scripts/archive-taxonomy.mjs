import {SITE} from './site-config.mjs';
export const archiveCategories=SITE.legacy?['学界犀闻','学者观察','昔日学术','学术情报','学术开源']:SITE.columns;
export function draftCategory(draft){
  if(draft.archiveCategory==='未归栏'||draft.canonicalPath?.includes('/未归栏/'))return '未归栏';
  if(archiveCategories.includes(draft.archiveCategory))return draft.archiveCategory;
  if(!SITE.legacy)return SITE.columns[1];
  const p=draft.canonicalPath||'';
  return /\/(新闻聚合|学界犀闻)\//.test(p)?'学界犀闻':/\/(开源项目|学术开源)\//.test(p)?'学术开源':/\/昔日学术\//.test(p)?'昔日学术':/\/学术情报\//.test(p)?'学术情报':'学者观察';
}
