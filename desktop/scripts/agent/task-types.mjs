// THE definition of each production task type. A type describes how one post is produced and checked;
// which column or site later uses the post is not decided here. The agent scripts and the desktop UI
// both read this table, so adding or changing a type happens in one place. Nothing here names a subject
// area: the skill a type reads, its wording and its default topic cards come from the domain pack
// (domain-pack.mjs).
//
// `topic` names the station of the topic step. 'matrix' gathers several materials in columns of cards and is the
// digest's; 'single' picks exactly one material, which is all a post about one event, resource or notice needs.
//
// The keys are the stored `task.mode` values and stay stable: existing tasks and saved template
// libraries are keyed by them. A `structured` type carries verified fields besides its prose; which
// column or site record those become is the destination profile's business (destinations.mjs).
export const TASK_TYPES={
 xiwen:{name:'资讯汇编',description:'筛选、组织多个独立事件，编成一期资讯合集',icon:'M4 4h16v16H4zM8 8h8M8 12h3M8 16h3M14 12h2M14 16h2',
  article:true,days:7,sections:3,topic:'matrix',dateRule:'recent'},
 observation:{name:'事件报道',description:'围绕一个事件或问题，整理事实、背景和观点',icon:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  article:true,days:30,sections:1,topic:'single',dateRule:'recent'},
 opensource:{name:'资源介绍',description:'介绍工具、项目、数据集等资源及其用途',icon:'m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18',
  article:true,days:30,sections:1,topic:'single',dateRule:'recent',structured:true,
  rules:'由作者核查官方仓库、许可证、归档状态和核对日期。资料阅读范围及未执行的安装或测试写入私有 verification；正文按已核实来源叙述，不用“未实测”替代核查，不把核验过程放入公开 status，也不把资料介绍写成本站实测。',
  recordLabels:['项目资料','开源用途','许可证与来源']},
 calendar:{name:'通知公告',description:'整理活动、征集、申报等事项的时间、条件和入口',icon:'M4 5h16v16H4zM8 2v6M16 2v6M4 10h16M8 14h2M14 14h2M8 18h2',
  article:true,days:30,sections:1,topic:'single',dateRule:'recent',structured:true,
  rules:'原文发布日、活动区间、申请窗口分开核实。',
  recordLabels:['事项日期','申报或会议信息','来源资料']},
 history:{name:'历史事件',description:'核实过去发生的事件及其意义',icon:'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l4 2',
  article:true,days:30,sections:1,topic:'single',dateRule:'event',structured:true,
  rules:'年份与月日来自可靠史料并核对实际年份下的有效日期，不用近期检索范围改写历史事件日期；检索范围只限定新线索。',
  recordLabels:['事件日期','史实说明','史料来源']},
};
/** Subscription-source discovery is a service of Settings › Subscriptions, not a content type. It uses the
 *  same board engine, fills a board and stops: no outline, manuscript or images. */
export const DISCOVERY_TASK={name:'AI 搜索订阅源',description:'寻找订阅源，补充信息采集入口',icon:'M5 4a15 15 0 0 1 15 15M5 10a9 9 0 0 1 9 9M5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  article:false,days:30,sections:1,dateRule:'none'};
/** Task modes that are not content types: a local image conversation and read-only old sessions. */
export const OTHER_TASK_MODES={image:'图片生成',legacy:'历史会话'};
export const TASK_TYPE_IDS=Object.keys(TASK_TYPES);
/** Display name of every task mode, content types first. */
export const TASK_MODE_NAMES={...Object.fromEntries(TASK_TYPE_IDS.map(id=>[id,TASK_TYPES[id].name])),rss:DISCOVERY_TASK.name,...OTHER_TASK_MODES};
/** The engine definition of a mode: a content type, or the discovery service. */
export const taskType=mode=>Object.hasOwn(TASK_TYPES,mode)?TASK_TYPES[mode]:mode==='rss'?DISCOVERY_TASK:null;
/** Types that end in a manuscript (topic → outline → draft). */
export const isArticleType=mode=>!!taskType(mode)?.article;
export const defaultDays=mode=>taskType(mode)?.days??30;
export const defaultSections=mode=>taskType(mode)?.sections??1;
/** Types whose post is built on exactly one chosen material. */
export const isSingleTopic=mode=>taskType(mode)?.topic==='single';
