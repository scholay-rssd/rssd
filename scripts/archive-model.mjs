// Public editorial sections. Calendar algorithms retain their existing kinds.
export const archiveSections = [
  {slug:'briefings',name:'学界犀闻',description:'把多条科研动态串起来，读懂一期学界进展。'},
  {slug:'observations',name:'学者观察',description:'围绕一个研究话题，记录事实、背景与观察。'},
  {slug:'history',name:'昔日学术',description:'论文、发现与研究制度，回看学术如何走到今天。'},
  {slug:'calendar',name:'今日学术',description:'科研日程、项目申报、会议与培养节点的原始记录。'},
  {slug:'open-source',name:'学术开源',description:'与研究有关的开源项目、工具与使用经验。'},
  {slug:'collaboration',name:'项目合作',description:'科研课题的合作招募、伙伴需求与参与条件。'},
  {slug:'courses',name:'课程资源',description:'课程、培训、工作坊、长期教程与录播；区分类型、费用和报名状态。'}
];
export function archiveSection(kind,item={}) {
  if(kind==='news'&&['项目合作','课程资源'].includes(item.category))return archiveSections.find(x=>x.name===item.category);
  const slug=kind==='year'?'calendar':kind==='history'?'history':kind==='openSource'?'open-source':({'学界犀闻':'briefings','新闻聚合':'briefings','学术新闻':'briefings','学者观察':'observations','昔日学术':'history','学术情报':'calendar','今日学术':'calendar','学术开源':'open-source'}[item.category]||'observations');
  return archiveSections.find(x=>x.slug===slug);
}
export const isVerified=item=>['已核验官网','已核验'].includes(item.provenance);
