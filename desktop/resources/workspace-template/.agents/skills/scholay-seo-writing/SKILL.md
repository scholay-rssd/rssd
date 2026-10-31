---
name: scholay-seo-writing
description: Create or revise Chinese canonical Scholay SEO articles in this repository. Use for drafting, source-preserving edits, or restructuring a canonical article; do not use for translation, platform variants, publishing, or read-only QA.
---

# Scholay SEO 中文写作

Produce one Chinese canonical article at `articles/<月份>/<日期>_<序号>_<中文短标题>/正文.md` without mixing publication artifacts into the article tree.

## Boundaries

- Keep a stable article ID in `_ops/inventory/article-index.json`, separate from its Chinese directory name. For a new article, register its `canonicalPath`, content-batch date and short title; update `articles/README.md`. Pieces outside the routine batch go under `articles/annex/<column>/<nn>_<short-title>/`, where `<column>` is an entry of `annexColumns` in the article index, and the batch date stays null. Never infer a batch date from file modification time. Existing IDs do not change when a title changes.

- Treat an existing canonical article as protected source text. Read it completely and inspect the requested scope before editing. A path, format, or asset move does not authorize prose changes.
- Write only Chinese canonical content under `articles/<月份>/<日期>_<序号>_<中文短标题>/`. Keep editable diagrams in `assets/source/` and committed article images in `assets/rendered/` below the same article; put reusable or article-specific rendering configuration under `_ops/config/rendering/<slug>/`, never in the article tree.
- Do not create English translations, platform-specific copies, publication packages, AdsPower actions, Feishu writes, or publication-state claims. Route those requests to `$scholay-desktop-publishing` after the canonical article is stable.
- Use repository-relative links. Never place credentials, browser/profile state, machine ports, or user-home paths in an article.

## Load the minimum guidance

Read [references/voice.md](references/voice.md) when voice guidance is needed. Load [product-capabilities](references/product-capabilities.md), [link-policy](references/link-policy.md) and the [link target inventory](../../../_ops/inventory/link-targets.md) only when the article includes product information or promotional links. Read only the relevant format reference when its structure or evidence requirements are needed:

- Science, history, or public-interest narrative: [references/science-story.md](references/science-story.md)
- Research method or decision workflow: [references/research-method.md](references/research-method.md)
- Comparison or tool-review article: [references/tool-review.md](references/tool-review.md)

Reuse the current task’s reader problem, materials and requirements as the brief. For file-based work without that context, create the matching brief at `_ops/inventory/briefs/<slug>.md`; do not duplicate an existing brief. Copy the matching article asset only when `articles/<月份>/<日期>_<序号>_<中文短标题>/正文.md` does not already exist:

- [assets/science-story-brief.md](assets/science-story-brief.md)
- [assets/science-story-article.md](assets/science-story-article.md)
- [assets/research-method-brief.md](assets/research-method-brief.md)
- [assets/research-method-article.md](assets/research-method-article.md)
- [assets/tool-review-brief.md](assets/tool-review-brief.md)
- [assets/tool-review-article.md](assets/tool-review-article.md)

## Workflow

1. Bind one stable slug, reader problem, format, evidence boundary, and intended canonical path.
2. Draft the reader judgment first. Do not stall a science story on finding a primary paper for every commonplace.
3. Write or patch only `articles/<月份>/<日期>_<序号>_<中文短标题>/正文.md` and its article-local assets. Preserve unsupported uncertainty rather than smoothing it away.
4. Check that the title is useful without the brand name, local asset links resolve, and the diff contains only the requested content changes.
5. Verify facts, citations and dates while gathering evidence and writing. New articles use one writing pass: public prose and private notes go to their own fields immediately. Do not add a post-draft review or cleanup pass to separate them. Repair concrete factual or format errors only within the authorized scope. Use `$scholay-seo-qa` when the user requests an independent review. Publishing keeps its existing format, version and authorization checks.

In Today, `task_read.notebook` and the current delegation define the output location and editable nodes. Preserve IDs, source links, author locks and revisions; do not create a separate brief or canonical file alongside the article board. Writing, copy-editing and humanizer are dimensions of one focused pass, not sequential whole-article rewrites.

Today 子弹笔记将读者正文与作者备注分开：正文集中回答本篇问题，保留核心判断、方法、步骤和例子；附带的概念辨析、适用边界展开、例外和防误读提醒，在行文时调用 `notebook_notes`，用对应 `blockId` 写入 `notes.supplement`。正文只需简明界定讨论对象，不在段尾或额外的“注意事项”章节重复这些旁支。若辨析或限制本身就是本篇主题，核心答案仍在正文。制作过程继续使用 `writing`、`images`、`verification`；备注仅作者可见，不进入公开稿。纯 Markdown 写作不自行发明可公开的“内部备注”附录。

新稿优先在同一次 task_update.notebook 中提交公开 blocks 与对应 blockNotes；行间备注使用 supplement/writing/images/verification/other，整篇说明使用 internalNotes，模型记录由运行服务填写。正文独立满足目标篇幅，内部字段在正文预算外另留约 15%–25% 余量，不作为最低备注字数；JSON 语法与来源清单也不计入正文。逐行写作可在同一写作过程中调用 notebook_notes，不等全文结束再搬迁。只有明确要求改稿时才进入集中修订。

正文与作者备注的分工遵循当前项目写作协议，旧模板与 brief 中冲突的声明要求不再执行。事实核查是作者的义务；必要事实、证据边界、资料阅读范围、未实测及不冒充实测等检查只用于作者内部核验，记录写入对应行的 verification，整篇说明使用 internalNotes，不写成公开正文、摘要或 fields.status 的声明。配图制作取舍进入 images，附带解释进入 supplement，在写作时分开保存；备注待办不新增成稿或发布门槛。

## 栏目产品化交付

六类工作台任务在用户要求成稿质量、参考文献、产品信息或公众号样式时，先执行[栏目成稿标准](references/column-quality.md)。参考文献格式与事实对应为本类交付的验收项；不沿用普通探索稿的来源可选标准。
