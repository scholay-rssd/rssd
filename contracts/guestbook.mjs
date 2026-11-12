const field=(key,label,required=false,max=500)=>({key,label,required,max});
export const FORMS={
 enter:[
  {id:'resource',label:'推荐学术资源',fields:[field('source','网站或工具链接',true),field('purpose','用途与适用人群',true),field('access','费用与访问条件（如已知）')]},
  {id:'correction',label:'链接失效 / 信息纠错',fields:[field('source','页面或资源链接',true),field('detail','需要更正的信息',true)]},
  {id:'message',label:'交流与建议',fields:[]}
 ],
 'scholay-today':[
  {id:'collaboration',label:'项目合作',fields:[field('field','研究领域',true),field('need','希望寻找的伙伴与分工',true),field('deadline','截止时间 / 暂无截止时间')]},
  {id:'course',label:'课程与培训线索',fields:[field('organizer','主办方',true),field('schedule','课程日期与时区',true),field('source','官网与费用说明',true)]},
  {id:'message',label:'交流与建议',fields:[]}
 ],
 xsime:[
  {id:'bug',label:'问题反馈',fields:[field('platform','系统与版本',true),field('version','输入法版本 / 方案',true),field('steps','复现步骤',true,2000),field('expected','期望结果',true),field('actual','实际结果',true)]},
  {id:'feature',label:'功能建议',fields:[field('scenario','使用场景',true)]},
  {id:'group-buy',label:'键盘开团线索',fields:[field('organizer','发起方',true),field('source','公告链接',true),field('schedule','开团与截止时间、时区',true)]},
  {id:'collaboration',label:'项目合作',fields:[field('need','合作方向',true)]}
 ],
 piggytuck:[
  {id:'collaboration',label:'设计合作',fields:[field('brief','项目需求',true),field('deliverables','预期交付内容',true),field('schedule','时间安排'),field('budget','预算范围（选填）')]},
  {id:'event',label:'展览与赛事线索',fields:[field('organizer','主办方',true),field('source','官方链接',true),field('schedule','日期与地点',true)]},
  {id:'message',label:'作品交流',fields:[]}
 ],
 personal:[
  {id:'project',label:'项目交流 / 反馈',fields:[field('project','键盘、输入法或网站项目名称',true),field('need','反馈或合作需求',true)]},
  {id:'resource',label:'工具与学术网站推荐',fields:[field('source','项目链接',true),field('license','许可证 / 使用条件（如已知）')]},
  {id:'collaboration',label:'合作联系',fields:[field('need','合作方向',true)]}
 ],
 pets:[
  {id:'story',label:'猫狗故事',fields:[field('animal','动物种类',true),field('permission','故事与图片来源 / 授权说明')]},
  {id:'event',label:'展赛与节日线索',fields:[field('organizer','主办方',true),field('source','官方链接',true),field('schedule','日期、时区与地点',true)]},
  {id:'correction',label:'百科纠错',fields:[field('source','文章与核验来源',true)]},
  {id:'collaboration',label:'合作需求',fields:[field('need','合作方向',true)]}
 ]
};
export function guestbookConfig(site){
 const forms=FORMS[site.id];if(!forms)throw Error('Unknown guestbook site');
 return {siteId:site.id,name:site.name,home:site.origin,accent:site.accent,timezone:site.timezone,dailyLimit:2,forms};
}
