# 挂载式内容：分类、规则与清单

文章产出过程中可以接入的外部内容（取材来源、写作规则、技能、人格、模板等）统称挂载项。
本页回答三个问题：有哪些挂载项，每一类对文章有什么要求，新增一个挂载项应该放在哪。

本页描述 2026-11-19 的现状，即作品类型、需求池和人格署名并入主干之后的情况。
标注“计划中”的条目尚未实现。

## 一、先定角色，再找宿主

挂载项按“对文章起什么作用”分为七种角色。角色决定它能影响哪个阶段、必须遵守什么；
宿主（代码放在哪、数据从哪来）是实现细节，不作为分类依据。

| 角色 | 作用阶段 | 对文章的要求 |
| --- | --- | --- |
| 线索 | 选题 | 只用于启发题目。不能当作事实引用，不进参考文献。 |
| 证据 | 取材 | 实际读取原文后才算证据。正文引用必须能对回来源。 |
| 背景 | 取材 | 只读参考，不修改原记录。用于避免重复、保持连贯。 |
| 规则 | 写作 | 认领时冻结，交稿时核对哈希。与其他角色冲突时规则优先。 |
| 声音 | 写作 | 只影响表达，不改变事实和结构。冻结后记入私有写作记录。 |
| 版式 | 成文之后 | 只改变呈现，不改动正文内容。 |
| 界面 | 不参与产出 | 查看和编辑的入口，不携带任何写作规则。 |

前三种角色已在代码中使用，取值为 `lead`、`evidence`、`background`
（`desktop/scripts/agent/resources/mount-spec.mjs`）。后四种目前没有统一的角色字段。

### 优先级

同一篇文章里多个挂载项意见不一致时，按下列顺序取舍：

1. 规则
2. 证据
3. 声音
4. 线索与背景

版式和界面不参与内容取舍。

## 二、现有挂载项清单

### 线索、证据、背景：取材来源

定义在 `desktop/scripts/agent/resources/index.mjs`，单次写作任务按需挂载。

| 挂载类型 | 名称 | 角色 | 数据来源 |
| --- | --- | --- | --- |
| `signals` | 热榜与标签 | 线索 | Center 的热榜账本（TikHub 采集） |
| `web`（关键词） | 联网搜索 | 线索 | 搜索结果，读取页面前只是候选 |
| `web`（网址） | 已知网页 | 证据 | 读取到的公开页面 |
| `rss` | RSS 资料库 | 由任务指定 | 本机 RSS 资料库 |
| `file` | 本地文件 | 由任务指定 | 导入的 EPUB、PDF、Markdown、TXT |
| `github` | GitHub 仓库 | 由任务指定 | 匿名读取公开仓库 |
| `existing` | 已有资料 | 背景 | 本站已有作品、日历、历史记录 |

可用范围：

- 桌面端交互写作：可用。
- 无人值守的单篇产出（`desktop/scripts/agent/headless/produce.mjs` 的 `--mount`）：可用。
- 选题入池：热榜可用。`rssd center pool-leads` 列出热榜词作为线索（`scripts/rssd-topic-leads.mjs`），
  选题连同线索用 `rssd center pool-add` 入池（`scripts/rssd-topic-pool.mjs`）。
- 调度器的即时选题（`scripts/rssd-multisite-*.mjs`）：不可用。它要求每个题在选题时就带已核验并冻结的
  一手来源，线索只来自各栏目配置的 RSS。

线索会被记录：需求上的 `lead` 字段保存线索的提供方、平台、词条和观测时间，随需求保存并在认领时
交给写作方。它只说明题目由什么启发，不是来源。

### 规则

| 挂载项 | 位置 | 冻结方式 |
| --- | --- | --- |
| 写作规则与栏目要素 | `contracts/writing-skills/`、`contracts/writing-defaults.mjs` | Center 分发带指纹的目录，认领时冻结为基线，交稿时核对 |
| 作者工作区技能 | 作者本机的技能文件 | 设备按认领冻结快照，哈希记入稿件的模型签名 |
| 栏目规则（写作要求、发布渠道、署名人格） | Center 里各工作区的栏目设置 | 认领时整体冻结进需求；之后的修改不影响已认领的任务 |
| 栏目接受的作品类型、长文是否带卡片页 | `contracts/site-sections.mjs` 的 `workTypes`、`articleCards` | 随站点配置发布；写作时只能选栏目接受的类型 |
| 选题不得重复 | `contracts/topic-repeat.mjs`，Center 持有一份相同的副本 | 新建写作需求时由 Center 执行；由长文改写的笔记不算重复 |

详见 [writing-defaults.md](./writing-defaults.md)。

### 声音

| 挂载项 | 状态 |
| --- | --- |
| 文风参考（工作区技能引用的 `references/voice.md`） | 已有，随作者工作区技能一起冻结 |
| 人格的署名 | 已有。栏目规则里填人格的编号和名字，认领时冻结；新作品署该名字，编号只留在稿件的私有信息里 |
| 人格的写作风格 | 计划中。目前人格只署名，不改变文章怎么写 |

人格名单来自仓库之外的人格包，`scripts/rssd-persona-roster.mjs` 只读取其中的编号和名字
（`rssd center personas --pack <文件> [--check]`）。

### 版式

