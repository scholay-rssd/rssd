# 智能体读的文档：盘点

rssd 里几乎每个环节都有智能体参与：下单、认领、写作、翻译、配图、交稿、质检。本页盘点这些环节里，
智能体实际读到哪些文字、这些文字从哪里来，哪些规则写在了好几处，哪些做法还没写进仓库。
只盘点，不改代码；后续改动按第六节拆成小 PR，交给对应主题线。

本页描述 2026-11-22 的 main（`ec0a6e4`），Center 指针 `7eec5283`。没有打开 `center/` 子模块，
认领包里有什么是从写作端的用法推出来的。

## 一、文字从哪里来

| 位置 | 内容 | 怎么到智能体手里 |
| --- | --- | --- |
| `contracts/article-writing-policy.mjs` | 写作协议 | 代码注入，认领时冻结 |
| `contracts/writing-skills/`（24 个技能） | 线上写作基线：通用、文体、领域技能和 `rssd-writing-base/references/images.md` | Center 发布写作默认值后，由 `contracts/writing-defaults-v1.cjs:62-67` 拼成全文注入 |
| `contracts/editorial-column-policy.mjs` | 栏目规则 | 代码注入 |
| 工作区模板 `desktop/resources/workspace-template/.agents/skills/`（18 个技能） | 旧的写作、选题、配图、质检、上传技能 | 认领包没冻结写作默认值时整篇注入（`desktop/scripts/agent/center-skill-mounts.mjs`）；桌面工作区的工作流也注入；普通聊天里只列路径，智能体自己去读 |
| 工作区模板 `AGENTS.md`、`README.md` | 工作区入口和技能清单 | 旧工作流整篇注入（`desktop/scripts/agent/workflow.mjs:73-77`）；普通聊天里只叫智能体"先读"（`desktop/scripts/agent/worker.mjs:192`） |
| 需求池单子（标题、简介、本单规则、品牌、人格） | 本篇要求 | 认领包带过来，代码注入 |
| `docs/`、`HEADLESS.md` | 单子格式、写作默认值用法、作品属性、今日学术批量录入、无头命令 | **没有任何提示注入或提到它们。** 只有开发会话或人自己去读 |

## 二、按场景：智能体实际拿到什么

### 认领需求池的单子并写作（Center 生产）

`centerWritingPrompt`（`desktop/scripts/agent/center-producer.mjs:79-99`）按下面的顺序拼：

1. 安全前言；
2. 认领时冻结的写作协议；
3. 二选一：认领包冻结了写作默认值，就用线上基线全文（第一节第二行）；没冻结，就用工作区技能全文和引用；
4. 栏目规则；
5. 本单规则、品牌；
6. 人格；
7. 标题和简介，核实过的来源材料；
8. 固定的写法提示、原创或翻译说明、参考文献说明、输出格式。

智能体以不能读文件、不能开终端的方式启动（同文件 `:182`）。这条路上它读不到任何文档，
提示里没有的就等于不存在。所以这一条最适合"规则跟着任务下发"。

### 桌面工作区写作

- 笔记本模式和旧工作流：技能、写作协议、写作默认值都由代码注入（`desktop/scripts/agent/notebook.mjs:93-109`、`desktop/scripts/agent/workflow.mjs:41-77`）。
- 普通聊天：只有一句"先读当前目录 AGENTS.md、README.md 和对应写作 skill"，剩下的靠智能体自己读。
- 装过线上写作默认值的工作区（`scripts/install-writing-defaults.mjs`）：在 `AGENTS.md` 顶部插入"统一写作入口"，
  另写一个 `site-writing` 技能，叫智能体先运行 `writing-defaults … --request`、再读生成的 `request.txt`
  （`scripts/writing-draft-request.mjs`：基线 → "本篇要求" + 简介 → 输出格式）。

### 翻译、续写英文版

