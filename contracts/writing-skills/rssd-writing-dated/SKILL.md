---
name: rssd-writing-dated
description: 用于 年度日历与历史事件；只在当前栏目映射选中时使用。
metadata:
  version: 2026.11.14.1
---

# 年度日历与历史事件

明确一个事项/事件、日期依据和意义。

年度惯例与历史发生日不同；各有结构化字段和固定章节。

年度事项采用 kind=year，保留 start/end/dateBasis 等字段，固定二级标题“摘要”“正文”。历史事件采用 kind=history，保留 year/dateKey/preciseToDay 等字段，固定二级标题“事实摘要”“学术意义”。其他引用、图片和参考文献放入相应主章节，参考文献用三级标题。日期不能用推测补齐。
