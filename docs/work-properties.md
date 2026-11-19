# 作品属性：写作前定什么，作品上留什么

本页汇总影响成文效果和风格的属性：标题、文体、挂载的技能、必备要素、配图规则、写作方案等。
设备、智能体和模型不在本页范围内。每个属性都回答三个问题：在哪里决定，作品上存不存，
Obsidian 里看不看得到。

本页描述 2026-11-19 的 main，写作目录版本 `2026-11-19.2`。标注“待合并”的条目还在开着的 PR 里。
挂载项的分类和角色见 [mounts.md](./mounts.md)，写作目录的发布和使用见
[writing-defaults.md](./writing-defaults.md)。

## 一、三个位置

| 位置 | 内容 | 什么时候定 |
| --- | --- | --- |
| 写作前 | 栏目在写作目录和 Center 栏目设置里的规则；需求池里的一张需求；本地调整文件 | 下单时定需求；认领时冻结栏目规则和写作基线 |
| 作品上 | Center 里作品每个语言版本的正文、来源、图片和 `metadata` | 交稿时写入 |
| Obsidian | 插件的 Details 面板（Work details）和笔记属性（frontmatter） | 同步时从作品生成 |

一个属性只出现在写作前、没有带到作品上，本页称它“游离”：写完以后，从作品上看不出它当初是什么。

## 二、栏目决定的属性

选定栏目，这些就定了。需求上不用写，也改不了。

| 属性 | 定义位置 | 作品上 | Obsidian |
| --- | --- | --- | --- |
| 文体（`mode`），即模板名：calendar、history、xiwen、observation、essay、documentation、design、encyclopedia、opensource | 写作目录；桌面端“文章模板”用同一套名字（`TEMPLATE_MODES`） | 不留名字，只留写作基线的哈希 | 看不到 |
| 内容家族（`familyId`），决定挂哪个文体技能 | `contracts/writing-column-families.json` | 同上 | 看不到 |
| 挂载的技能：`rssd-writing-base`、`rssd-writing-<家族>`、`rssd-domain-<站点>`；写笔记时在共同规则后加 `rssd-writing-note` | 写作目录 | 每次运行的模型签名里有技能编号、版本和哈希（`notebook.modelSignatures[].writingSkills`） | 看不到 |
| 栏目范围（`scope`）和必备要素（`requiredElements`）；收笔记的栏目另有笔记的必备要素（`note`） | `contracts/editorial-column-policy.mjs`、`contracts/writing-defaults.mjs` | 不留 | 看不到 |
| 配图规则（`images`）：正文至少几张、图从哪来、数据图是否必须算出来、替代文字长度 | `contracts/writing-defaults.mjs` | 只有图片和图注本身 | 看不到 |
| 交付格式（`delivery`）和记录类型：calendar 交 `year` 记录，history 交 `history` 记录，其余交普通文章 | 写作目录；`desktop/scripts/agent/center-record.mjs` | `metadata.record.kind` | `rssd-kind`，只读 |
| 写作协议（正文和作者备注怎么分） | `contracts/article-writing-policy.mjs` | 只留写作基线的哈希 | 看不到 |
| 栏目接受的作品类型、长文是否带卡片页（`workTypes`、`articleCards`） | `contracts/site-sections.mjs` | 见第三节的作品类型 | 看不到 |
| 栏目规则文本、品牌尾注、发布去向、署名人格 | Center 各工作区的栏目设置；认领时冻结进需求的 `policy` | 只留署名（`metadata.author`），人格编号在 `metadata.persona`，只留在 Center | 署名可见 |

写作基线在作品上记为 `metadata.writingDefaults`：目录版本、目录哈希、基线哈希、源提交、
本地调整的哈希和来源。它能证明当时用的是哪一版规则，但不直接写出文体、家族和技能的名字。

## 三、每篇决定的属性

| 属性 | 在哪里定 | 作品上 | Obsidian |
| --- | --- | --- | --- |
| 标题 | 需求的 `title`；成稿时可再定 | 有 | 可见、可改 |
| 写作方案：读者问题、角度、结构、必读材料、边界 | 需求的 `brief`，原样交给写作方，排在规则之后 | 不留，游离 | 看不到 |
| 作品类型：长文或笔记 | 需求的 `workType`；本地写作用调整文件里的 `workType` | `metadata.workType`，选了才记，没记的按栏目默认类型 | 看不到；`rssd-kind` 是记录类型，分不出长文和笔记（待合并：rssd-obsidian#26 加 `rssd-type`） |
| 由哪篇长文改写 | 需求的 `adaptedFrom` | `metadata.adaptedFrom` | 看不到（待合并：rssd-obsidian#26 加 `rssd-adapted-from`） |
| 语言 | 需求的 `requiredLocales` | 每种语言一个版本 | `rssd-locale`，只读 |
| 线索：选题由什么启发 | 需求的 `lead` | 不留，游离 | 看不到 |
| 取材来源 | 桌面端和单篇产出按需挂载；Center 需求没有这一项，只能在简介里写必读材料 | 稿件来源列表 `notebook.sources`：链接、题名、摘要、是否确认、取得方式 | 看不到 |
| 篇幅 | 本地调整文件的 `bodyLength`；Center 需求没有这一项 | 只留调整的哈希 | 看不到 |
| 本地写作偏好 | 本地调整文件的 `instructions` | 只留调整的哈希 | 看不到 |
| 标题模板、正文模板、品牌资料 | 桌面端挂载选择器，存在稿件的 `titleTemplate`、`mounts.templates`、`mounts.brands` | Center 写作流程交的稿件里没有 | 看不到 |
| 品牌挂载（例如用 Scholay 科研助手实操） | 跟着单子走：需求简介的“品牌”一段，见 [pool-orders.md](./pool-orders.md)；不绑定栏目 | 没有单独的字段，只体现在正文里 | 看不到 |
| 摘要、日期、分类 | 成稿时写 | `summary`、`metadata.date`、`metadata.category` | 可见、可改 |
| 话题标签 | 成稿时写 | `metadata.tags`，写了才记 | 看不到（待合并：rssd-obsidian#26 加 `rssd-tags`） |
| 日历、历史的结构化字段 | 成稿时写，见第五节 | `metadata.record.fields` | 看不到 |