和认领写作是同一个提示，另外注入中文原稿（`center-producer.mjs:95`），需要配图方案时再加
`scripts/rssd-image-translation-prompt.mjs` 的说明。

### 配图

- Center 配图方案：`scripts/rssd-image-plan.mjs` 的输出格式，加上和写作相同的技能。
- 生成图片：图片规则的技能和引用整篇注入（`scripts/rssd-codex-image-provider.mjs`、`scripts/rssd-cursor-image-provider.mjs`）。
- 从原文取图的 `scholay-source-images`：没有代码注入它，只能靠智能体在工作区里自己读。

### 交稿

生产路径由代码提交，不经过智能体。Center 助手被明确禁止提交。桌面工作区的上传规则在
`worker.mjs:192` 那句开场白里，加上 `AGENTS.md` 列出的 `scholay-desktop-publishing` 技能。

### 选题、下单

自动选题（`scripts/rssd-topic-codex.mjs:45-55`）注入角色、限制、允许的站点、栏目规则、已有标题、
来源种子和写作协议，不带技能，查重和来源核对由代码做。

人工下单（Obsidian 选题池库或 `rssd center pool-add`）完全靠下单的人或会话读
[pool-orders.md](./pool-orders.md)。智能体代为下单时，这份文档没有任何注入路径。

## 三、规则重复和冲突

| 规则 | 写在哪里 | 问题 |
| --- | --- | --- |
| 图注末尾加不加句号 | `contracts/writing-skills/rssd-writing-base/references/images.md:9`、`scholay-source-images/SKILL.md:22` 要句号；`scholay-seo-writing/references/voice.md:63` 写"图注不加句号" | **直接冲突。** 认领包没冻结写作默认值时，注入的是工作区技能，就会拿到旧说法。2026-11-22 已把 `voice.md` 改成同一格式：图题以句号结束，整条图注末尾不加句号 |
| 写作协议 | `center-producer.mjs:83` 注入一次；冻结了写作默认值时，基线里又带一份（`writing-defaults-v1.cjs:64`） | 同一篇提示里出现两遍，白占篇幅 |
| 公开图注不标"AI 生成" | `images.md:7`、`scholay-source-images/SKILL.md:28`、`scholay-rhino-illustration/SKILL.md:23`、`article-writing-policy.mjs` | 内容一致，但有四份；改的时候要四处一起改 |
| 中文写作用哪个技能 | 模板 `AGENTS.md` 写"中文写作：scholay-seo-writing"；装过写作默认值后，顶部又多了"统一写作入口"（`site-writing`）；模板里另有没列出的 `rssd-writing` | 一个工作区里有两三个"写作入口"，靠 `AGENTS.md` 里"新协议优先"一句话来消解 |
| alt 长度 | `contracts/notebook-output.mjs:7`（目标 28–45、范围 20–60 个码点）、`rssd-writing-base` | 一致；输出格式里那份是唯一会被检查的，其余可以改成引用 |
| 标题一句话、不用两段式 | `article-writing-policy.mjs`；[pool-orders.md](./pool-orders.md) 第二节引用它 | 做法是对的：文档讲为什么，规则只在协议里 |
| 文章样式与分享 | `docs/article-sharing.md` 和 `docs/browser-export-templates.md` | 两个文件逐字节相同 |

## 四、工作区入口

模板 `AGENTS.md` 只有 27 行，是一点点加出来的：技能清单后面又零散补了两项技能和配图规则。

模板里 18 个技能，有 7 个没在 `AGENTS.md` 里列出：`copy-editing`、`experiment-design`、`humanizer`、
`rssd-writing`、`site-writing`、`statistics-explainer`、`succes-content`。其中 `site-writing` 由
`install-writing-defaults` 安装时写入入口；其余几个，普通聊天里的智能体不知道它们存在，除非自己去翻目录。

## 五、只在会话记忆里、还没写进仓库的做法

