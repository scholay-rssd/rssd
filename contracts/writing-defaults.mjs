// GitHub owns these defaults. Center distributes a compiled, fingerprinted
// catalog; a writing device freezes one online baseline before local choices.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ARTICLE_WRITING_POLICY,ARTICLE_WRITING_INSTRUCTIONS} from './article-writing-policy.mjs';
import {COLUMN_RULES} from './editorial-column-policy.mjs';
import {writableSectionsForSite} from './site-sections.mjs';
import contract from './writing-defaults-v1.cjs';

export const WRITING_DEFAULTS_VERSION='2026-11-14.1';
export const WRITING_DOMAIN_IDS=['academic','metho','pets','enter','study','xsiching','legis','design','xsime','personal'];
const elements={
 'academic/calendar':['一项年度惯例事项及依据','惯例与当年日期的区别','适用人群和官方行动入口'],
 'academic/history':['一项真实历史事件及日期依据','人物、过程和原始材料','学术意义'],
 'academic/briefings':['至少两件独立的已读话题','逐项事实与意义','编辑组织及共同问题'],
 'academic/observations':['一个学术话题','事实、方法或过程','依据材料展开的解释'],
 'metho/methods':['研究问题与适用条件','数据和估计目标','具体步骤、实例及解释'],
 'metho/statistics':['统计概念及目标','有依据或明确示意的算例','结果读法及适用条件'],
 'metho/experiments':['实验问题和设计','变量、对照与测量','实施步骤和结果解释'],
 'metho/frontiers':['具体论文或技术资料','新方法或实际改进','与已有方法的关系和可核对结果'],
 'pets/pet-news':['真实研究、福利或行业事件','信息来源、对象与主要发现','对宠物照护的具体意义'],
 'pets/daily-cat':['一个未重复的猫品种','识别特征与行为','照护和生活需求'],
 'pets/daily-dog':['一个未重复的犬种','特征与行为','照护和生活需求'],
 'pets/exotic-pets':['一种其他伴侣动物','习性与生活环境','照护条件及适养边界'],
 'enter/forums':['真实社区和参与入口','适合人群','交流规则、参与方式与价值'],
 'enter/software':['一个真实软件或网站','读者任务与实际使用路径','功能依据、条件和限制'],
 'enter/search':['检索资源或具体任务','覆盖范围','实际检索方法与入口'],
 'enter/courses':['提供者、主题及教学材料','适合人群与学习安排','真实访问、报名或费用信息'],
 'study/courses':['课程定位与先修要求','已读取的章节和练习内容','学习次序及访问方式'],
 'study/models':['原始论文、模型卡或官方发布','实际改进与能力证据','评测口径及适用范围'],
 'study/offers':['真实权益和官方入口','适用条件','有效期和取得步骤'],
 'study/certificates':['认证方及证书要求','课程或备考安排','当前考试、费用和官方入口'],
 'xsiching/classics':['可靠版本与原文出处','原文及译解','与原文分开的评论'],
 'xsiching/interpretations':['一个国学或易学观点','文献依据','解释与论证'],
 'xsiching/applications':['真实应用和来源','已核对的功能','使用路径和适用条件'],
 'xsiching/courses':['真实机构、课程和材料','课程内容及适合人群','学习路径和访问方式'],
 'legis/frontiers':['一个新兴法律议题','法域、材料日期和制度依据','争议与分析'],
 'legis/cases':['真实非知识产权案例及案号或官方判决','事实与争点','裁判理由和结果'],
 'legis/ip':['明确的知识产权问题','法域、时点和制度依据','事实与分析'],
 'legis/regulations':['一项正式法规政策或修订','适用范围、生效时间及效力','主要变化与实施依据'],
 'design/works':['所有者真实设计资料','目标、约束和视觉决策','可见成果及作者归属'],
 'design/design-news':['真实项目、展览、奖项或行业变化','作者、时间及原始资料','设计特点和意义'],
 'design/icons':['真实图标或图标系统的可见样本','视觉特点和用途','作者、来源及许可'],
 'design/web-design':['真实网站的可见页面','布局、字体、色彩和交互','第三方作者与来源'],
 'xsime/tutorials':['实际支持的读者任务','平台、版本及最小操作步骤','可观察结果'],
 'xsime/development':['本项目真实代码或版本资料','问题、取舍及实际改动','已完成状态与后续计划的区别'],
 'xsime/input-schemes':['真实方案与编码','词库或配置方法','来源、适合人群及兼容性'],
 'xsime/input-skins':['真实主题或界面设计','实际效果或示例','来源、配置及兼容性'],
 'personal/works':['所有者实际参与的项目','目标和过程','真实成果与贡献'],
 'personal/product-news':['自有项目的真实更新','版本或里程碑证据','发布状态与使用入口'],
 'personal/reflections':['真实笔记或讨论中的产品问题','设计取舍及依据','作者已有观点'],
 'personal/academic-notes':['已有阅读、研究或实践材料','一个学术问题','材料支持的解释与思考'],
};
const families=JSON.parse(readFileSync(new URL('./writing-column-families.json',import.meta.url)));
export const WRITING_RULE_SKILL_IDS=['rssd-writing-base',...new Set(Object.values(families).map(id=>'rssd-writing-'+id)),...WRITING_DOMAIN_IDS.map(id=>'rssd-domain-'+id)];
export const WRITING_RULE_PATHS=[...WRITING_RULE_SKILL_IDS.map(id=>'contracts/writing-skills/'+id+'/SKILL.md'),'contracts/writing-skills/rssd-writing-base/references/images.md'];
function skill(id){const content=readFileSync(new URL('./writing-skills/'+id+'/SKILL.md',import.meta.url),'utf8');return {id,name:id,version:WRITING_DEFAULTS_VERSION,contentHash:contract.textHash(content),content};}
export function buildWritingDefaultsCatalog({source}){
 const profiles=JSON.parse(readFileSync(new URL('../sites/profiles.json',import.meta.url)));
 const skills=WRITING_RULE_SKILL_IDS.map(skill),path='rssd-writing-base/references/images.md',content=readFileSync(new URL('./writing-skills/'+path,import.meta.url),'utf8');
 const references=[{path,contentHash:contract.textHash(content),content}];
 const workspaces=profiles.map(site=>({siteId:site.id,workspaceId:site.spaceId,name:site.name,sections:writableSectionsForSite(site).map(s=>{
  const key=site.spaceId+'/'+s.id,rule=COLUMN_RULES[site.id]?.[s.id],familyId=families[key];
  if(!rule||!elements[key]||!familyId||!WRITING_DOMAIN_IDS.includes(site.spaceId))throw Error('Missing canonical writing defaults: '+key);
  const actualObject=['animal','visual'].includes(familyId)||['design/works','personal/works'].includes(key);
  return {id:s.id,name:s.name,mode:s.defaultMode,scope:rule,familyId,requiredElements:elements[key],skillIds:['rssd-writing-base','rssd-writing-'+familyId,'rssd-domain-'+site.spaceId],referencePaths:[path],images:{minimum:1,sourceMode:actualObject?'actual-object':'source-or-illustration',dataFigures:'computed-only',altMin:20,altMax:60}};
 })}));
 const body={schemaVersion:1,version:WRITING_DEFAULTS_VERSION,source,writingPolicy:{version:ARTICLE_WRITING_POLICY,instructions:ARTICLE_WRITING_INSTRUCTIONS,sha256:createHash('sha256').update(ARTICLE_WRITING_INSTRUCTIONS).digest('hex')},skills,references,workspaces};
 return contract.catalog({...body,hash:contract.hash(body)});
}
export const resolveWritingDefaults=contract.resolve;
