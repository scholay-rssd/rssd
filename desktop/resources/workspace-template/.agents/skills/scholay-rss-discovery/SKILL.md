---
name: scholay-rss-discovery
description: 为 Scholay Today 查找和核实学术机构、期刊、科研项目的真实 RSS 或 Atom 来源，逐槽保存候选订阅入口。只发现来源，不写文章、不自动订阅或修改 RSS 数据库。
---

# RSS 来源发现

先 `task_read` 获取人工分栏、空智能槽位、检索方向和已有来源。遵循 [步骤与板子约定](../scholay-xiwen/references/structured-workflow.md) 的逐槽读取、进度和版本规则；本模式只完成素材板。

- 用 scholay-rss 的 `feed_read({url})` 核验实际 XML：成功需要 status=verified、format、contentSha256 和 verifiedAt；记录 sampleEntries 的日期与核验日期。此工具只读，不订阅。`page_read` 用于 HTML 原站，不用它代替 XML 核验。
- 优先查原站声明的 RSS/Atom 入口、页面 feed 链接或官方文档。搜索结果只能作为线索，保存前读取实际订阅入口，确认可访问且内容是 RSS/Atom；返回 HTML、登录页或错误页不能当成功订阅。
- 同一订阅入口不重复保存。已有本地来源用于发现缺口，不自动新增订阅、刷新全库、更改阅读状态、清洗数据库或写稿。
- 每槽开始用 `task_topic_progress` 标记 searching，核实一条后重新 `task_read`，只增加该槽的一条候选，item.id 等于 slot.id，保存完整 board。成功写回再处理下一槽；找不到可靠入口则用 missing 写明缺口。
- `url` 是订阅入口，`publisher` 是原站机构，`title` 是来源名称，`summary` 写内容范围、原站链接及核验方式。`date` 为本次实际访问核验日，`dateBasis` 写“订阅可访问性核验日期”，不能当作内容发布日期。
- `verifiedAt` 的 UTC 时间转换为任务时区后再填 `date`，跨午夜须注明时区。机构归属以当前官方页面为准，不沿用记忆中的运营方。条目数只代表该次读取快照，不代表全库或日发表总量；复查数量变化时保留各自时间与哈希。
- 新候选默认未选。保留人工已有来源、分栏及槽位；用户确认选择后本次任务结束。不生成文章标题、大纲、正文或图片，不操作云端。

原文核验使用[页面采集与预处理](../scholay-xiwen/references/source-preprocessing.md)中的本地 RSS、桌面浏览器页面读取与公开网页提取；按实际来源类型与缺口记录证据。

## 产品化图文验收

用户要求产品化交付时，另交来源验收报告：列出来源覆盖、RSS/Atom 格式、入口、实际核验日期、最近条目日期、适用研究任务与可访问性证据。参考文献按 [序号] 机构. 订阅或说明页标题[EB/OL]. [核验日期]. URL 编排。说明“候选未订阅”；产品信息仅解释 Scholay 的阅读与人工选源路径，不暗示自动订阅。报告可用 briefing 公众号样式预览，不能借此创建文章或修改 RSS 数据库。