| 挂载项 | 位置 |
| --- | --- |
| 正文模板、标题模板、品牌尾注 | 桌面端写作界面的挂载选择器（`desktop/src/editorial/NotebookMountPicker.tsx`） |
| 文章导出模板 | `web/engine/browser-export/`，见 [browser-export-templates.md](./browser-export-templates.md) |
| 笔记页、长文的卡片页、标签行 | `web/engine/browser-export/note*.mjs`、`tags.mjs`；卡片的生成见 [card-renditions.md](./card-renditions.md) |
| 公众号排版与卡片 | `obsidian/src/wechat-*.mjs`、`obsidian/src/cards.mjs` |
| 站点主题 | `web/themes/` |

### 界面

| 挂载项 | 位置 |
| --- | --- |
| Obsidian 插件 | `obsidian/` |
| 桌面浏览器扩展 | `desktop/extension/` |

## 三、容易混淆的名称

“连接器”在仓库里指三种不同的东西。文档和讨论中请使用右列的叫法。

| 代码中的名字 | 实际含义 | 建议叫法 |
| --- | --- | --- |
| `CONNECTORS`（`desktop/scripts/agent/resources/`） | 单次任务的取材来源 | 取材来源 |
| `desktop/src/connections/catalog.json` | 按空间配置、带凭据的应用连接（Google 书库、Feedly、Inoreader、Figma、GitHub） | 应用连接 |
| `desktop/connectors/` | 把公开数据转成 RSS 的本机程序 | 数据转接 |

另外四处：

- GitHub 同时出现在“取材来源”和“应用连接”中，两者相互独立。
- `labels` 在代码里指各平台热榜的采集账本（[LABELS.md](../center/rssd/LABELS.md)），
  与文章的数据标注无关。
- `topic` 指选题（`scripts/rssd-topic-*.mjs`、需求上的 `topicKey`、拒绝码 `topic_repeat`）。
  笔记里的 `#话题` 在代码里叫 `tags`。
- 人格的“署名”与栏目规则里的“品牌署名”不同：前者是文章的作者名，后者是文末的品牌尾注。

## 四、新增挂载项的步骤

每类挂载项要改的地方不止一处。`tests/mount-consistency.test.mjs` 会在漏改时失败并指出缺的是哪一处：

| 新增的东西 | 要改的地方 |
| --- | --- |
| 取材来源 | `resources/` 下的模块；`index.mjs` 的名单和浏览分支；`mount-spec.mjs` 的命令行解析；`writing-context-store.mjs` 的解析分支 |
| 应用连接 | `desktop/src/connections/catalog.json` 的条目；`adapters.rs` 的 `Adapter::from_id` 和请求逻辑 |
| 栏目类型（写作族） | `writing-column-families.json` 的映射；`contracts/writing-skills/rssd-writing-<类型>/SKILL.md`；`writing-defaults.mjs` 的栏目要素 |
| 站点领域 | `contracts/writing-skills/rssd-domain-<站点>/SKILL.md`；`writing-defaults.mjs` 的 `WRITING_DOMAIN_IDS` |
| 作者工作区技能 | 工作区模板 `.agents/skills/<名字>/SKILL.md`，文件头的 `name` 与文件夹同名 |
| 可写栏目 | 主题仓库 `export/templates/<站点>/<栏目>.json` |

1. 确定角色。一个挂载项只有一种角色；如果它既给线索又给证据，拆成两项。
2. 查上面的清单，放进同角色的现有位置。只有现有位置都不适用时才新增宿主。
3. 在本页清单中登记，并写明以下各项：
   - 数据从哪来，凭据放在哪，有没有费用上限。
   - 哪些流程可以使用：桌面交互写作、无人值守产出、自动选题。
   - 是否在认领时冻结，是否记入稿件的私有写作记录。
   - 内容是否允许进入公开稿件。
4. 凭据只放在系统钥匙串或私有配置文件中，不进入仓库、提示词和公开数据。

## 五、例：把 TikHub 热点用于选题

- 角色：线索。
- 宿主：已存在。Center 按预算定时采集并通过 `/api/rssd/v1/labels` 提供；
  设备以 `signals` 取材来源读取。
- 写单篇时：桌面端写作和无人值守的单篇产出可以直接挂载 `signals`。
- 囤题时：

  ```
  rssd center pool-leads --platform douyin --query 猫 --limit 30
  rssd center pool-add --workspace pets --section daily-cat --file topics.json
  ```

  第一条列出热榜词；由人或代理据此写出选题文件（每条有标题和简述，并把所用的线索放进 `lead`），
  第二条入池。Center 会拒绝与本栏目已有作品或未完成需求重复的题。
- 要求：热点只用于产生题目；题目确定后，认领的一方仍须读取一手来源作为证据。
- 未做：从热榜词到题目这一步不是自动的；调度器的即时选题不读热榜。

## 六、已知缺口

- 没有一份机器可读的挂载总表。本页是人工维护的清单，各处登记是否一致由 `tests/mount-consistency.test.mjs` 检查。
- 规则、声音、版式、界面四种角色没有统一的角色字段。
- 第一节的优先级顺序是约定，代码里没有一处统一执行它。
- 线索只记在需求上。写单篇时挂载的线索不进入稿件的私有写作记录。
- 调度器的即时选题不接受线索类的取材来源。
- 人格只署名，没有写作风格；由长文改写的笔记用所在栏目的人格，而不是沿用原文的署名。
