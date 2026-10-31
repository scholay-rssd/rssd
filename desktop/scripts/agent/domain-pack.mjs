import {GUOXUE,isGuoxueSite} from './guoxue-domain.mjs';
import {ACTIVE_SITE,onActiveSiteChange} from '../../../scripts/site-profile.mjs';
// The domain pack: everything the engine says or offers that belongs to a subject area rather than to a task type —
// which skill a type reads, how the type is described to the agent, the default topic cards, the illustration
// briefs. The registry (task-types.mjs) defines the process; a pack fills it for one field. Another field is another
// pack; the academic pack below is the built-in one and reproduces what the workbench did before packs existed.
//
// A card is [name, column title, retrieval direction]. `columns` groups a type's cards into ready-made board
// columns by index; without it each card becomes its own column seen from several angles.
export const ACADEMIC={id:'academic',name:'学术',
 // Writing and delivery references every manuscript type reads besides its own skill. Missing files are tolerated.
 references:{board:['.agents/skills/scholay-xiwen/references/structured-workflow.md','.agents/skills/scholay-xiwen/references/source-preprocessing.md'],
  article:['.agents/skills/scholay-seo-writing/references/column-quality.md','.agents/skills/scholay-xiwen/references/local-draft-contract.md','.agents/skills/scholay-seo-writing/SKILL.md','.agents/skills/scholay-seo-writing/references/product-capabilities.md','.agents/skills/scholay-seo-writing/references/voice.md'],
  // A workspace without these cannot produce a manuscript in this pack; the others are read when present.
  required:['.agents/skills/scholay-xiwen/references/local-draft-contract.md','.agents/skills/scholay-seo-writing/SKILL.md']},
 // The illustration style guide is only read when an image request asks for the brand character.
 imageStyle:{match:'犀牛|rhino|scholay-rhino-illustration',files:['.agents/skills/scholay-rhino-illustration/SKILL.md','.agents/skills/scholay-rhino-illustration/references/style-and-origin.md']},
 galleryPresets:['学术新闻配图，简洁的编辑插画，不包含文字','研究方法示意图，清晰表达结构与关系','开源项目封面，抽象科技风格，横向构图'],
 types:{
 xiwen:{skill:'scholay-xiwen',
  subject:'资讯汇编：按人工分栏和槽位采集独立新闻',
  illustrations:['已选新闻之间的事实关系和分栏结构','新闻结论的适用范围与证据边界'],
  columns:[['研究前沿',[0,2,7]],['基金与政策',[1,6,4]],['学界动态',[5,8,3]]],
  cards:[
   ['科研突破','研究前沿','寻找有新证据、新方法或新发现的原创研究。解释具体发现、与既有工作的差异和研究局限；优先论文及研究机构原文，区分预印本与同行评议。'],
   ['资助新规','基金与资助','寻找科研基金、资助计划和申报规则的新公告。提取资助对象、支持范围、申请条件和截止日期；优先资助机构原文，不把旧项目的截止提醒当成新公告。'],
   ['AI 科研工具','AI 与科研','寻找 AI 辅助科研的新方法、工具和评测。关注实际科研任务、公开证据与复现条件；区分作者声明和独立验证，避免无依据的能力宣传。'],
   ['开源新项目','开源与开放科学','寻找面向科研的新开源项目、数据集或重要版本更新。核对官方仓库、许可证、维护状态与适用场景；本周更新的老项目需注明原始发布时间。'],
   ['会议与征稿','会议与学术活动','寻找新发布的学术会议、研讨会和征稿通知。提取主题、主办方、时间地点、参与方式和截止日期；核对主办方入口，不以聚合站转载作唯一依据。'],
   ['高校与学者','学界动态','寻找高校、研究机构、学术组织和学者的重要动态，包括合作、奖项与研究设施开放。说明其学术关联，避免无来源排名、个人传闻和商业软文。'],
   ['出版与诚信','出版与科研规范','寻找学术出版、同行评议、科研伦理和研究评价制度的新变化。核对期刊、出版商或主管机构原文，区分正式政策、征求意见和个案；不将指控写成既定事实。'],
   ['人文与社会','人文社科观察','寻找人文社会科学的新研究、数据资源与学术讨论。交代对象、方法、地域和证据边界；区分研究结果与评论，不用单一研究推断普遍规律。'],
   ['学界热议','学界讨论','寻找近期学界公开讨论、有可靠来源的议题或争论，如评价标准、研究方法或学术规范之争。交代各方立场与依据，区分事实、观点与传闻；优先署名文章、机构声明与原始讨论记录，不转述无来源的内部消息。'],
  ]},
 observation:{skill:'scholay-scholar-observation',
  subject:'事件报道：聚焦一件事，默认一栏一个核心事件',
  illustrations:['核心事件的机制或过程','研究结果的适用范围与限制'],
  cards:[['制度变化','科研制度','聚焦一件科研评价、资助或出版制度变化，核对新旧规则、适用对象和事实边界，优先主管机构正式公告。'],['研究方法','方法与证据','聚焦一项研究方法或测量技术，查原论文与机构解释，区分实际实验结果、作者判断与媒体推断。'],['学术生态','学术实践','聚焦一个学术组织或研究者事件，核实公开来源，不使用个人传闻、不将指控写成事实。']]},
 opensource:{skill:'scholay-academic-opensource',
  subject:'资源介绍：聚焦一个面向科研的开源项目，核对官方仓库、许可证和实际用途',
  illustrations:['项目的输入、处理步骤和输出','适用研究任务与能力边界'],cardDays:30,
  cards:[['科研软件','科研工具','查找科研开源软件，核对官方仓库、许可证、维护状态、文档和适用任务。未安装测试不得称为实测。'],['开放数据','数据与复现','查找开放数据集或复现工具，核对数据授权、版本、引用要求、下载入口与适用边界。'],['版本更新','项目更新','查找科研开源项目的重要版本，区分项目创立日期与本次更新日期，优先发布说明和许可证原文。']]},
 calendar:{skill:'scholay-academic-calendar',
  subject:'通知公告：聚焦一个有准确日期的会议、征稿、申报或科研事项',
  illustrations:['已核实的事项日期和安排','参与事项的准备与核对流程'],cardDays:30,recordShelf:true,
  cards:[['会议征稿','会议与征稿','查主办方的会议或征稿通知，记录活动开始结束日期与投稿截止日期，二者分开，核对时间地点与官方入口。'],['基金申报','基金与申报','查资助机构的正式申报通知，核实申请窗口、对象和条件；区分申报起止日期与公告发布日期。'],['出版活动','学术出版','查开放获取周、学术出版和公共科研活动的官方日程，不将活动日期冒充申请窗口。']]},
 history:{skill:'scholay-academic-history',
  subject:'历史事件：聚焦一个有可靠史料和完整事件日期的学术事件',
  illustrations:['已核实历史事件的发生过程','该事件对研究方式的影响及年代边界'],recordShelf:true,
  cards:[['论文里程碑','学术文献史','寻找与当前纪念日期有关的历史论文或学术出版事件，核对原始发表年、月、日与出版社或档案史料，不限定史料近期发布。'],['科研工具史','科研软件史','寻找科研工具、仪器或软件的历史事件，区分发明、项目创立、版本发布和论文发表的不同日期；缺确切日期时保留不确定性。'],['机构与人物','学术机构史','寻找有原始史料支撑的学术机构或学者历史事件，不用后来的技术细节补写历史场景。']]},
 },
 // Subscription-source discovery (Settings › Subscriptions › AI search).
 discovery:{skill:'scholay-rss-discovery',
  subject:'RSS 来源发现：整理真实可访问的 RSS 或 Atom 订阅地址，按人工设置的智能槽位；url 填订阅地址，summary 说明覆盖范围与原站；保存 board 后停止，不写稿、不自动订阅',
  cards:[['机构订阅','机构资讯','寻找大学、研究机构、资助机构提供的真实 RSS 或 Atom 订阅入口；核验地址可访问、包含条目与原文链接，不以普通网页冒充订阅源。'],['论文订阅','期刊与预印本','寻找期刊、出版社和预印本平台的 RSS 或 Atom 源，说明覆盖范围、分类与更新频率，不自动订阅。'],['开源动态','软件与数据源','寻找科研软件、开放数据和项目发布的真实订阅源，核验官方身份、条目日期和原文链接，不将未验证候选称为可用源。']]},
};
const buildCurrentDomain=()=>(isGuoxueSite(ACTIVE_SITE)?GUOXUE:ACTIVE_SITE.legacy?ACADEMIC:{...ACADEMIC,id:ACTIVE_SITE.spaceId,name:ACTIVE_SITE.domain,references:{board:[],article:[],required:[]},imageStyle:{match:'$^',files:[]},galleryPresets:[ACTIVE_SITE.domain+'的编辑插画，不含文字',ACTIVE_SITE.domain+'的流程示意图'],types:Object.fromEntries(Object.entries(ACADEMIC.types).map(([mode,value])=>[mode,{...value,skill:'site-writing',columns:undefined,subject:ACTIVE_SITE.domain+'：'+({xiwen:'资讯汇编',observation:'事件报道',opensource:'工具与资源介绍',calendar:'有明确日期与来源的日程',history:'有完整历史日期与来源的事件'}[mode]),cards:[[ACTIVE_SITE.domain,ACTIVE_SITE.columns[['xiwen','observation','opensource','calendar','history'].indexOf(mode)],'查找与'+ACTIVE_SITE.domain+'有关的原始来源。核实事实、事件日期与出处，不编造信息；历史事件不限近期发布。']],illustrations:['已核实的事实关系','范围与限制']}])) ,discovery:{skill:'site-writing',subject:'为'+ACTIVE_SITE.domain+'发现真实可访问的 RSS / Atom 源，只保存来源看板，不写文章、不自动订阅',cards:[['来源发现',ACTIVE_SITE.domain,'核验订阅地址、来源身份与真实条目，不将普通网页当作 RSS。']]}});
export let CURRENT_DOMAIN=buildCurrentDomain();
/** What the pack says about a mode: a content type's entry, the discovery service's, or null. */
export const domainType=(mode,pack=CURRENT_DOMAIN)=>Object.hasOwn(pack.types,mode)?pack.types[mode]:mode==='rss'?pack.discovery:null;

onActiveSiteChange(()=>{CURRENT_DOMAIN=buildCurrentDomain();});