需求上另有 `priority`、`dueAt`、`topicKey`，它们管排队和查重，不影响成文。

## 四、Obsidian 里能看到的

Details 面板和笔记属性显示的是同一组 11 个属性（`obsidian/src/details.mjs`、`obsidian/src/sync-model.mjs`）。

| 属性 key | Details | 能否编辑 |
| --- | --- | --- |
| `title` | 标题，按公众号标题 64 字、卡片标题 20 字计数 | 可改 |
| `summary` | 摘要，按公众号摘要 120 字计数 | 可改 |
| `date` | 日期 | 可改 |
| `author` | 署名，按公众号作者 16 字计数 | 可改 |
| `category` | 分类 | 可改 |
| `rssd-section`、`rssd-locale` | 栏目、语言，在“Center link”里 | 只读 |
| `rssd-kind` | 记录类型：普通文章是 `news`，另有 `year`、`history`、`openSource` | 只读 |
| `rssd-id`、`rssd-version`、`rssd-published-version` | 作品 ID、Center 版本、已发布版本 | 只读 |

字数上限取自 `contracts/output-package.mjs`。日历、历史这类结构化记录在 Obsidian 里，摘要、署名、
日期、分类都不能改，标题必须与正文的一级标题一致；结构化字段不显示，也不会从笔记回传。Details 的
“To check”列出摘要、署名、分类、日期和图片描述的缺项。Details 另外显示作者备注和运行记录，
它们是写作过程的私有记录，不是属性。

## 五、今日学术的两种记录

今日学术站点（工作区 `academic`）有四个栏目。学界犀闻（`briefings`）和学者观察（`observations`）
是普通文章，也收笔记。今日学术（`calendar`）和昔日学术（`history`）交的是记录，字段和章节都是固定的
（`contracts/rssd-record.cjs`，写作要求见 `desktop/scripts/agent/center-record.mjs`）。

| | 今日学术 `calendar` | 昔日学术 `history` |
| --- | --- | --- |
| 记录类型 | `year` | `history` |
| 一篇写什么 | 一个有年度惯例价值的事项；分清惯例和当年安排，不把一次性截止日期推算成每年固定日期 | 一个能核实到具体某天的真实历史事件 |
| 字段 | `category`、`start`、`end`、`dateBasis`、`sourceName`、`sourceUrl`、`tags` 等 | `year`、`dateKey`（MM-DD）、`domain`、`eventType`、`importance`（S、A、B）、`preciseToDay`（必须为 true）、`sources` |
| 固定的二级标题 | 摘要、正文 | 事实摘要、学术意义 |
| 必备要素 | 一项年度惯例事项及依据；惯例与当年日期的区别；适用人群和官方行动入口 | 一项真实历史事件及日期依据；人物、过程和原始材料；学术意义 |

日历的 `category` 只能取站点配置里的分类（`sites/profiles.json` 的 `yearCategories`）。今日学术有
12 类：节假日、培养节点、学术会议、自然科学基金、人文社科基金、国家科技项目、地方科研项目、
人才计划、博士后项目、国际科研机会、学术出版、科研岗位。`start` 是事项实际开放或截止的日期，
不是公告发布日；`dateBasis` 用一句话写明各日期是什么日期、什么时区。

这两种记录的事项、日期依据、分类或重要度，都能在下单时先定下来。日期核实不了的，写作时会被拒，
例如昔日学术要求 `preciseToDay` 为 true。目前这些只能写在需求简介里。

## 六、同名不同义

| 名字 | 含义 |
| --- | --- |
| `category` | 笔记属性和 `metadata.category` 是站点上的展示分类；日历记录 `fields.category` 是 `yearCategories` 之一 |
| `kind` | `rssd-kind` 和 `metadata.record.kind` 是记录类型（news、year、history、openSource）；稿件 `notebook.kind` 是 article 或记录类型；需求和作品的 `workType` 是长文或笔记 |
| 模板 | 栏目的文体（`mode`），与桌面端文章模板同名；标题模板是另一项；文章导出模板属于版式（[mounts.md](./mounts.md)） |
| 署名 | `author` 是文章作者名；栏目规则里的品牌是文末的品牌尾注 |

## 七、已知缺口

- 写作方案只存在需求简介里，写完后作品上不留，游离。
- 线索只记在需求上，作品不留。
- 文体、内容家族、必备要素、配图规则在作品上只有写作基线的哈希，要按栏目和目录版本反查。
- 篇幅、本地写作偏好、标题模板、正文模板、品牌资料不进 Center 需求；由 Center 写作流程写出的作品没有这几项。
- 日历和历史记录的结构化字段存在作品上，Obsidian 里看不到。
- 作品类型、话题标签、改写来源在 Obsidian 里看不到，等 rssd-obsidian#26 合并。
- 需求池超前下单时，写法相关的内容只能放进简介，没有结构化的字段；简介的写法按
  [pool-orders.md](./pool-orders.md) 的单子格式。