下面这些是开发会话在真实操作里摸出来的，目前只存在于某台机器的会话记忆里，别的会话和智能体看不到：

1. **手工完成一张池单。** 认领（`center claim`，24 小时）→ 写笔记本 v2 → 用 `notebookMarkdown` 生成正文、
   `siteByline` 生成署名 → 配图用 `stageMedia` 暂存 → `center submit`，一个包只放一个语言版本，先中文后英文，
   英文带 `translationOf`。`HEADLESS.md` 的 Topic pool 一节只写了 `pool-leads`、`pool-add`、`demands`、`withdraw`，
   没有 `claim` 和 `submit`。
2. **交稿前自己查 alt 和记录小标题。** 2026-11-19 手工写作时发现：认领包没冻结写作默认值时，
   Center 不检查 alt 长度，要自己对照栏目默认值查 `deliveryIssues`；历史和今日学术的记录要用
   `contracts/rssd-record.cjs` 的 `recordFields` 核对小标题。
3. **单子上的事实可能是错的。** 同一天有一张历史单把日期写错了（11-06，来源是 11-11）。写之前要核对简介里的日期。
4. **下历史单前按日期查重。** 历史单的标题不带日期，Center 的查重（`contracts/topic-repeat.mjs`）按标题主题比较，
   认不出"同一天的同一件事、换了个说法"。2026-11-19 因此进了两张重复的单子，后来撤回。下单前要拿简介
   "记录字段"里的年月日，和栏目里已有作品的 `year` + `dateKey` 逐一比对。今日学术一天有很多条，不适用。

[pool-orders.md](./pool-orders.md) 已经收进了品牌、标题、历史单日期写在记录字段这几条，上面四条还没有。

## 六、建议的后续

按主题线拆，每项一个小 PR：

| 项 | 内容 | 主题线 |
| --- | --- | --- |
| ~~修图注冲突~~ | 已做（2026-11-22）：`voice.md` 写明和 `images.md` 相同的图注格式 | 写作效果 |
| 去掉重复的写作协议 | 冻结了写作默认值时，`centerWritingPrompt` 不再单独注入协议，或基线不再内含协议；二选一，并补测试 | 写作效果、桌面与无头 |
| 理清工作区写作入口 | `AGENTS.md` 只留一个写作入口；装过写作默认值的工作区里，旧 `scholay-seo-writing` 改为"仅在没有线上基线时使用"；没列出的技能要么列进去，要么删掉 | 写作效果 |
| 补认领和交稿命令 | `HEADLESS.md` 补 `center claim`、`center submit`，以及第五节第 1、2 条的步骤和检查 | 桌面与无头 |
| 把检查放进代码 | 历史单按日期查重放进 `pool-add`（先在 `--dry-run` 报出来）；交稿前不论是否冻结写作默认值都按栏目默认值查 alt | 中心收发 |
| 单子格式补两条 | [pool-orders.md](./pool-orders.md) 写明"简介里的日期和事实要核对"，"下历史单前按日期查重"（代码查重上线后改成引用） | 架构优化 |
| 合并重复文档 | 删掉 `docs/browser-export-templates.md`，或改成指向 `article-sharing.md` | 站点样式 |
| 下单时注入单子格式 | 智能体代为下单时，像写作一样由代码注入单子格式，不靠它自己去读 `docs/` | 中心收发、架构优化 |

总的原则：

- **能检查的规则放进代码。** 文档讲为什么、给例子，规则本身只写在一处（协议、校验函数或输出格式），其余地方引用。
- **规则跟着任务下发。** 智能体干活时用到的规则，由代码按场景拼进提示，不让它自己去 `docs/` 里找。
  认领写作这条路已经是这样，下单、桌面普通聊天还不是。
- **`docs/` 写给开发会话和人。** 其中单子格式、写作默认值这类"干活时要遵守"的内容，要有一条注入路径，
  或者落到协议和检查里。
