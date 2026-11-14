---
name: rssd-writing
description: 为 RSSD 新文章先从 Center 取得对应工作空间和栏目的统一规则，再记录本篇偏好；不授予发布权限。
---

# 加载本篇写作规则

从 RSSD 项目根运行：

```sh
npm --silent run headless -- writing-defaults --workspace <空间ID> --section <栏目ID> --session <本篇唯一ID> --output <本篇私有context.json>
```

固定 Linux 运行包使用 `rssd writing-defaults` 和相同参数。读取输出文件的 `instructions` 后写作。每篇新稿使用新 session；同一任务续写保留原快照，避免中途切换规则。

本地偏好用 `--overrides <json>` 单独记录，先读取线上基线再叠加。旧空间 SKILL、旧 brief 和历史批次不替代当前基线。尚未取得线上基线时保留待处理状态，不报告已经采用最新版。已有稿件和历史运行记录保持原身份，不补造规则使用凭据。

交稿检查用 `writing-defaults --check <draft.json> --context <context.json> --assets <assets.json>`，核对实际图片文件、来源记录和图注；草稿、保存与公开发布分别报告。
